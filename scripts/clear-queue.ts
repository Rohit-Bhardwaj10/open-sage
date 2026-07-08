import "dotenv/config";
import { Queue } from "bullmq";
import { redis, QUEUE_NAMES } from "../opensage/lib/queue";

async function clearQueue() {
    const cloneQueue = new Queue(QUEUE_NAMES.CLONE, { connection: redis });
    const indexQueue = new Queue(QUEUE_NAMES.INDEX, { connection: redis });

    console.log("🧹 Clearing queues...\n");

    // Clear clone queue
    const cloneFailed = await cloneQueue.getFailed();
    console.log(`Removing ${cloneFailed.length} failed clone jobs...`);
    for (const job of cloneFailed) {
        await job.remove();
    }

    const cloneCompleted = await cloneQueue.getCompleted();
    console.log(`Removing ${cloneCompleted.length} completed clone jobs...`);
    for (const job of cloneCompleted) {
        await job.remove();
    }

    // Clear index queue
    const indexFailed = await indexQueue.getFailed();
    console.log(`Removing ${indexFailed.length} failed index jobs...`);
    for (const job of indexFailed) {
        await job.remove();
    }

    const indexCompleted = await indexQueue.getCompleted();
    console.log(`Removing ${indexCompleted.length} completed index jobs...`);
    for (const job of indexCompleted) {
        await job.remove();
    }

    console.log("\n✅ Queues cleared!");

    await redis.quit();
    process.exit(0);
}

clearQueue().catch((err) => {
    console.error("Error clearing queues:", err);
    process.exit(1);
});
