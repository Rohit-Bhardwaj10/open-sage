import "dotenv/config";
import { Worker } from "bullmq";
import { readFileSync, existsSync } from "fs";
import { HfInference } from "@huggingface/inference";
import prisma from "../lib/prisma";
import { redis } from "../lib/queue";
import type { EmbeddingJobPayload } from "../lib/queue";

// ── HF Inference API embedding ────────────────────────────────
// sentence-transformers/all-MiniLM-L6-v2 → 384 dims, hosted by HF
// No native binaries, no sharp, no ONNX runtime required.
const EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
const EMBEDDING_DIMS = 384;

const hf = new HfInference(process.env.HF_TOKEN || "");

/**
 * Generate embeddings for a batch of texts via HF Inference API.
 */
async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    const BATCH_SIZE = 10;   // max concurrent HF API calls at a time
    const BATCH_DELAY = 200; // ms pause between batches to avoid rate limit
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);

        const batchEmbeddings = await Promise.all(
            batch.map(async (text) => {
                const response = await hf.featureExtraction({
                    model: EMBEDDING_MODEL,
                    inputs: text,
                    provider: "hf-inference",  // explicit — suppresses "Auto selected provider" log spam
                });
                const flat = (Array.isArray(response[0]) ? response[0] : response) as number[];
                if (flat.length !== EMBEDDING_DIMS) {
                    throw new Error(`Expected ${EMBEDDING_DIMS} dims, got ${flat.length}`);
                }
                return flat;
            })
        );

        results.push(...batchEmbeddings);

        // Pause between batches to stay within HF free-tier rate limits
        if (i + BATCH_SIZE < texts.length) {
            await new Promise((r) => setTimeout(r, BATCH_DELAY));
        }
    }

    return results;
}


// ── Chunking ──────────────────────────────────────────────────
const CHUNK_SIZE = 1000;    // characters per chunk
const CHUNK_OVERLAP = 200;  // overlap for context continuity

interface TextChunk {
    content: string;
    startLine: number;
    endLine: number;
}

function chunkText(text: string, chunkSize: number, overlap: number): TextChunk[] {
    const chunks: TextChunk[] = [];
    const lines = text.split("\n");

    // Cumulative char offsets per line for mapping char→line
    const lineOffsets: number[] = [];
    let offset = 0;
    for (const line of lines) {
        lineOffsets.push(offset);
        offset += line.length + 1;
    }

    function charToLine(charPos: number): number {
        let lo = 0, hi = lineOffsets.length - 1;
        while (lo < hi) {
            const mid = Math.floor((lo + hi + 1) / 2);
            if (lineOffsets[mid] <= charPos) lo = mid; else hi = mid - 1;
        }
        return lo + 1;
    }

    let start = 0;
    while (start < text.length) {
        const end = Math.min(start + chunkSize, text.length);
        chunks.push({
            content: text.slice(start, end),
            startLine: charToLine(start),
            endLine: charToLine(end - 1),
        });
        start += chunkSize - overlap;
        if (start < text.length && text.length - start < overlap) break;
    }

    return chunks;
}

// ── Job processor ─────────────────────────────────────────────

async function processEmbeddingJob(job: any) {
    const { repoId, fileId, filePath, localPath } = job.data as EmbeddingJobPayload;

    console.log(`[EMBEDDING] Processing: ${filePath}`);

    // Guard: file must exist on disk
    if (!existsSync(localPath)) {
        console.warn(`[EMBEDDING] ⚠ File not found on disk, skipping: ${localPath}`);
        await prisma.indexedFile.deleteMany({ where: { id: fileId } }).catch(() => {});
        return;
    }

    const content = readFileSync(localPath, "utf-8");

    // Verify file still in DB
    const file = await prisma.indexedFile.findUnique({ where: { id: fileId } });
    if (!file) {
        console.log(`[EMBEDDING] File ${fileId} deleted from DB, skipping`);
        return;
    }

    // Chunk the file
    const allChunks = chunkText(content, CHUNK_SIZE, CHUNK_OVERLAP)
        .filter(c => c.content.trim().length > 0);

    if (allChunks.length === 0) {
        console.log(`[EMBEDDING] No content to embed for ${filePath}`);
        return;
    }

    console.log(`[EMBEDDING] ${allChunks.length} chunks — generating embeddings in batch...`);
    const t0 = Date.now();

    // Delete stale chunks for re-indexing
    await prisma.codeChunk.deleteMany({ where: { fileId } });

    // ── BATCH: embed ALL chunks in one model call ──────────────
    const texts = allChunks.map(c => c.content);
    const embeddings = await generateEmbeddingsBatch(texts);

    console.log(`[EMBEDDING] ✓ Batch embedding done in ${Date.now() - t0}ms`);

    // ── BATCH INSERT: all chunks in one SQL statement ──────────
    // Build VALUES list: (id, fileId, chunkIndex, content, startLine, endLine, embedding::vector, now())
    const insertPromises = allChunks.map((chunk, i) =>
        prisma.$executeRaw`
            INSERT INTO "CodeChunk" (id, "fileId", "chunkIndex", content, "startLine", "endLine", embedding, "createdAt")
            VALUES (
                gen_random_uuid()::text,
                ${fileId},
                ${i},
                ${chunk.content},
                ${chunk.startLine},
                ${chunk.endLine},
                ${`[${embeddings[i].join(",")}]`}::vector,
                NOW()
            )
        `
    );

    // Run DB inserts in parallel batches of 20 to avoid overwhelming the connection pool
    const DB_BATCH = 20;
    for (let i = 0; i < insertPromises.length; i += DB_BATCH) {
        await Promise.all(insertPromises.slice(i, i + DB_BATCH));
    }

    // Update file record
    await prisma.indexedFile.update({
        where: { id: fileId },
        data: { chunkCount: allChunks.length },
    });

    console.log(`[EMBEDDING] ✓ ${filePath} — ${allChunks.length} chunks stored (total: ${Date.now() - t0}ms)`);
}

// ── Worker initialization ─────────────────────────────────────

const worker = new Worker("embedding", processEmbeddingJob, {
    connection: redis,
    concurrency: 2,  // limit concurrency to stay within HF free-tier rate limits
});

worker.on("completed", (job) => {
    console.log(`[EMBEDDING] ✓ Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
    console.error(`[EMBEDDING] ✗ Job ${job?.id} failed:`, err.message);
});

worker.on("error", (err) => {
    console.error("[EMBEDDING] Worker error:", err);
});

console.log("🚀 Embedding worker started (HF API — sentence-transformers/all-MiniLM-L6-v2)");
