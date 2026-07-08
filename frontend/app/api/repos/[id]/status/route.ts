import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { getCloneQueue } from "@/lib/queue";

/**
 * GET /api/repos/[id]/status
 *
 * Returns current clone + index status from both:
 * - Postgres (persisted state written by Python worker)
 * - BullMQ  (live queue position / progress if job is active)
 */
export async function GET(
  _req: NextRequest,
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
      cloneError: true,
      indexError: true,
      defaultBranch: true,
      localPath: true,
      totalFiles: true,
      indexedFiles: true,
      updatedAt: true,
    },
  });

  if (!repo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  // Enrich with live BullMQ job state if available
  let jobState: string | null = null;
  let jobProgress: number | null = null;

  try {
    const queue = getCloneQueue();
    const job = await queue.getJob(`clone-${id}`);
    if (job) {
      jobState = await job.getState();
      jobProgress =
        typeof job.progress === "number"
          ? job.progress
          : null;
    }
  } catch {
    // Redis might not be running locally — degrade gracefully
  }

  return NextResponse.json({
    ...repo,
    queue: jobState ? { state: jobState, progress: jobProgress } : null,
  });
}
