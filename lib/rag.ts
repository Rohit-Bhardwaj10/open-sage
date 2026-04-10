import { HfInference } from "@huggingface/inference";
import Groq from "groq-sdk";
import prisma from "./prisma";

// ── Configuration ─────────────────────────────────────────────
const HF_TOKEN = process.env.HF_TOKEN || "";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";

const hf = new HfInference(HF_TOKEN);
const groq = new Groq({ apiKey: GROQ_API_KEY });

// Must match the model used in embedding-worker.ts exactly
const EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
const EMBEDDING_DIMS = 384;

// Groq model — llama-3.3-70b-versatile is fast, capable, and generous on free tier
const GROQ_MODEL = "llama-3.3-70b-versatile";

// ── Retry helper ──────────────────────────────────────────────

/**
 * Retry an async operation on 429 quota errors using the API-provided retryDelay
 * or exponential back-off (cap: 60 s, max 3 attempts).
 */
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            const is429 = err?.status === 429 || err?.message?.includes("429");
            if (!is429 || attempt === maxAttempts) throw err;

            // Parse the retry delay from the API error body if present (e.g. "54s")
            const match = err?.message?.match(/retryDelay["\s:]+(\d+)s/);
            const delaySec = match ? parseInt(match[1], 10) : Math.min(10 * 2 ** attempt, 60);
            console.warn(`[RAG] 429 quota hit – retrying in ${delaySec}s (attempt ${attempt}/${maxAttempts})`);
            await new Promise((r) => setTimeout(r, delaySec * 1000));
        }
    }
    throw new Error("Retry limit exceeded");
}

// ── Embedding Generation ──────────────────────────────────────

/**
 * Generate embedding for a query using HF Inference API
 * (sentence-transformers/all-MiniLM-L6-v2 → 384 dimensions)
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
    try {
        const response = await hf.featureExtraction({
            model: EMBEDDING_MODEL,
            inputs: query,
            provider: "hf-inference",  // explicit — suppresses "Auto selected provider" log spam
        });

        // HF returns nested arrays for batch or flat for single input
        const flat = (Array.isArray(response[0]) ? response[0] : response) as number[];

        if (flat.length !== EMBEDDING_DIMS) {
            throw new Error(`Expected ${EMBEDDING_DIMS} dimensions, got ${flat.length}`);
        }
        return flat;
    } catch (error) {
        console.error("Error generating query embedding:", error);
        throw error;
    }
}

// ── Vector Search ─────────────────────────────────────────────

/**
 * Find similar code chunks using pgvector similarity search
 */
export async function findSimilarChunks(
    repoId: string,
    queryEmbedding: number[],
    limit: number = 5,
    minSimilarity: number = 0.1  // minimum cosine similarity threshold
): Promise<Array<{
    chunk: any;
    similarity: number;
    file: any;
}>> {
    try {
        // Convert embedding to pgvector format
        const embeddingStr = `[${queryEmbedding.join(",")}]`;

        // Use raw SQL for vector similarity search with pgvector
        // Using cosine distance operator (<=>)
        const results = await prisma.$queryRaw<
            Array<{
                id: string;
                fileId: string;
                chunkIndex: number;
                content: string;
                startLine: number;
                endLine: number;
                similarity: number;
                filePath: string;
                language: string | null;
            }>
        >`
      SELECT 
        c.id,
        c."fileId",
        c."chunkIndex",
        c.content,
        c."startLine",
        c."endLine",
        1 - (c.embedding <=> ${embeddingStr}::vector) as similarity,
        f."filePath",
        f.language
      FROM "CodeChunk" c
      JOIN "IndexedFile" f ON c."fileId" = f.id
      WHERE f."repositoryId" = ${repoId}
      ORDER BY c.embedding <=> ${embeddingStr}::vector
      LIMIT ${limit * 3}  -- fetch extra, we'll filter by threshold below
    `;

        console.log(`[RAG] findSimilarChunks: found ${results.length} raw results for repo ${repoId}`);
        if (results.length > 0) {
            const topSims = results.slice(0, 3).map(r => Number(r.similarity).toFixed(3));
            console.log(`[RAG] Top similarities: ${topSims.join(", ")}`);
        } else {
            // Diagnose: check if any CodeChunks exist for this repo
            const chunkCount = await prisma.$queryRaw<Array<{count: bigint}>>`
                SELECT COUNT(*) as count FROM "CodeChunk" c
                JOIN "IndexedFile" f ON c."fileId" = f.id
                WHERE f."repositoryId" = ${repoId}
            `;
            console.warn(`[RAG] No chunks returned. Total CodeChunks for repo: ${chunkCount[0]?.count ?? 0}`);
        }

        const mapped = results.map((row: {
            id: string;
            fileId: string;
            chunkIndex: number;
            content: string;
            startLine: number;
            endLine: number;
            similarity: number;
            filePath: string;
            language: string | null;
        }) => ({
            chunk: {
                id: row.id,
                fileId: row.fileId,
                chunkIndex: row.chunkIndex,
                content: row.content,
                startLine: row.startLine,
                endLine: row.endLine,
            },
            similarity: row.similarity,
            file: {
                filePath: row.filePath,
                language: row.language,
            },
        }));

        // Filter by minimum similarity threshold and return up to `limit`
        const filtered = mapped.filter(r => r.similarity >= minSimilarity).slice(0, limit);
        console.log(`[RAG] After threshold (${minSimilarity}): ${filtered.length} chunks returned`);
        return filtered;
    } catch (error) {
        console.error("Error finding similar chunks:", error);
        throw error;
    }
}

// ── Context Building ──────────────────────────────────────────

/**
 * Build context string from similar chunks
 */
function buildContext(
    chunks: Array<{
        chunk: any;
        similarity: number;
        file: any;
    }>
): string {
    if (chunks.length === 0) {
        return "No relevant code found in the repository.";
    }

    let context = "Relevant code from the repository:\n\n";

    for (const { chunk, file, similarity } of chunks) {
        context += `--- File: ${file.filePath} (similarity: ${(similarity * 100).toFixed(1)}%) ---\n`;
        context += `\`\`\`${file.language || "text"}\n`;
        context += chunk.content;
        context += `\n\`\`\`\n\n`;
    }

    return context;
}

// ── RAG Query with Streaming ──────────────────────────────────

/**
 * Query the repository with RAG and stream the response
 */
export async function* queryRepositoryStream(
    repoId: string,
    userQuery: string,
    conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = []
): AsyncGenerator<string, void, unknown> {
    try {
        // Generate embedding for the query
        yield "Searching repository...\n\n";
        const queryEmbedding = await generateQueryEmbedding(userQuery);

        // Find similar code chunks
        const similarChunks = await findSimilarChunks(repoId, queryEmbedding, 5);

        if (similarChunks.length === 0) {
            // Distinguish: no embeddings at all vs query didn't match
            const chunkCount = await prisma.$queryRaw<Array<{count: bigint}>>`
                SELECT COUNT(*) as count FROM "CodeChunk" c
                JOIN "IndexedFile" f ON c."fileId" = f.id
                WHERE f."repositoryId" = ${repoId}
            `;
            const total = Number(chunkCount[0]?.count ?? 0);
            if (total === 0) {
                yield "⚠️ This repository has been indexed (files found) but **embeddings have not been generated yet**. " +
                      "The embedding worker may still be running, or it may have failed silently. " +
                      "Please check the worker logs and try again in a moment.";
            } else {
                yield `I couldn't find any relevant code in this repository to answer your question. ` +
                      `(${total} chunks are indexed — try rephrasing your question.)`;
            }
            return;
        }

        yield "Found relevant code. Generating response...\n\n";

        // Build context from chunks
        const context = buildContext(similarChunks);

        // Build conversation history
        const history = conversationHistory
            .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
            .join("\n\n");

        // Create prompt with RAG context
        const prompt = `You are a helpful AI assistant analyzing a code repository. Answer the user's question based on the provided code context.

${history ? `Previous conversation:\n${history}\n\n` : ""}Context from repository:
${context}

User question: ${userQuery}

Instructions:
- Answer based on the provided code context
- Be specific and reference file paths when relevant
- If the context doesn't contain enough information, say so
- Provide code examples when helpful
- Be concise but thorough`;

        // Stream response from Groq
        const stream = await groq.chat.completions.create({
            model: GROQ_MODEL,
            messages: [{ role: "user", content: prompt }],
            stream: true,
            max_tokens: 1024,
        });

        for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content || "";
            if (text) yield text;
        }
    } catch (error: any) {
        console.error("Error in RAG query:", error);
        const isQuota = error?.message?.includes("429") || error?.status === 429;
        if (isQuota) {
            yield `\n\n⚠️ **Quota exceeded.** The Groq API free-tier limit has been reached. Please wait a moment and try again.`;
        } else {
            yield `\n\nError: ${error.message || "Failed to generate response"}`;
        }
    }
}

/**
 * Non-streaming version of RAG query (for compatibility)
 */
export async function queryRepository(
    repoId: string,
    userQuery: string,
    conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = []
): Promise<string> {
    let fullResponse = "";

    for await (const chunk of queryRepositoryStream(repoId, userQuery, conversationHistory)) {
        fullResponse += chunk;
    }

    return fullResponse;
}

// ── Repository Statistics ─────────────────────────────────────

/**
 * Get embedding statistics for a repository
 */
export async function getRepositoryEmbeddingStats(repoId: string) {
    const stats = await prisma.codeChunk.groupBy({
        by: ["fileId"],
        where: {
            file: {
                repositoryId: repoId,
            },
        },
        _count: {
            id: true,
        },
    });

    const totalChunks = stats.reduce((sum: number, s: any) => sum + s._count.id, 0);
    const filesWithEmbeddings = stats.length;

    return {
        totalChunks,
        filesWithEmbeddings,
    };
}
