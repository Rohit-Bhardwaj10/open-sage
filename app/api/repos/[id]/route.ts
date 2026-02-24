import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { getCloneQueue } from "@/lib/queue";

/**
 * DELETE /api/repos/[id]
 * Remove a repository record (does not delete the local clone — worker handles cleanup)
 */
export async function DELETE(
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
  });

  if (!repo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  // Remove pending clone job from queue if it exists
  try {
    const cloneQueue = getCloneQueue();
    const job = await cloneQueue.getJob(`clone-${id}`);
    if (job) {
      await job.remove();
      console.log(`[API] Removed pending clone job for repo ${id}`);
    }
  } catch (error) {
    console.warn(`[API] Failed to remove clone job for repo ${id}:`, error);
    // Continue with deletion even if job removal fails
  }

  await prisma.repository.delete({ where: { id } });

  return NextResponse.json({ message: "Repository removed" }, { status: 200 });
}
