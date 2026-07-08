import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";

/**
 * GET /api/repos/[id]/debug
 * Returns embedding stats for a repo to diagnose "no results" issues.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: repoId } = await params;

  const repo = await prisma.repository.findFirst({
    where: { id: repoId, userId: session.user.id },
    select: {
      id: true,
      name: true,
      cloneStatus: true,
      indexStatus: true,
      indexedFiles: true,
      totalFiles: true,
      cloneError: true,
      indexError: true,
    },
  });

  if (!repo) return NextResponse.json({ error: "Repository not found" }, { status: 404 });

  // Count IndexedFile records for this repo
  const indexedFileCount = await prisma.indexedFile.count({
    where: { repositoryId: repoId },
  });

  // Count CodeChunk records for this repo
  const chunkCountResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "CodeChunk" c
    JOIN "IndexedFile" f ON c."fileId" = f.id
    WHERE f."repositoryId" = ${repoId}
  `;
  const totalChunks = Number(chunkCountResult[0]?.count ?? 0);

  // List files with their chunk counts
  const filesWithChunks = await prisma.$queryRaw<Array<{
    filePath: string;
    language: string | null;
    chunkCount: bigint;
  }>>`
    SELECT f."filePath", f.language, COUNT(c.id) as "chunkCount"
    FROM "IndexedFile" f
    LEFT JOIN "CodeChunk" c ON c."fileId" = f.id
    WHERE f."repositoryId" = ${repoId}
    GROUP BY f.id, f."filePath", f.language
    ORDER BY "chunkCount" DESC
    LIMIT 30
  `;

  const filesWithoutEmbeddings = filesWithChunks.filter(f => Number(f.chunkCount) === 0);

  return NextResponse.json({
    repo,
    stats: {
      indexedFileCount,
      totalChunks,
      filesWithEmbeddings: filesWithChunks.filter(f => Number(f.chunkCount) > 0).length,
      filesWithoutEmbeddings: filesWithoutEmbeddings.length,
    },
    filesWithoutEmbeddings: filesWithoutEmbeddings.map(f => f.filePath),
    topFiles: filesWithChunks.slice(0, 10).map(f => ({
      filePath: f.filePath,
      language: f.language,
      chunkCount: Number(f.chunkCount),
    })),
  });
}
