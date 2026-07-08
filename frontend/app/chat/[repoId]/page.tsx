"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────

interface Source {
  file: string;
  lineStart: number;
  lineEnd: number;
  snippet: string;
  score: number;
}

interface Message {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  sources?: Source[] | null;
  confidence?: number | null;
  createdAt: string;
}

interface RepoInfo {
  id: string;
  name: string;
  url: string;
  indexStatus: string;
  totalFiles?: number;
  indexedFiles?: number;
  defaultBranch?: string;
}

const KEYWORDS = /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|class|extends|import|export|from|default|async|await|typeof|instanceof|in|of|void|delete|null|undefined|true|false|this|super|static|get|set|yield|try|catch)\b/g;
const STRINGS = /(["'`])(?:(?!\1)[^\\]|\\.)*\1/g;
const COMMENTS = /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm;
const NUMBERS = /\b(\d+\.?\d*)\b/g;

function highlightCode(code: string, lang: string): string {
  const isTypeScript = lang === "ts" || lang === "tsx" || lang === "typescript";
  const isJsx = lang === "jsx" || lang === "tsx";
  
  let highlighted = escapeHtml(code);
  
  highlighted = highlighted
    .replace(COMMENTS, '<span class="chat-code-comment">$1</span>')
    .replace(STRINGS, '<span class="chat-code-string">$&</span>')
    .replace(KEYWORDS, '<span class="chat-code-keyword">$1</span>')
    .replace(NUMBERS, '<span class="chat-code-number">$1</span>');
  
  if (isTypeScript) {
    highlighted = highlighted
      .replace(/:\s*(string|number|boolean|any|void|never|unknown|object|undefined|null)\b/g, '<span class="chat-code-type">:$1</span>')
      .replace(/&lt;(.*?)&gt;/g, '<span class="chat-code-generic">&lt;$1&gt;</span>')
      .replace(/\b(string|number|boolean|any|void|never|unknown|object|undefined|null)\b/g, '<span class="chat-code-type">$1</span>');
  }
  
  if (isJsx) {
    highlighted = highlighted
      .replace(/(&lt;\/?)([A-Z][a-zA-Z0-9]*)/g, '$1<span class="chat-code-tag">$2</span>');
  }
  
  return highlighted;
}

function renderMarkdown(text: string): string {
  let output = text;
  
  output = output
    .replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
      const langLabel = lang || "text";
      const highlighted = highlightCode(code.trim(), lang || "");
      return `<div class="chat-code-wrapper"><div class="chat-code-header"><span class="chat-code-lang">${langLabel}</span><button class="chat-code-copy" onclick="navigator.clipboard.writeText(this.closest('.chat-code-wrapper').querySelector('code').textContent).then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)})">Copy</button></div><pre class="chat-code-block"><code class="language-${langLabel}">${highlighted}</code></pre></div>`;
    })
    .replace(/`([^`]+)`/g, (_, code) => `<code class="chat-inline-code">${escapeHtml(code)}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/^### (.+)$/gm, "<h3 class='chat-md-h3'>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2 class='chat-md-h2'>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1 class='chat-md-h1'>$1</h1>")
    .replace(/^\s*[-*] (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>)/g, "<ul class='chat-md-list'>$1</ul>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="chat-md-link" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\n\n/g, "</p><p class='chat-md-p'>")
    .replace(/\n/g, "<br/>");
  
  return output;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Spinner ──────────────────────────────────────────────────

function Spinner({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-spinner ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

// ─── Source Panel ─────────────────────────────────────────────

function SourcesPanel({ sources, repoUrl }: { sources: Source[]; repoUrl: string }) {
  const [open, setOpen] = useState(false);
  if (!sources || sources.length === 0) return null;

  return (
    <div className="sources-panel">
      <button className="sources-toggle" onClick={() => setOpen((o) => !o)}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
        {sources.length} source{sources.length !== 1 ? "s" : ""}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.18s" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="sources-list">
          {sources.map((src, i) => (
            <div key={i} className="source-item">
              <div className="source-file-row">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="source-file">{src.file}</span>
                {src.lineStart > 0 && (
                  <span className="source-lines">L{src.lineStart}–{src.lineEnd}</span>
                )}
                <span className="source-score">{Math.round(src.score * 100)}%</span>
              </div>
              {src.snippet && (
                <pre className="source-snippet">{src.snippet}</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────

function MessageBubble({ msg, repoUrl }: { msg: Message; repoUrl: string }) {
  const isUser = msg.role === "USER";
  const isStreaming = msg.id === "streaming";

  return (
    <div className={`chat-message ${isUser ? "chat-message--user" : "chat-message--assistant"}`}>
      <div className="chat-bubble-avatar">
        {isUser ? (
          <div className="chat-avatar chat-avatar--user">U</div>
        ) : (
          <div className="chat-avatar chat-avatar--ai">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4l3 3" />
            </svg>
          </div>
        )}
      </div>

      <div className="chat-bubble-body">
        {isUser ? (
          <div className="chat-bubble chat-bubble--user">{msg.content}</div>
        ) : (
          <div className={`chat-bubble chat-bubble--assistant ${isStreaming ? "streaming" : ""}`}>
            {isStreaming && msg.content === "" ? (
              <div className="chat-typing">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            ) : (
              <div
                className="chat-md-content"
                dangerouslySetInnerHTML={{
                  __html: `<p class="chat-md-p">${renderMarkdown(msg.content)}</p>`,
                }}
              />
            )}
            {isStreaming && msg.content !== "" && (
              <span className="streaming-cursor" />
            )}
          </div>
        )}

        {!isUser && !isStreaming && msg.sources && msg.sources.length > 0 && (
          <SourcesPanel sources={msg.sources} repoUrl={repoUrl} />
        )}

        <div className="chat-bubble-time">
          {new Date(msg.createdAt).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main Chat Page ───────────────────────────────────────────

export default function ChatPage() {
  const { data: session, isPending } = authClient.useSession();
  const router = useRouter();
  const params = useParams();
  const repoId = params.repoId as string;

  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [clearingHistory, setClearingHistory] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Auth guard ─────────────────────────────────────────────
  useEffect(() => {
    if (!isPending && !session) router.push("/sign-in");
  }, [session, isPending, router]);

  // ── Load repo info + chat history ─────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [repoRes, chatRes] = await Promise.all([
        fetch(`/api/repos/${repoId}/status`),
        fetch(`/api/chat/${repoId}`),
      ]);

      if (repoRes.ok) {
        const data = await repoRes.json();
        setRepo(data);
      } else {
        router.push("/");
        return;
      }

      if (chatRes.ok) {
        const msgs = await chatRes.json();
        setMessages(msgs);
      }
    } finally {
      setLoading(false);
    }
  }, [repoId, router]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Auto-scroll ────────────────────────────────────────────
  useEffect(() => {
    if (messagesEndRef.current) {
      const isNearBottom = messagesEndRef.current.scrollHeight - messagesEndRef.current.scrollTop - messagesEndRef.current.clientHeight < 200;
      if (isNearBottom || sending) {
        endRef.current?.scrollIntoView({ behavior: "smooth" });
      } else {
        setShowScrollBtn(true);
      }
    }
  }, [messages, sending]);

  const handleScroll = useCallback(() => {
    if (messagesEndRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesEndRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 200;
      setShowScrollBtn(!isNearBottom);
    }
  }, []);

  // ── Auto-resize textarea ───────────────────────────────────
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
  };

  // ── Send message ───────────────────────────────────────────
  const handleSend = async () => {
    const question = input.trim();
    if (!question || sending) return;

    setError("");
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "USER",
      content: question,
      createdAt: new Date().toISOString(),
    };

    const streamingMsg: Message = {
      id: "streaming",
      role: "ASSISTANT",
      content: "",
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg, streamingMsg]);
    setSending(true);

    try {
      const res = await fetch(`/api/chat/${repoId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });

      if (!res.ok) {
        const data = await res.json();
        setMessages((prev) => prev.filter((m) => m.id !== "streaming"));
        setError(data.error ?? "Failed to get a response");
        setSending(false);
        return;
      }

      // Stream the response
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });

        setMessages((prev) =>
          prev.map((m) =>
            m.id === "streaming" ? { ...m, content: accumulated } : m
          )
        );
      }

      // Replace streaming placeholder with final message from server
      await loadData();

    } catch (err: any) {
      setMessages((prev) => prev.filter((m) => m.id !== "streaming"));
      setError(err.message || "Network error");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.key === "Enter" && (e.ctrlKey || e.metaKey)) || (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClearHistory = async () => {
    if (!confirm("Clear all chat history for this repository?")) return;
    setClearingHistory(true);
    try {
      await fetch(`/api/chat/${repoId}`, { method: "DELETE" });
      setMessages([]);
    } finally {
      setClearingHistory(false);
    }
  };

  // ── Loading state ──────────────────────────────────────────
  if (isPending || !session) {
    return (
      <div className="fullscreen-center">
        <Spinner size={36} className="page-spinner" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="fullscreen-center">
        <Spinner size={36} className="page-spinner" />
      </div>
    );
  }

  // ── Not indexed guard ──────────────────────────────────────
  if (repo && repo.indexStatus !== "INDEXED") {
    return (
      <div className="chat-not-ready-page">
        <div className="chat-not-ready-card">
          <div className="chat-not-ready-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <h2 className="chat-not-ready-title">
            {repo.indexStatus === "INDEXING" ? "Indexing in progress…" : "Repository not indexed yet"}
          </h2>
          <p className="chat-not-ready-sub">
            {repo.indexStatus === "INDEXING"
              ? `Embedding ${repo.indexedFiles ?? 0} of ${repo.totalFiles ?? "?"} files. This may take a few minutes.`
              : "Clone and index this repository on the dashboard before starting a chat."}
          </p>
          <Link href="/" className="btn-primary" style={{ textDecoration: "none" }}>
            ← Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const displayMessages = messages.filter((m) => m.id !== "streaming" || sending);

  return (
    <div className="chat-root">
      {/* ── Navbar ─────────────────────────────────────────── */}
      <nav className="chat-nav">
        <div className="chat-nav-left">
          <Link href="/" className="chat-back-btn" title="Back to dashboard">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <div className="chat-nav-repo">
            <div className="auth-logo small">OS</div>
            <div className="chat-nav-repo-info">
              <span className="chat-nav-repo-name">{repo?.name}</span>
              {repo?.defaultBranch && (
                <span className="chat-nav-branch">⎇ {repo.defaultBranch}</span>
              )}
            </div>
          </div>
        </div>

        <div className="chat-nav-right">
          {repo && (
            <div className="chat-nav-stats">
              <span className="chat-stat-pill">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                {repo.totalFiles?.toLocaleString() ?? "?"} files indexed
              </span>
            </div>
          )}
          {messages.length > 0 && (
            <button
              className="chat-clear-btn"
              onClick={handleClearHistory}
              disabled={clearingHistory}
              title="Clear chat history"
            >
              {clearingHistory ? <Spinner size={13} /> : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              )}
              Clear
            </button>
          )}
          <a
            href={repo?.url}
            target="_blank"
            rel="noopener noreferrer"
            className="chat-github-link"
            title="Open on GitHub"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
            </svg>
          </a>
        </div>
      </nav>

      {/* ── Message List ───────────────────────────────────── */}
      <main className="chat-main">
        <div className="chat-messages" ref={messagesEndRef} onScroll={handleScroll}>
          {displayMessages.length === 0 ? (
            <div className="chat-empty">
              <div className="chat-empty-icon">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h3 className="chat-empty-title">Ask anything about this codebase</h3>
              <p className="chat-empty-sub">
                The AI has indexed <strong>{repo?.totalFiles?.toLocaleString() ?? "all"}</strong> files from{" "}
                <strong>{repo?.name}</strong>. Try asking about architecture, specific functions, or how to use the code.
              </p>
              <div className="chat-suggestions">
                {[
                  "What does this project do?",
                  "Explain the folder structure",
                  "How does authentication work?",
                  "What are the main API endpoints?",
                ].map((q) => (
                  <button
                    key={q}
                    className="chat-suggestion-pill"
                    onClick={() => {
                      setInput(q);
                      textareaRef.current?.focus();
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {displayMessages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} repoUrl={repo?.url ?? ""} />
              ))}

              {showScrollBtn && (
                <button className="chat-scroll-btn" onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth" })}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                  New messages
                </button>
              )}
            </>
          )}

          {error && (
            <div className="chat-error-toast">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          <div ref={endRef} />
        </div>

        {/* ── Input Bar ────────────────────────────────────── */}
        <div className="chat-input-bar">
          <div className={`chat-input-wrap ${sending ? "chat-input-wrap--sending" : ""}`}>
            <textarea
              ref={textareaRef}
              className="chat-textarea"
              placeholder="Ask anything about the codebase… (Ctrl+Enter to send)"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={sending}
              rows={1}
            />
            <button
              className="chat-send-btn"
              onClick={handleSend}
              disabled={!input.trim() || sending}
              title="Send (Enter)"
            >
              {sending ? (
                <Spinner size={16} />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
            </button>
          </div>
          <p className="chat-input-hint">
            <span className="chat-kbd">Enter</span> send · <span className="chat-kbd">Shift+Enter</span> new line · Powered by{" "}
            <span className="chat-input-hint-accent">Gemini 1.5 Flash</span>
          </p>
        </div>
      </main>
    </div>
  );
}
