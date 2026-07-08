"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

type CloneStatus = "PENDING" | "CLONING" | "CLONED" | "FAILED";
type IndexStatus = "PENDING" | "INDEXING" | "INDEXED" | "FAILED";

interface Repo {
  id: string;
  name: string;
  url: string;
  description?: string;
  defaultBranch?: string;
  cloneStatus: CloneStatus;
  indexStatus: IndexStatus;
  cloneError?: string;
  indexError?: string;
  totalFiles?: number;
  indexedFiles?: number;
  createdAt: string;
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function getGithubAvatarUrl(repoName: string) {
  const owner = repoName.split("/")[0];
  return `https://avatars.githubusercontent.com/${owner}?s=80`;
}

function cloneStatusLabel(status: CloneStatus) {
  switch (status) {
    case "PENDING": return "Not cloned";
    case "CLONING": return "Cloning…";
    case "CLONED": return "Cloned";
    case "FAILED": return "Clone failed";
  }
}

function cloneStatusClass(status: CloneStatus) {
  switch (status) {
    case "PENDING": return "status-pending";
    case "CLONING": return "status-cloning";
    case "CLONED": return "status-cloned";
    case "FAILED": return "status-failed";
  }
}

function indexStatusLabel(status: IndexStatus) {
  switch (status) {
    case "PENDING": return "Not indexed";
    case "INDEXING": return "Indexing…";
    case "INDEXED": return "Indexed";
    case "FAILED": return "Index failed";
  }
}

function indexStatusClass(status: IndexStatus) {
  switch (status) {
    case "PENDING": return "status-pending";
    case "INDEXING": return "status-indexing";
    case "INDEXED": return "status-indexed";
    case "FAILED": return "status-failed";
  }
}

// ────────────────────────────────────────────────────────────────
// Components
// ────────────────────────────────────────────────────────────────

function Spinner({ size = 18, className = "" }: { size?: number; className?: string }) {
  return <span className={`inline-spinner ${className}`} style={{ width: size, height: size }} />;
}

function CloneProgressBar({ status }: { status: CloneStatus }) {
  const pct = status === "CLONED" ? 100 : status === "CLONING" ? 60 : 0;
  if (pct === 0) return null;
  return (
    <div className="clone-progress-track">
      <div className={`clone-progress-bar ${status === "CLONING" ? "animated" : ""}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function IndexProgressBar({ status, indexedFiles, totalFiles }: { status: IndexStatus; indexedFiles?: number; totalFiles?: number }) {
  let pct = 0;
  if (status === "INDEXED") pct = 100;
  else if (status === "INDEXING" && indexedFiles && totalFiles) {
    pct = Math.round((indexedFiles / totalFiles) * 100);
  } else if (status === "INDEXING") {
    pct = 30;
  }
  if (pct === 0) return null;
  return (
    <div className="index-progress-track">
      <div className={`index-progress-bar ${status === "INDEXING" ? "animated" : ""}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Sub-Components
// ────────────────────────────────────────────────────────────────

function AddRepoModal({ onClose, onAdded }: { onClose: () => void; onAdded: (repo: Repo) => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 80); }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!url.trim()) { setError("Please enter a repository URL"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Something went wrong"); return; }
      onAdded(data as Repo);
      onClose();
    } catch { setError("Network error — please try again"); } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" /></svg>
          </div>
          <div>
            <h2 className="modal-title">Link a Repository</h2>
            <p className="modal-subtitle">Paste any public GitHub repository URL</p>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form className="modal-body" onSubmit={handleSubmit}>
          {error && <div className="form-error">{error}</div>}
          <div className="url-input-wrap">
            <span className="url-prefix">github.com/</span>
            <input ref={inputRef} type="url" className="url-input" placeholder="https://github.com/owner/repo" value={url} onChange={(e) => setUrl(e.target.value)} disabled={loading} autoComplete="off" />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading || !url.trim()}>
              {loading ? <Spinner size={16} /> : "Add Repository"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RepoCard({ repo, onClone, onDelete, onRetryIndex, isCloning, isRetryingIndex }: {
  repo: Repo; onClone: (id: string) => void; onDelete: (id: string) => void; onRetryIndex: (id: string) => void; isCloning: boolean; isRetryingIndex: boolean;
}) {
  const avatarUrl = getGithubAvatarUrl(repo.name);
  return (
    <div className={`repo-card ${repo.cloneStatus === "CLONED" ? "repo-card--cloned" : ""}`}>
      <div className="repo-card-header">
        <img src={avatarUrl} alt="" className="repo-avatar" onError={(e) => { (e.target as HTMLImageElement).src = ""; }} />
        <div className="repo-meta">
          <a href={repo.url} target="_blank" rel="noopener noreferrer" className="repo-name">
            {repo.name}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
          </a>
          {repo.defaultBranch && <span className="repo-branch">⎇ {repo.defaultBranch}</span>}
        </div>
        <div className="repo-status-badges">
          <span className={`status-badge ${cloneStatusClass(repo.cloneStatus)}`}>{repo.cloneStatus === "CLONING" && <Spinner size={10} className="status-spinner" />}{cloneStatusLabel(repo.cloneStatus)}</span>
          {repo.cloneStatus === "CLONED" && <span className={`status-badge ${indexStatusClass(repo.indexStatus)}`}>{repo.indexStatus === "INDEXING" && <Spinner size={10} className="status-spinner" />}{indexStatusLabel(repo.indexStatus)}</span>}
        </div>
      </div>
      <CloneProgressBar status={repo.cloneStatus} />
      {repo.cloneStatus === "CLONED" && <IndexProgressBar status={repo.indexStatus} indexedFiles={repo.indexedFiles} totalFiles={repo.totalFiles} />}
      <div className="repo-card-footer">
        <span className="repo-date">Added {new Date(repo.createdAt).toLocaleDateString()}</span>
        <div className="repo-actions-row">
          {repo.cloneStatus === "CLONED" ? (
            repo.indexStatus === "INDEXED" ? (
              <Link href={`/chat/${repo.id}`} className="btn-sm btn-accent">Chat</Link>
            ) : repo.indexStatus === "INDEXING" ? (
              <span className="indexing-label"><Spinner size={12} /> Indexing...</span>
            ) : (
              <button className="btn-sm btn-danger" onClick={() => onRetryIndex(repo.id)} disabled={isRetryingIndex}>Retry Index</button>
            )
          ) : (
            <button className="btn-sm btn-accent" onClick={() => onClone(repo.id)} disabled={isCloning}>Clone</button>
          )}
          <button className="btn-icon btn-delete" onClick={() => confirm(`Delete ${repo.name}?`) && onDelete(repo.id)}>✕</button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty-state">
      <h3 className="empty-title">No repositories yet</h3>
      <p className="empty-sub">Add a public GitHub repository to start analyzing.</p>
      <button className="btn-primary" onClick={onAdd}>Add your first repository</button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Sections
// ────────────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section className="hero">
      <div className="hero-glow" />
      
      <div className="hero-container">
        <div className="hero-content">
          <h1 className="hero-title">Open-source intelligence for your codebase.</h1>
          <p className="hero-subtitle">
            OpenSage clones, indexes, and analyzes any public GitHub repository, building a local knowledge graph that you can chat with.
          </p>
          <div className="hero-actions">
            <Link href="/sign-in" className="btn-hero btn-hero-primary">Get Started</Link>
            <a href="https://github.com/lucas-labs/open-sage" target="_blank" rel="noopener noreferrer" className="btn-hero btn-hero-secondary">View on GitHub</a>
          </div>
        </div>

        <div className="hero-visual">
          <div className="hero-image-wrap">
            <img src="/hero-mockup.png" alt="OpenSage Dashboard Mockup" className="hero-image" />
          </div>
        </div>
      </div>
    </section>
  );
}

function RepoDashboard({ session }: { session: any }) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [cloningIds, setCloningIds] = useState<Set<string>>(new Set());
  const [retryingIndexIds, setRetryingIndexIds] = useState<Set<string>>(new Set());
  const router = useRouter();

  const fetchRepos = useCallback(async () => {
    try {
      const res = await fetch("/api/repos");
      if (res.ok) setRepos(await res.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchRepos(); }, [fetchRepos]);

  useEffect(() => {
    const active = repos.filter(r => r.cloneStatus === "CLONING" || r.indexStatus === "INDEXING");
    if (active.length === 0) return;
    const interval = setInterval(async () => {
      const updates = await Promise.all(active.map(async r => {
        const res = await fetch(`/api/repos/${r.id}/status`);
        return res.ok ? res.json() : null;
      }));
      setRepos(prev => prev.map(r => {
        const u = updates.find(update => update?.id === r.id);
        return u ? { ...r, ...u } : r;
      }));
    }, 3000);
    return () => clearInterval(interval);
  }, [repos]);

  const handleClone = async (id: string) => {
    setCloningIds(s => new Set(s).add(id));
    await fetch(`/api/repos/${id}/clone`, { method: "POST" });
    setRepos(prev => prev.map(r => r.id === id ? { ...r, cloneStatus: "CLONING" } : r));
    setCloningIds(s => { const n = new Set(s); n.delete(id); return n; });
  };

  const handleRetryIndex = async (id: string) => {
    setRetryingIndexIds(s => new Set(s).add(id));
    await fetch(`/api/repos/${id}/index`, { method: "POST" });
    setRepos(prev => prev.map(r => r.id === id ? { ...r, indexStatus: "INDEXING" } : r));
    setRetryingIndexIds(s => { const n = new Set(s); n.delete(id); return n; });
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/repos/${id}`, { method: "DELETE" });
    if (res.ok) setRepos(prev => prev.filter(r => r.id !== id));
  };

  const handleSignOut = async () => {
    await authClient.signOut({ fetchOptions: { onSuccess: () => router.push("/") } });
  };

  const initials = session.user.name?.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2) ?? "?";

  return (
    <div className="db-root">
      <nav className="db-nav">
        <div className="nav-brand"><div className="auth-logo small">OS</div><span className="nav-brand-name">OpenSage</span></div>
        <div className="nav-center"><span className="nav-pill">Dashboard</span></div>
        <div className="nav-right">
          <div className="user-avatar">{initials}</div>
          <button onClick={handleSignOut} className="signout-btn">Sign out</button>
        </div>
      </nav>

      <main className="db-main">
        <div className="db-page-header">
          <div>
            <h1 className="db-page-title">Repositories</h1>
            <p className="db-page-sub">Analyze and chat with your open-source projects.</p>
          </div>
          <button className="btn-primary" onClick={() => setShowModal(true)}>Add Repository</button>
        </div>

        <div className="repo-grid">
          {repos.map(r => (
            <RepoCard key={r.id} repo={r} onClone={handleClone} onDelete={handleDelete} onRetryIndex={handleRetryIndex} isCloning={cloningIds.has(r.id)} isRetryingIndex={retryingIndexIds.has(r.id)} />
          ))}
        </div>
        {!loading && repos.length === 0 && <EmptyState onAdd={() => setShowModal(true)} />}
      </main>

      {showModal && <AddRepoModal onClose={() => setShowModal(false)} onAdded={repo => setRepos(prev => [repo, ...prev])} />}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Main Page
// ────────────────────────────────────────────────────────────────

export default function Page() {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return <div className="fullscreen-center"><Spinner size={32} className="page-spinner" /></div>;
  if (session) return <RepoDashboard session={session} />;
  return <HeroSection />;
}
