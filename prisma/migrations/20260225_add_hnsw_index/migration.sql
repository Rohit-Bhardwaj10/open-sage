-- AddHNSWVectorIndex
-- Creates an HNSW index on CodeChunk.embedding for fast approximate
-- nearest-neighbour search using cosine distance.
-- Without this, every vector similarity query is a full table scan.

CREATE INDEX IF NOT EXISTS "CodeChunk_embedding_hnsw_idx"
  ON "CodeChunk"
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
