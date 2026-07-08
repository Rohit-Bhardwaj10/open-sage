import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";

// GET /api/repos — list all repos for the current user
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const repos = await prisma.repository.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(repos);
}

// POST /api/repos — create a new repo entry
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { url } = body;

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "A repository URL is required" }, { status: 400 });
  }

  // Normalise and parse the GitHub URL
  const trimmed = url.trim().replace(/\.git$/, "");
  const match = trimmed.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/.*)?$/
  );

  if (!match) {
    return NextResponse.json(
      { error: "Please enter a valid GitHub repository URL (e.g. https://github.com/owner/repo)" },
      { status: 400 }
    );
  }

  const [, owner, repoName] = match;
  const cleanUrl = `https://github.com/${owner}/${repoName}`;

  // Check for duplicates
  const existing = await prisma.repository.findFirst({
    where: { userId: session.user.id, url: cleanUrl },
  });

  if (existing) {
    return NextResponse.json(
      { error: "You have already added this repository" },
      { status: 409 }
    );
  }

  const repo = await prisma.repository.create({
    data: {
      name: `${owner}/${repoName}`,
      url: cleanUrl,
      userId: session.user.id,
    },
  });

  return NextResponse.json(repo, { status: 201 });
}
