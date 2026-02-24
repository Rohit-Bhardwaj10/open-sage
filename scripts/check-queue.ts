import "dotenv/config";
import { Queue } from "bullmq";
import { redis, QUEUE_NAMES } from "../lib/queue";

async function checkQueues() {
    const cloneQueue = new Queue(QUEUE_NAMES.CLONE, { connection: redis });
    const indexQueue = new Queue(QUEUE_NAMES.INDEX, { connection: redis });

    console.log("📊 Queue Status\n");

    // Clone Queue
    console.log("🔄 Clone Queue:");
    const cloneCounts = await cloneQueue.getJobCounts();
    console.log("  Waiting:", cloneCounts.waiting);
    console.log("  Active:", cloneCounts.active);
    console.log("  Completed:", cloneCounts.completed);
    console.log("  Failed:", cloneCounts.failed);
    console.log("  Delayed:", cloneCounts.delayed);

    // Get waiting jobs
    const cloneWaiting = await cloneQueue.getWaiting();
    if (cloneWaiting.length > 0) {
        console.log("\n  Waiting jobs:");
        for (const job of cloneWaiting) {
            console.log(`    - Job ${job.id}: repoId=${job.data.repoId}`);
        }
    }

    // Get active jobs
    const cloneActive = await cloneQueue.getActive();
    if (cloneActive.length > 0) {
        console.log("\n  Active jobs:");
        for (const job of cloneActive) {
            console.log(`    - Job ${job.id}: repoId=${job.data.repoId}`);
        }
    }

    // Get failed jobs
    const cloneFailed = await cloneQueue.getFailed();
    if (cloneFailed.length > 0) {
        console.log("\n  Failed jobs (last 5):");
        for (const job of cloneFailed.slice(0, 5)) {
            console.log(`    - Job ${job.id}: repoId=${job.data.repoId}`);
            console.log(`      Error: ${job.failedReason}`);
        }
    }

    console.log("\n📑 Index Queue:");
    const indexCounts = await indexQueue.getJobCounts();
    console.log("  Waiting:", indexCounts.waiting);
    console.log("  Active:", indexCounts.active);
    console.log("  Completed:", indexCounts.completed);
    console.log("  Failed:", indexCounts.failed);
    console.log("  Delayed:", indexCounts.delayed);

    // Get waiting jobs
    const indexWaiting = await indexQueue.getWaiting();
    if (indexWaiting.length > 0) {
        console.log("\n  Waiting jobs:");
        for (const job of indexWaiting) {
            console.log(`    - Job ${job.id}: repoId=${job.data.repoId}`);
        }
    }

    await redis.quit();
    process.exit(0);
}

checkQueues().catch((err) => {
    console.error("Error checking queues:", err);
    process.exit(1);
});
