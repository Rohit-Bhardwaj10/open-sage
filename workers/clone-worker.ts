import "dotenv/config";
import { Worker, Job } from "bullmq";
import { exec } from "child_process";
import { promisify } from "util";
import { mkdir, rm, access } from "fs/promises";
import path from "path";
import prisma from "../lib/prisma";
import { redis, QUEUE_NAMES, type CloneJobPayload, getIndexQueue } from "../lib/queue";

const execAsync = promisify(exec);

// ── Configuration ─────────────────────────────────────────────
const CLONES_DIR = process.env.CLONES_DIR || path.join(process.cwd(), ".clones");

// ── Clone Job Processor ───────────────────────────────────────
async function processCloneJob(job: Job<CloneJobPayload>) {
    const { repoId, url, userId } = job.data;

    console.log(`[Clone Worker] Processing job ${job.id} for repo ${repoId}`);

    try {
        // Check if repository still exists (it might have been deleted)
        const repo = await prisma.repository.findUnique({
            where: { id: repoId },
        });

        if (!repo) {
            console.log(`[Clone Worker] ⚠ Repository ${repoId} no longer exists. Skipping job.`);
            return { success: false, reason: "Repository deleted" };
        }

        // Update status to CLONING
        await prisma.repository.update({
            where: { id: repoId },
            data: { cloneStatus: "CLONING", cloneError: null },
        });

        // Ensure clones directory exists
        await mkdir(CLONES_DIR, { recursive: true });

        // Generate local path: .clones/userId/repoId
        const localPath = path.join(CLONES_DIR, userId, repoId);

        // Extract repo name for logging
        const repoName = url.split("/").slice(-2).join("/").replace(".git", "");

        console.log(`[Clone Worker] Cloning ${repoName} to ${localPath}`);

        // Update progress
        await job.updateProgress(25);

        // Clean up any previous failed/partial clone before retrying
        try {
            await access(localPath);
            console.log(`[Clone Worker] Removing stale clone directory: ${localPath}`);
            await rm(localPath, { recursive: true, force: true });
        } catch {
            // Directory doesn't exist — that's fine
        }

        // Enable long path support for this git operation
        await execAsync("git config --global core.longpaths true").catch(() => {});

        // Git clone with depth=1 for faster cloning
        const cloneCommand = `git clone --depth 1 "${url}" "${localPath}"`;
        let cloneStderr = "";
        try {
            const { stdout, stderr } = await execAsync(cloneCommand, {
                timeout: 300000, // 5 min timeout
            });
            cloneStderr = stderr || "";
        } catch (cloneError: any) {
            // git clone exited non-zero — clean up partial clone and rethrow
            await rm(localPath, { recursive: true, force: true }).catch(() => {});
            throw cloneError;
        }

        // Detect partial checkout failure (e.g. Windows "Filename too long")
        if (
            cloneStderr.includes("checkout failed") ||
            cloneStderr.includes("Filename too long") ||
            cloneStderr.includes("unable to create file")
        ) {
            await rm(localPath, { recursive: true, force: true }).catch(() => {});
            throw new Error(
                `Git clone succeeded but checkout failed (likely Windows long path limit). ` +
                `Run: git config --global core.longpaths true  and enable LongPathsEnabled in Windows registry. ` +
                `Details: ${cloneStderr.slice(0, 500)}`
            );
        }

        if (cloneStderr && !cloneStderr.includes("Cloning into")) {
            console.warn(`[Clone Worker] Git stderr: ${cloneStderr}`);
        }

        await job.updateProgress(75);

        // Get default branch and basic info
        const branchCommand = `cd "${localPath}" && git rev-parse --abbrev-ref HEAD`;
        const { stdout: branch } = await execAsync(branchCommand);
        const defaultBranch = branch.trim();

        // Count files (simple approach)
        const countCommand = process.platform === "win32"
            ? `powershell -Command "(Get-ChildItem -Path '${localPath}' -Recurse -File | Measure-Object).Count"`
            : `find "${localPath}" -type f | wc -l`;

        const { stdout: fileCount } = await execAsync(countCommand).catch(() => ({ stdout: "0" }));
        const totalFiles = parseInt(fileCount.trim()) || 0;

        await job.updateProgress(90);

        // Update database with success
        await prisma.repository.update({
            where: { id: repoId },
            data: {
                cloneStatus: "CLONED",
                localPath,
                defaultBranch,
                totalFiles,
                cloneError: null,
            },
        });

        await job.updateProgress(100);

        console.log(`[Clone Worker] ✓ Successfully cloned ${repoName} (${totalFiles} files)`);

        // Automatically trigger indexing after successful clone
        const indexQueue = getIndexQueue();
        await indexQueue.add(
            "index-repo",
            { repoId, userId, localPath, forceReindex: false },
            { jobId: `index-${repoId}` }
        );
        console.log(`[Clone Worker] → Triggered indexing for repo ${repoId}`);

        return { success: true, localPath, totalFiles };
    } catch (error: any) {
        console.error(`[Clone Worker] ✗ Failed to clone repo ${repoId}:`, error.message);

        // Try to update database with failure (repo might have been deleted)
        try {
            await prisma.repository.update({
                where: { id: repoId },
                data: {
                    cloneStatus: "FAILED",
                    cloneError: error.message || "Unknown error during git clone",
                },
            });
        } catch (updateError: any) {
            if (updateError.code === "P2025") {
                console.log(`[Clone Worker] ⚠ Repository ${repoId} was deleted, skipping error update.`);
                return { success: false, reason: "Repository deleted during clone" };
            }
            throw updateError;
        }

        throw error; // BullMQ will mark job as failed
    }
}

// ── Worker Instance ───────────────────────────────────────────
const cloneWorker = new Worker<CloneJobPayload>(
    QUEUE_NAMES.CLONE,
    processCloneJob,
    {
        connection: redis,
        concurrency: 2, // Process 2 clones at a time
        limiter: {
            max: 5,       // Max 5 jobs
            duration: 60000, // per minute (rate limiting)
        },
    }
);

// ── Event Handlers ────────────────────────────────────────────
cloneWorker.on("completed", (job) => {
    console.log(`[Clone Worker] Job ${job.id} completed`);
});

cloneWorker.on("failed", (job, err) => {
    console.error(`[Clone Worker] Job ${job?.id} failed:`, err.message);
});

cloneWorker.on("error", (err) => {
    console.error("[Clone Worker] Worker error:", err);
});

// ── Graceful Shutdown ─────────────────────────────────────────
process.on("SIGTERM", async () => {
    console.log("[Clone Worker] Shutting down gracefully...");
    await cloneWorker.close();
    process.exit(0);
});

process.on("SIGINT", async () => {
    console.log("[Clone Worker] Shutting down gracefully...");
    await cloneWorker.close();
    process.exit(0);
});

console.log("[Clone Worker] 🚀 Started and waiting for jobs...");
