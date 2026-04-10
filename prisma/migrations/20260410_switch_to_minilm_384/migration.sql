-- Switch embedding model from BAAI/bge-base-en-v1.5 (768d) to
-- sentence-transformers/all-MiniLM-L6-v2 (384d).
-- Existing 768-dim embeddings are incompatible, so we clear them first.

-- 1. Wipe old embeddings (incompatible dimensions)
UPDATE "CodeChunk" SET embedding = NULL;

-- 2. Drop the old vector column
ALTER TABLE "CodeChunk" DROP COLUMN IF EXISTS embedding;

-- 3. Add the new 384-dim vector column
ALTER TABLE "CodeChunk" ADD COLUMN embedding vector(384);

-- 4. Recreate the HNSW index for the new dimension
DROP INDEX IF EXISTS "CodeChunk_embedding_hnsw_idx";
CREATE INDEX "CodeChunk_embedding_hnsw_idx"
    ON "CodeChunk" USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
