import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { getIndexQueue, type IndexJobPayload } from "@/lib/queue";

/**
 * POST /api/repos/[id]/index
 *
 * Enqueues (or re-enqueues) an index job for a repository that has
 * already been cloned. Useful to retry a failed indexing, or force
 * a full re-index after we push embedding model changes.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const repo = await prisma.repository.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      cloneStatus: true,
      indexStatus: true,
      localPath: true,
    },
  });

  if (!repo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  if (repo.cloneStatus !== "CLONED") {
    return NextResponse.json(
      { error: "Repository must be cloned before it can be indexed" },
      { status: 422 }
    );
  }

  if (!repo.localPath) {
    return NextResponse.json(
      { error: "No local clone path found. Please re-clone the repository." },
      { status: 422 }
    );
  }

  if (repo.indexStatus === "INDEXING") {
    return NextResponse.json(
      { error: "Indexing already in progress" },
      { status: 409 }
    );
  }

  // Read forceReindex flag from body (optional)
  let forceReindex = false;
  try {
    const body = await req.json();
    forceReindex = body?.forceReindex === true;
  } catch {
    // body is optional
  }

  // Reset status so the UI reflects we're retrying
  await prisma.repository.update({
    where: { id },
    data: {
      indexStatus: "PENDING",
      indexError: null,
    },
  });

  const payload: IndexJobPayload = {
    repoId: repo.id,
    userId: session.user.id,
    localPath: repo.localPath,
    forceReindex,
  };

  const queue = getIndexQueue();
  const job = await queue.add("index-repo", payload, {
    jobId: `index-${repo.id}`, // dedup: only one active job per repo
  });

  return NextResponse.json(
    {
      message: "Index job queued",
      jobId: job.id,
      repoId: repo.id,
      forceReindex,
    },
    { status: 202 }
  );
}
