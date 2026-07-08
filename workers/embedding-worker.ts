import "dotenv/config";
import { Worker } from "bullmq";
import { readFileSync, existsSync } from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import prisma from "../opensage/lib/prisma";
import { redis } from "../opensage/lib/queue";
import type { EmbeddingJobPayload } from "../opensage/lib/queue";

// Must match the model used in lib/rag.ts exactly
const EMBEDDING_MODEL = "text-embedding-004";
const EMBEDDING_DIMS = 768;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

if (!GEMINI_API_KEY) {
    console.error("[EMBEDDING] ❌ GEMINI_API_KEY is not set in .env");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

/**
 * Generate embeddings for a batch of texts via Gemini API
 * text-embedding-004: 768 dims, free tier 1500 req/min
 */
async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    // Process in sub-batches of 20 (Gemini supports batch embed)
    const SUB_BATCH = 20;
    for (let i = 0; i < texts.length; i += SUB_BATCH) {
        const subBatch = texts.slice(i, i + SUB_BATCH);
        const response = await embeddingModel.batchEmbedContents({
            requests: subBatch.map(text => ({
                model: `models/${EMBEDDING_MODEL}`,
                content: { parts: [{ text }], role: "user" },
                taskType: "RETRIEVAL_DOCUMENT" as any,
            })),
        });
        for (const emb of response.embeddings) {
            const flat = emb.values;
            if (flat.length !== EMBEDDING_DIMS) {
                throw new Error(`Expected ${EMBEDDING_DIMS} dims, got ${flat.length}`);
            }
            results.push(flat);
        }
    }
    return results;
}

/**
 * Generate embeddings for a batch of texts via local transformers.js
 */
async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    const pipe = await getEmbeddingPipeline();
    const results: number[][] = [];

    // Process in smaller sub-batches to avoid memory spikes
    const SUB_BATCH_SIZE = 5; 
    
    for (let i = 0; i < texts.length; i += SUB_BATCH_SIZE) {
        const subBatch = texts.slice(i, i + SUB_BATCH_SIZE);
        
        const subBatchEmbeddings = await Promise.all(
            subBatch.map(async (text) => {
                const output = await pipe(text, {
                    pooling: "mean",
                    normalize: true,
                });
                const flat = Array.from(output.data) as number[];
                if (flat.length !== EMBEDDING_DIMS) {
                    throw new Error(`Expected ${EMBEDDING_DIMS} dims, got ${flat.length}`);
                }
                return flat;
            })
        );

        results.push(...subBatchEmbeddings);
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
    concurrency: 50,  // Gemini API handles parallelism — no CPU bottleneck
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

console.log("🚀 Embedding worker started (Gemini API — text-embedding-004, 768 dims)");
