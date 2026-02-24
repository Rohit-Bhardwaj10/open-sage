-- Enable pgvector extension first
CREATE EXTENSION IF NOT EXISTS vector;

-- AlterTable
ALTER TABLE "IndexedFile" ADD COLUMN     "fileSize" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CodeChunk" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "startLine" INTEGER NOT NULL,
    "endLine" INTEGER NOT NULL,
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CodeChunk_fileId_idx" ON "CodeChunk"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "CodeChunk_fileId_chunkIndex_key" ON "CodeChunk"("fileId", "chunkIndex");

-- AddForeignKey
ALTER TABLE "CodeChunk" ADD CONSTRAINT "CodeChunk_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "IndexedFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;