import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import prisma from "./prisma";

// ── Configuration ─────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const groq = new Groq({ apiKey: GROQ_API_KEY });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Must match the model used in embedding-worker.ts exactly
const EMBEDDING_MODEL = "text-embedding-004";
const EMBEDDING_DIMS = 768;

const GROQ_MODEL = "llama-3.1-70b-versatile";

function isOverviewQuery(query: string): boolean {
    const lower = query.toLowerCase();
    const overviewPatterns = [
        "what does", "explain", "overview", "summary",
        "what is", "how does it work", "architecture",
        "folder structure", "project structure", "what is this",
    ];
    return overviewPatterns.some((p) => lower.includes(p));
}

/**
 * Generate embedding for a query using Gemini API (text-embedding-004, 768 dims)
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
    try {
        const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
        const result = await embeddingModel.embedContent({
            content: { parts: [{ text: query }], role: "user" },
            taskType: "RETRIEVAL_QUERY" as any,
        });
        const flat = result.embedding.values;
        if (flat.length !== EMBEDDING_DIMS) {
            throw new Error(`Expected ${EMBEDDING_DIMS} dimensions, got ${flat.length}`);
        }
        return flat;
    } catch (error) {
        console.error("Error generating query embedding:", error);
        throw error;
    }
}


/**
 * Find similar code chunks using pgvector similarity search
 */
export async function findSimilarChunks(
    repoId: string,
    queryEmbedding: number[],
    limit: number = 15,
    minSimilarity: number = 0.2
): Promise<Array<{
    chunk: any;
    similarity: number;
    file: any;
}>> {
    try {
        const embeddingStr = `[${queryEmbedding.join(",")}]`;

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
            const topSims = results.slice(0, 15).map(r => Number(r.similarity).toFixed(3));
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


/**
 * Query the repository with RAG and stream the response
 */
/**
 * Fetch high-value overview context: README, manifests, config files, and a
 * breadth-first sample of the file tree. Used when the query is too broad for
 * pure vector search.
 */
async function fetchOverviewContext(repoId: string): Promise<string> {
    // Priority file patterns (checked in order)
    const PRIORITY_PATTERNS = [
        // Documentation
        "%readme%",
        "%CHANGELOG%",
        "%CONTRIBUTING%",
        "%LICENSE%",
        "%docs%/%.md",
        // Manifests / config
        "%package.json",
        "%composer.json",
        "%Cargo.toml",
        "%pyproject.toml",
        "%setup.py",
        "%go.mod",
        "%pom.xml",
        "%build.gradle%",
        // Entry points
        "%/index.ts",
        "%/index.js",
        "%/main.ts",
        "%/main.py",
        "%/app.ts",
        "%/app.js",
        "%/server.ts",
        "%/server.js",
        "%/routes%",
        "%/api%",
    ];

    const collected: Array<{ filePath: string; content: string; lang: string | null }> = [];
    const seenFiles = new Set<string>();

    // 1. Fetch priority files by path pattern
    for (const pattern of PRIORITY_PATTERNS) {
        if (collected.length >= 12) break; // cap to avoid token overload
        const rows = await prisma.$queryRaw<Array<{ filePath: string; content: string; language: string | null }>>`
            SELECT f."filePath", c.content, f.language
            FROM "CodeChunk" c
            JOIN "IndexedFile" f ON c."fileId" = f.id
            WHERE f."repositoryId" = ${repoId}
              AND LOWER(f."filePath") LIKE LOWER(${pattern})
              AND c."chunkIndex" = 0
            ORDER BY f."filePath"
            LIMIT 3
        `;
        for (const row of rows) {
            if (!seenFiles.has(row.filePath)) {
                seenFiles.add(row.filePath);
                collected.push({ filePath: row.filePath, content: row.content, lang: row.language });
            }
        }
    }

    // 2. If we still have room, sample the top-level file names (gives LLM project structure cues)
    const fileList = await prisma.$queryRaw<Array<{ filePath: string; language: string | null }>>`
        SELECT f."filePath", f.language
        FROM "IndexedFile" f
        WHERE f."repositoryId" = ${repoId}
        ORDER BY LENGTH(f."filePath") ASC
        LIMIT 60
    `;

    const fileTree = fileList.map((f) => f.filePath).join("\n");

    let context = `=== Repository File Tree (top 60 shortest paths) ===\n${fileTree}\n\n`;

    for (const { filePath, content, lang } of collected) {
        context += `=== ${filePath} ===\n\`\`\`${lang || "text"}\n${content.slice(0, 2000)}\n\`\`\`\n\n`;
    }

    console.log(`[RAG] Overview context: ${collected.length} high-value files + file tree (${fileList.length} paths)`);
    return context;
}

export async function* queryRepositoryStream(
    repoId: string,
    userQuery: string,
    conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = []
): AsyncGenerator<string, void, unknown> {
    try {
        const overview = isOverviewQuery(userQuery);
        yield "Searching repository...\n\n";

        // Check if *any* chunks exist first
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
            return;
        }

        let context = "";

        if (overview) {
            // ── Overview strategy: fetch docs + file tree directly ───────
            console.log(`[RAG] Detected overview query — using document-fetch strategy`);
            yield "Gathering project overview...\n\n";
            context = await fetchOverviewContext(repoId);

            // Supplement with a broad vector search (low threshold, high limit)
            const queryEmbedding = await generateQueryEmbedding(userQuery);
            const vectorChunks = await findSimilarChunks(repoId, queryEmbedding, 10, 0.05);
            if (vectorChunks.length > 0) {
                context += "\n=== Additional Relevant Chunks (vector search) ===\n";
                context += buildContext(vectorChunks.slice(0, 5));
            }
        } else {
            // ── Specific query strategy: pure vector search ───────────────
            const queryEmbedding = await generateQueryEmbedding(userQuery);
            const similarChunks = await findSimilarChunks(repoId, queryEmbedding, 15);

            if (similarChunks.length === 0) {
                yield `I couldn't find any relevant code in this repository to answer your question. ` +
                      `(${total} chunks are indexed — try rephrasing your question.)`;
                return;
            }
            context = buildContext(similarChunks);
        }

        yield "Found relevant code. Generating response...\n\n";

        // Build conversation history
        const history = conversationHistory
            .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
            .join("\n\n");

        // Tailor system prompt based on query type
        const systemInstructions = overview
            ? `You are analyzing a large software repository. Based on the file tree and documentation provided:
- Produce a comprehensive, well-structured list of features and use cases
- Infer features from file names, folder structure, README content, and manifests
- Group related features into categories
- Be thorough — the user wants a complete picture
- Use bullet points and headers for readability`
            : `You are a helpful AI assistant analyzing a code repository. Answer the user's question based on the provided code context.
- Be specific and reference file paths when relevant
- If the context doesn't contain enough information, say so
- Provide code examples when helpful
- Be concise but thorough`;

        const prompt = `${systemInstructions}

${history ? `Previous conversation:\n${history}\n\n` : ""}Context from repository:
${context}

User question: ${userQuery}`;

        // Stream response from Groq
        const stream = await groq.chat.completions.create({
            model: GROQ_MODEL,
            messages: [{ role: "user", content: prompt }],
            stream: true,
            max_tokens: overview ? 2048 : 1024,
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
