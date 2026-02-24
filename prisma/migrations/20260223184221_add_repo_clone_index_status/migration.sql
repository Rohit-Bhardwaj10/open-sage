-- CreateEnum
CREATE TYPE "CloneStatus" AS ENUM ('PENDING', 'CLONING', 'CLONED', 'FAILED');

-- CreateEnum
CREATE TYPE "IndexStatus" AS ENUM ('PENDING', 'INDEXING', 'INDEXED', 'FAILED');

-- AlterTable
ALTER TABLE "Repository" ADD COLUMN     "cloneError" TEXT,
ADD COLUMN     "cloneStatus" "CloneStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "defaultBranch" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "indexStatus" "IndexStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "localPath" TEXT;
