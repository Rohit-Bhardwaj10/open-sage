/**
 * Test script to verify the queue system is working
 * Run: npx tsx scripts/test-queue.ts
 */

import { getCloneQueue } from "../opensage/lib/queue";

async function testQueue() {
    console.log("🧪 Testing Queue System\n");

    const queue = getCloneQueue();

    // Check Redis connection
    console.log("1. Checking Redis connection...");
    const isPaused = await queue.isPaused();
    console.log(`   ✓ Connected (paused: ${isPaused})\n`);

    // Check queue stats
    console.log("2. Checking queue statistics...");
    const counts = await queue.getJobCounts();
    console.log(`   Waiting: ${counts.waiting}`);
    console.log(`   Active: ${counts.active}`);
    console.log(`   Completed: ${counts.completed}`);
    console.log(`   Failed: ${counts.failed}\n`);

    // Check workers
    console.log("3. Checking active workers...");
    const workers = await queue.getWorkers();
    console.log(`   Active workers: ${workers.length}`);
    workers.forEach((w, i) => {
        console.log(`   Worker ${i + 1}: ${w.name} (${w.addr})`);
    });

    if (workers.length === 0) {
        console.log("\n   ⚠️  No workers detected. Make sure to run: npm run worker:clone");
    } else {
        console.log("\n   ✓ Workers are running!");
    }

    process.exit(0);
}

testQueue().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
});
