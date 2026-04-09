import "dotenv/config";
import { Worker } from "bullmq";
import { HfInference } from "@huggingface/inference";
import { readFileSync } from "fs";
import prisma from "../lib/prisma";
import { redis } from "../lib/queue";
import type { EmbeddingJobPayload } from "../lib/queue";

const HF_TOKEN = process.env.HF_TOKEN || "";
const hf = new HfInference(HF_TOKEN);

// Embedding model: BAAI/bge-base-en-v1.5 (768 dimensions)
const EMBEDDING_MODEL = "BAAI/bge-base-en-v1.5";

// Chunking configuration
const CHUNK_SIZE = 1000; // characters per chunk
const CHUNK_OVERLAP = 200; // overlap between chunks for context preservation

interface TextChunk {
    content: string;
    startLine: number;
    endLine: number;
}

/**
 * Split text into overlapping chunks, computing real line numbers
 */
function chunkText(text: string, chunkSize: number, overlap: number): TextChunk[] {
    const chunks: TextChunk[] = [];
    const lines = text.split("\n");

    // Build cumulative character offsets per line so we can map char → line
    const lineOffsets: number[] = [];
    let offset = 0;
    for (const line of lines) {
        lineOffsets.push(offset);
        offset += line.length + 1; // +1 for the newline character
    }

    function charToLine(charPos: number): number {
        let lo = 0;
        let hi = lineOffsets.length - 1;
        while (lo < hi) {
            const mid = Math.floor((lo + hi + 1) / 2);
            if (lineOffsets[mid] <= charPos) lo = mid;
            else hi = mid - 1;
        }
        return lo + 1; // 1-indexed
    }

    let start = 0;
    while (start < text.length) {
        const end = Math.min(start + chunkSize, text.length);
        const content = text.slice(start, end);
        chunks.push({
            content,
            startLine: charToLine(start),
            endLine: charToLine(end - 1),
        });

        start += chunkSize - overlap;

        // Avoid creating tiny final chunks
        if (start < text.length && text.length - start < overlap) {
            break;
        }
    }

    return chunks;
}

/**
 * Generate embedding for text using Hugging Face API
 */
async function generateEmbedding(text: string): Promise<number[]> {
    try {
        const response = await hf.featureExtraction({
            model: EMBEDDING_MODEL,
            inputs: text,
        });

        // Response is typically an array or nested array
        const embedding = Array.isArray(response) ? response : [response];

        // Flatten if nested
        const flatEmbedding = embedding.flat(Infinity) as number[];

        if (flatEmbedding.length !== 768) {
            throw new Error(`Expected 768 dimensions, got ${flatEmbedding.length}`);
        }

        return flatEmbedding;
    } catch (error) {
        console.error("Error generating embedding:", error);
        throw error;
    }
}

/**
 * Process embedding job: chunk file content and generate embeddings
 */
async function processEmbeddingJob(job: any) {
    const { repoId, fileId, filePath, localPath } = job.data as EmbeddingJobPayload;

    console.log(`[EMBEDDING] Processing file: ${filePath}`);

    try {
        // Read file content
        const content = readFileSync(localPath, "utf-8");

        // Check if file still exists in database
        const file = await prisma.indexedFile.findUnique({
            where: { id: fileId },
        });

        if (!file) {
            console.log(`[EMBEDDING] File ${fileId} was deleted, skipping`);
            return;
        }

        // Chunk the content
        const chunks = chunkText(content, CHUNK_SIZE, CHUNK_OVERLAP);
        console.log(`[EMBEDDING] Created ${chunks.length} chunks for ${filePath}`);

        // Delete existing chunks for this file (in case of re-indexing)
        await prisma.codeChunk.deleteMany({
            where: { fileId },
        });

        let embeddedCount = 0;

        // Process each chunk and generate embeddings
        for (let i = 0; i < chunks.length; i++) {
            const { content: chunkContent, startLine, endLine } = chunks[i];

            // Skip empty chunks
            if (!chunkContent.trim()) {
                continue;
            }

            console.log(`[EMBEDDING] Generating embedding for chunk ${i + 1}/${chunks.length} (L${startLine}-L${endLine})`);

            // Generate embedding
            const embedding = await generateEmbedding(chunkContent);

            // Store chunk with embedding and real line numbers
            await prisma.$executeRaw`
                INSERT INTO "CodeChunk" (id, "fileId", "chunkIndex", content, "startLine", "endLine", embedding, "createdAt")
                VALUES (
                    gen_random_uuid()::text,
                    ${fileId},
                    ${i},
                    ${chunkContent},
                    ${startLine},
                    ${endLine},
                    ${`[${embedding.join(",")}]`}::vector,
                    NOW()
                )
            `;

            embeddedCount++;

            // Small delay to avoid rate limiting (Hugging Face free tier)
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Update IndexedFile with final chunk count
        await prisma.indexedFile.update({
            where: { id: fileId },
            data: { chunkCount: embeddedCount },
        });

        console.log(`[EMBEDDING] ✓ Completed ${filePath} - ${embeddedCount} chunks embedded`);

    } catch (error) {
        console.error(`[EMBEDDING] Failed to process ${filePath}:`, error);
        throw error;
    }
}

// ── Worker initialization ─────────────────────────────────────
const worker = new Worker("embedding", processEmbeddingJob, {
    connection: redis,
    concurrency: 2, // Process 2 files concurrently (adjust based on API limits)
    limiter: {
        max: 10, // Max 10 jobs per duration
        duration: 60000, // Per minute (to respect API rate limits)
    },
});

worker.on("completed", (job) => {
    console.log(`[EMBEDDING] Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
    console.error(`[EMBEDDING] Job ${job?.id} failed:`, err.message);
});

worker.on("error", (err) => {
    console.error("[EMBEDDING] Worker error:", err);
});

console.log("🚀 Embedding worker started and listening for jobs...");
