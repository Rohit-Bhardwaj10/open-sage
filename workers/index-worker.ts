import "dotenv/config";
import { Worker, Job } from "bullmq";
import { readdir, readFile } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { stat } from "fs/promises";
import prisma from "../lib/prisma";
import { redis, QUEUE_NAMES, getEmbeddingQueue, type IndexJobPayload } from "../lib/queue";

// ── Configuration ─────────────────────────────────────────────
const SUPPORTED_EXTENSIONS = new Set([
    ".js", ".jsx", ".ts", ".tsx",
    ".py", ".java", ".go", ".rs",
    ".c", ".cpp", ".h", ".hpp",
    ".rb", ".php", ".swift", ".kt",
    ".cs", ".sql", ".sh", ".bash",
    ".yaml", ".yml", ".json", ".md",
]);

const IGNORED_DIRS = new Set([
    "node_modules", ".git", ".next", "dist", "build",
    "__pycache__", "venv", ".venv", "target", "bin", "obj",
]);

// ── Helper Functions ──────────────────────────────────────────

function detectLanguage(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    const langMap: Record<string, string> = {
        ".js": "javascript", ".jsx": "javascript",
        ".ts": "typescript", ".tsx": "typescript",
        ".py": "python", ".java": "java",
        ".go": "go", ".rs": "rust",
        ".rb": "ruby", ".php": "php",
        ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp",
        ".swift": "swift", ".kt": "kotlin", ".cs": "csharp",
        ".sql": "sql", ".sh": "bash", ".bash": "bash",
        ".yaml": "yaml", ".yml": "yaml",
        ".json": "json", ".md": "markdown",
    };
    return langMap[ext] || null;
}

function computeHash(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex");
}

async function scanDirectory(
    dir: string,
    baseDir: string,
    job: Job
): Promise<string[]> {
    const files: string[] = [];

    try {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (!IGNORED_DIRS.has(entry.name)) {
                    const subFiles = await scanDirectory(fullPath, baseDir, job);
                    files.push(...subFiles);
                }
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (SUPPORTED_EXTENSIONS.has(ext)) {
                    files.push(fullPath);
                }
            }
        }
    } catch (error: any) {
        console.warn(`[Index Worker] Error scanning ${dir}:`, error.message);
    }

    return files;
}

// ── Index Job Processor ───────────────────────────────────────
async function processIndexJob(job: Job<IndexJobPayload>) {
    const { repoId, userId, localPath, forceReindex } = job.data;

    console.log(`[Index Worker] Processing job ${job.id} for repo ${repoId}`);

    try {
        // Update status to INDEXING
        await prisma.repository.update({
            where: { id: repoId },
            data: {
                indexStatus: "INDEXING",
                indexError: null,
                indexedFiles: 0,
            },
        });

        await job.updateProgress(10);

        // Scan directory for code files
        console.log(`[Index Worker] Scanning ${localPath}...`);
        const files = await scanDirectory(localPath, localPath, job);

        console.log(`[Index Worker] Found ${files.length} files to index`);

        await job.updateProgress(25);

        // Process files in batches
        const BATCH_SIZE = 50;
        let processedCount = 0;

        for (let i = 0; i < files.length; i += BATCH_SIZE) {
            const batch = files.slice(i, i + BATCH_SIZE);

            await Promise.all(
                batch.map(async (filePath) => {
                    try {
                        const content = await readFile(filePath, "utf-8");
                        const relativePath = path.relative(localPath, filePath);
                        const language = detectLanguage(filePath);
                        const contentHash = computeHash(content);

                        // Check if file already indexed with same hash
                        const existing = await prisma.indexedFile.findUnique({
                            where: {
                                repositoryId_filePath: {
                                    repositoryId: repoId,
                                    filePath: relativePath,
                                },
                            },
                        });

                        if (!forceReindex && existing?.contentHash === contentHash) {
                            // Skip unchanged file
                            return;
                        }

                        // Get file size
                        const stats = await stat(filePath);
                        const fileSize = stats.size;

                        // Upsert indexed file record
                        const indexedFile = await prisma.indexedFile.upsert({
                            where: {
                                repositoryId_filePath: {
                                    repositoryId: repoId,
                                    filePath: relativePath,
                                },
                            },
                            create: {
                                repositoryId: repoId,
                                filePath: relativePath,
                                language,
                                contentHash,
                                fileSize,
                                chunkCount: 0, // Will be updated when embeddings are generated
                                tokenCount: 0,
                            },
                            update: {
                                language,
                                contentHash,
                                fileSize,
                                indexedAt: new Date(),
                            },
                        });

                        // Queue embedding job for this file
                        const embeddingQueue = getEmbeddingQueue();
                        await embeddingQueue.add(
                            `embed-${indexedFile.id}`,
                            {
                                repoId,
                                fileId: indexedFile.id,
                                filePath: relativePath,
                                localPath: filePath,
                            },
                            {
                                priority: 1,
                            }
                        );

                        processedCount++;
                    } catch (error: any) {
                        console.warn(`[Index Worker] Error processing ${filePath}:`, error.message);
                    }
                })
            );

            // Update progress
            const progress = 25 + Math.floor((processedCount / files.length) * 70);
            await job.updateProgress(progress);

            // Update DB with current count
            await prisma.repository.update({
                where: { id: repoId },
                data: { indexedFiles: processedCount },
            });
        }

        await job.updateProgress(95);

        // Mark as indexed
        await prisma.repository.update({
            where: { id: repoId },
            data: {
                indexStatus: "INDEXED",
                indexedFiles: processedCount,
                totalFiles: files.length,
                indexError: null,
            },
        });

        await job.updateProgress(100);

        console.log(`[Index Worker] ✓ Successfully indexed ${processedCount} files for repo ${repoId}`);

        return { success: true, indexedFiles: processedCount };
    } catch (error: any) {
        console.error(`[Index Worker] ✗ Failed to index repo ${repoId}:`, error.message);

        // Update database with failure
        await prisma.repository.update({
            where: { id: repoId },
            data: {
                indexStatus: "FAILED",
                indexError: error.message || "Unknown error during indexing",
            },
        });

        throw error;
    }
}

// ── Worker Instance ───────────────────────────────────────────
const indexWorker = new Worker<IndexJobPayload>(
    QUEUE_NAMES.INDEX,
    processIndexJob,
    {
        connection: redis,
        concurrency: 3, // Process 3 indexes at a time
    }
);

// ── Event Handlers ────────────────────────────────────────────
indexWorker.on("completed", (job) => {
    console.log(`[Index Worker] Job ${job.id} completed`);
});

indexWorker.on("failed", (job, err) => {
    console.error(`[Index Worker] Job ${job?.id} failed:`, err.message);
});

indexWorker.on("error", (err) => {
    console.error("[Index Worker] Worker error:", err);
});

// ── Graceful Shutdown ─────────────────────────────────────────
process.on("SIGTERM", async () => {
    console.log("[Index Worker] Shutting down gracefully...");
    await indexWorker.close();
    process.exit(0);
});

process.on("SIGINT", async () => {
    console.log("[Index Worker] Shutting down gracefully...");
    await indexWorker.close();
    process.exit(0);
});

console.log("[Index Worker] 🚀 Started and waiting for jobs...");
