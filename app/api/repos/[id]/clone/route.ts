import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { getCloneQueue, type CloneJobPayload } from "@/lib/queue";

/**
 * POST /api/repos/[id]/clone
 *
 * Enqueues a clone job to Redis (BullMQ). Returns 202 immediately.
 * The actual git clone is done by the Python worker that consumes the queue.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify repo belongs to this user
  const repo = await prisma.repository.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      url: true,
      cloneStatus: true,
    },
  });

  if (!repo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  if (repo.cloneStatus === "CLONING") {
    return NextResponse.json(
      { error: "Clone already in progress" },
      { status: 409 }
    );
  }

  if (repo.cloneStatus === "CLONED") {
    return NextResponse.json(
      { message: "Repository already cloned" },
      { status: 200 }
    );
  }

  // Reset any previous failure state
  await prisma.repository.update({
    where: { id },
    data: {
      cloneStatus: "PENDING",
      cloneError: null,
    },
  });

  // Enqueue — the worker picks this up and does the actual git clone
  const payload: CloneJobPayload = {
    repoId: repo.id,
    url: repo.url,
    userId: session.user.id,
  };

  const queue = getCloneQueue();
  const job = await queue.add("clone-repo", payload, {
    jobId: `clone-${repo.id}`, // dedup: only one active job per repo
  });

  return NextResponse.json(
    {
      message: "Clone job queued",
      jobId: job.id,
      repoId: repo.id,
    },
    { status: 202 }
  );
}
