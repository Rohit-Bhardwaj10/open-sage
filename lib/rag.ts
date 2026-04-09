import { HfInference } from "@huggingface/inference";
import { GoogleGenerativeAI } from "@google/generative-ai";
import prisma from "./prisma";

// ── Configuration ─────────────────────────────────────────────
const HF_TOKEN = process.env.HF_TOKEN || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

const hf = new HfInference(HF_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const EMBEDDING_MODEL = "BAAI/bge-base-en-v1.5";
// const EMBEDDING_MODEL = "google/embeddinggemma-300m:fastest";

// gemini-2.0-flash-lite has a more generous free-tier quota than gemini-2.0-flash
const GEMINI_MODEL = "gemini-3-flash-preview"; // Experimental preview – separate free-tier quota

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
    // TypeScript: unreachable, but satisfies return type
    throw new Error("Retry limit exceeded");
}

// ── Embedding Generation ──────────────────────────────────────

/**
 * Generate embedding for a query using Hugging Face
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
    try {
        const response = await hf.featureExtraction({
            model: EMBEDDING_MODEL,
            inputs: query,
        });

        const embedding = Array.isArray(response) ? response : [response];
        const flatEmbedding = embedding.flat(Infinity) as number[];

        if (flatEmbedding.length !== 768) {
            throw new Error(`Expected 768 dimensions, got ${flatEmbedding.length}`);
        }

        return flatEmbedding;
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
    limit: number = 5
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
      LIMIT ${limit}
    `;

        return results.map((row: {
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
            yield "I couldn't find any relevant code in this repository to answer your question.";
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

        // Stream response from Gemini (with automatic 429 retry)
        const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
        const result = await withRetry(() => model.generateContentStream(prompt));

        for await (const chunk of result.stream) {
            const text = chunk.text();
            yield text;
        }
    } catch (error: any) {
        console.error("Error in RAG query:", error);
        const isQuota = error?.message?.includes("429") || error?.status === 429;
        if (isQuota) {
            yield `\n\n⚠️ **Quota exceeded.** The Gemini API free-tier limit has been reached. Please wait a minute and try again, or upgrade your Google AI plan at https://ai.google.dev/gemini-api/docs/rate-limits.`;
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
