import { Queue } from "bullmq";
import IORedis from "ioredis";

// ── Redis connection (shared singleton) 
// maxRetriesPerRequest: null is required by BullMQ
export const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

// Typed job payloads 

export interface CloneJobPayload {
  repoId: string;
  url: string;
  userId: string;
}

export interface IndexJobPayload {
  repoId: string;
  userId: string;
  localPath: string;
  forceReindex?: boolean; // skip hash-check and re-embed everything
}

export interface EmbeddingJobPayload {
  repoId: string;
  fileId: string;
  filePath: string;
  localPath: string;
}

// ── Queue names (single source of truth) ─────────────────────
export const QUEUE_NAMES = {
  CLONE: "clone",
  INDEX: "index",
  EMBEDDING: "embedding",
} as const;

// ── Queue instances (lazy singletons) ────────────────────────

let cloneQueue: Queue<CloneJobPayload> | null = null;
let indexQueue: Queue<IndexJobPayload> | null = null;
let embeddingQueue: Queue<EmbeddingJobPayload> | null = null;

export function getCloneQueue(): Queue<CloneJobPayload> {
  if (!cloneQueue) {
    cloneQueue = new Queue<CloneJobPayload>(QUEUE_NAMES.CLONE, {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,                       // retry up to 3 times on failure
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 100 },  // keep last 100 completed jobs
        removeOnFail: { count: 200 },  // keep last 200 failed jobs
      },
    });
  }
  return cloneQueue;
}

export function getIndexQueue(): Queue<IndexJobPayload> {
  if (!indexQueue) {
    indexQueue = new Queue<IndexJobPayload>(QUEUE_NAMES.INDEX, {
      connection: redis,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 10000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return indexQueue;
}

export function getEmbeddingQueue(): Queue<EmbeddingJobPayload> {
  if (!embeddingQueue) {
    embeddingQueue = new Queue<EmbeddingJobPayload>(QUEUE_NAMES.EMBEDDING, {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 15000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return embeddingQueue;
}
