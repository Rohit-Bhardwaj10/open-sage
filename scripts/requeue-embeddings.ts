import "dotenv/config";
import prisma from "../lib/prisma";
import { getEmbeddingQueue } from "../lib/queue";
import path from "path";

/**
 * Re-queues embedding jobs for all indexed files that have no chunks yet.
 * Run this when the embedding worker wasn't running when files were indexed.
 *
 * Usage: npx tsx scripts/requeue-embeddings.ts [repoId?]
 */

async function main() {
  const targetRepoId = process.argv[2] ?? undefined;

  const where = {
    chunkCount: 0,
    ...(targetRepoId ? { repositoryId: targetRepoId } : {}),
  };

  const files = await prisma.indexedFile.findMany({
    where,
    include: { repository: true },
  });

  if (files.length === 0) {
    console.log("✅ No files need re-queuing (all have chunks already).");
    process.exit(0);
  }

  console.log(`📋 Found ${files.length} files with 0 chunks — re-queuing embeddings...`);

  const embeddingQueue = getEmbeddingQueue();
  const CLONES_DIR = process.env.CLONES_DIR ?? ".clones";

  let queued = 0;
  for (const file of files) {
    // Reconstruct the local path the same way clone-worker does
    const localPath = path.join(
      process.cwd(),
      CLONES_DIR,
      file.repositoryId,
      file.filePath
    );

    await embeddingQueue.add(
      `embed-${file.id}`,
      {
        repoId: file.repositoryId,
        fileId: file.id,
        filePath: file.filePath,
        localPath,
      },
      {
        priority: 1,
        // remove duplicate jobs if they already exist
        jobId: `embed-${file.id}`,
      }
    );
    queued++;
    process.stdout.write(`\r  Queued ${queued}/${files.length}...`);
  }

  console.log(`\n✅ Done! ${queued} embedding jobs added to queue.`);
  console.log(`   Make sure "npm run worker:embedding" (or worker:all) is running.`);

  await embeddingQueue.close();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
