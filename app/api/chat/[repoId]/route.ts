import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { queryRepositoryStream, findSimilarChunks, generateQueryEmbedding } from "@/lib/rag";

/*
 * GET /api/chat/[repoId]
 * Returns chat history for a repo
 *
 * POST /api/chat/[repoId]
 * Sends a question — streams RAG response using vector search + Gemini
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { repoId } = await params;

  // Verify repo ownership
  const repo = await prisma.repository.findFirst({
    where: { id: repoId, userId: session.user.id },
    select: { id: true },
  });
  if (!repo) return NextResponse.json({ error: "Repository not found" }, { status: 404 });

  const messages = await prisma.chatMessage.findMany({
    where: { repositoryId: repoId, userId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      content: true,
      sources: true,
      confidence: true,
      createdAt: true,
    },
  });

  return NextResponse.json(messages);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { repoId } = await params;
  const body = await req.json();
  const { question } = body;

  if (!question?.trim()) {
    return NextResponse.json({ error: "Question is required" }, { status: 400 });
  }

  // Verify repo ownership + index status
  const repo = await prisma.repository.findFirst({
    where: { id: repoId, userId: session.user.id },
    select: { id: true, indexStatus: true },
  });
  if (!repo) return NextResponse.json({ error: "Repository not found" }, { status: 404 });

  if (repo.indexStatus !== "INDEXED") {
    return NextResponse.json(
      { error: "Repository is not indexed yet. Please wait for indexing to complete." },
      { status: 422 }
    );
  }

  // Save user message
  const userMessage = await prisma.chatMessage.create({
    data: {
      repositoryId: repoId,
      userId: session.user.id,
      role: "USER",
      content: question.trim(),
    },
  });

  // Get recent conversation history (last 5 messages for context)
  const recentMessages = await prisma.chatMessage.findMany({
    where: {
      repositoryId: repoId,
      userId: session.user.id,
      id: { not: userMessage.id },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { role: true, content: true },
  });

  const conversationHistory = recentMessages
    .reverse()
    .map((msg) => ({
      role: msg.role === "USER" ? "user" as const : "assistant" as const,
      content: msg.content,
    }));

  // Stream RAG response
  const encoder = new TextEncoder();
  let fullResponse = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of queryRepositoryStream(
          repoId,
          question.trim(),
          conversationHistory
        )) {
          fullResponse += chunk;
          controller.enqueue(encoder.encode(chunk));
        }

        // Build sources from a quick vector search (same query, same model)
        let sources: Array<{
          file: string;
          lineStart: number;
          lineEnd: number;
          snippet: string;
          score: number;
        }> = [];

        try {
          const queryEmbedding = await generateQueryEmbedding(question.trim());
          const similar = await findSimilarChunks(repoId, queryEmbedding, 5);
          sources = similar
            .filter((s) => s.similarity > 0.3) // only meaningful matches
            .map((s) => ({
              file: s.file.filePath,
              lineStart: s.chunk.startLine,
              lineEnd: s.chunk.endLine,
              snippet: s.chunk.content.slice(0, 300),
              score: s.similarity,
            }));
        } catch {
          // Sources are optional — don't fail the request
        }

        // Save assistant response after streaming completes
        await prisma.chatMessage.create({
          data: {
            repositoryId: repoId,
            userId: session.user.id,
            role: "ASSISTANT",
            content: fullResponse,
            sources: sources.length > 0 ? (sources as any) : [],
            confidence: sources.length > 0
              ? sources.reduce((acc, s) => acc + s.score, 0) / sources.length
              : null,
          },
        });

        controller.close();
      } catch (error: any) {
        console.error("Error in chat stream:", error);
        const errorMsg = `Error: ${error.message || "Failed to generate response"}`;
        controller.enqueue(encoder.encode(errorMsg));
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { repoId } = await params;

  await prisma.chatMessage.deleteMany({
    where: { repositoryId: repoId, userId: session.user.id },
  });

  return NextResponse.json({ message: "Chat history cleared" });
}