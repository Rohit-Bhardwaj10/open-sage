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
    case "PENDING":
      return "Not cloned";
    case "CLONING":
      return "Cloning…";
    case "CLONED":
      return "Cloned";
    case "FAILED":
      return "Clone failed";
  }
}

function cloneStatusClass(status: CloneStatus) {
  switch (status) {
    case "PENDING":
      return "status-pending";
    case "CLONING":
      return "status-cloning";
    case "CLONED":
      return "status-cloned";
    case "FAILED":
      return "status-failed";
  }
}

function indexStatusLabel(status: IndexStatus) {
  switch (status) {
    case "PENDING":
      return "Not indexed";
    case "INDEXING":
      return "Indexing…";
    case "INDEXED":
      return "Indexed";
    case "FAILED":
      return "Index failed";
  }
}

function indexStatusClass(status: IndexStatus) {
  switch (status) {
    case "PENDING":
      return "status-pending";
    case "INDEXING":
      return "status-indexing";
    case "INDEXED":
      return "status-indexed";
    case "FAILED":
      return "status-failed";
  }
}

// ────────────────────────────────────────────────────────────────
// Components
// ────────────────────────────────────────────────────────────────

function Spinner({
  size = 18,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-spinner ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

function CloneProgressBar({ status }: { status: CloneStatus }) {
  const pct = status === "CLONED" ? 100 : status === "CLONING" ? 60 : 0;
  if (pct === 0) return null;
  return (
    <div className="clone-progress-track">
      <div
        className={`clone-progress-bar ${status === "CLONING" ? "animated" : ""}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function IndexProgressBar({
  status,
  indexedFiles,
  totalFiles,
}: {
  status: IndexStatus;
  indexedFiles?: number;
  totalFiles?: number;
}) {
  let pct = 0;
  if (status === "INDEXED") pct = 100;
  else if (status === "INDEXING" && indexedFiles && totalFiles) {
    pct = Math.round((indexedFiles / totalFiles) * 100);
  } else if (status === "INDEXING") {
    pct = 30; // Indeterminate progress
  }

  if (pct === 0) return null;
  return (
    <div className="index-progress-track">
      <div
        className={`index-progress-bar ${status === "INDEXING" ? "animated" : ""}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Add Repo Modal
// ────────────────────────────────────────────────────────────────

interface AddRepoModalProps {
  onClose: () => void;
  onAdded: (repo: Repo) => void;
}

function AddRepoModal({ onClose, onAdded }: AddRepoModalProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!url.trim()) {
      setError("Please enter a repository URL");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      onAdded(data as Repo);
      onClose();
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-icon">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
            </svg>
          </div>
          <div>
            <h2 className="modal-title">Link a Repository</h2>
            <p className="modal-subtitle">
              Paste any public GitHub repository URL
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          {error && <div className="form-error">{error}</div>}

          <div className="url-input-wrap">
            <span className="url-prefix">github.com/</span>
            <input
              ref={inputRef}
              id="repo-url-input"
              type="url"
              className="url-input"
              placeholder="https://github.com/owner/repo"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={loading}
              autoComplete="off"
            />
          </div>

          <p className="modal-hint">
            Works with any public repo. For private repos, make sure you are the
            owner.
          </p>

          <div className="modal-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={loading || !url.trim()}
            >
              {loading ? <Spinner size={16} /> : null}
              {loading ? "Adding…" : "Add Repository"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Repo Card
// ────────────────────────────────────────────────────────────────

interface RepoCardProps {
  repo: Repo;
  onClone: (id: string) => void;
  onDelete: (id: string) => void;
  onRetryIndex: (id: string) => void;
  isCloning: boolean;
  isRetryingIndex: boolean;
}

function RepoCard({ repo, onClone, onDelete, onRetryIndex, isCloning, isRetryingIndex }: RepoCardProps) {
  const avatarUrl = getGithubAvatarUrl(repo.name);

  return (
    <div
      className={`repo-card ${repo.cloneStatus === "CLONED" ? "repo-card--cloned" : ""}`}
    >
      {/* top row */}
      <div className="repo-card-header">
        <img
          src={avatarUrl}
          alt={repo.name.split("/")[0]}
          className="repo-avatar"
          onError={(e) => {
            (e.target as HTMLImageElement).src = "";
          }}
        />
        <div className="repo-meta">
          <a
            href={repo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="repo-name"
          >
            {repo.name}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginLeft: 4, opacity: 0.5 }}
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
          {repo.defaultBranch && (
            <span className="repo-branch">⎇ {repo.defaultBranch}</span>
          )}
        </div>
        <div className="repo-status-badges">
          <span
            className={`status-badge ${cloneStatusClass(repo.cloneStatus)}`}
          >
            {repo.cloneStatus === "CLONING" && (
              <Spinner size={10} className="status-spinner" />
            )}
            {cloneStatusLabel(repo.cloneStatus)}
          </span>
          {repo.cloneStatus === "CLONED" && (
            <span
              className={`status-badge ${indexStatusClass(repo.indexStatus)}`}
            >
              {repo.indexStatus === "INDEXING" && (
                <Spinner size={10} className="status-spinner" />
              )}
              {indexStatusLabel(repo.indexStatus)}
            </span>
          )}
        </div>
      </div>

      {/* progress bars */}
      <CloneProgressBar status={repo.cloneStatus} />
      {repo.cloneStatus === "CLONED" && (
        <IndexProgressBar
          status={repo.indexStatus}
          indexedFiles={repo.indexedFiles}
          totalFiles={repo.totalFiles}
        />
      )}

      {/* errors */}
      {repo.cloneStatus === "FAILED" && repo.cloneError && (
        <div className="repo-error">{repo.cloneError}</div>
      )}
      {repo.indexStatus === "FAILED" && repo.indexError && (
        <div className="repo-error">{repo.indexError}</div>
      )}

      {/* bottom row */}
      <div className="repo-card-footer">
        <span className="repo-date">
          Added{" "}
          {new Date(repo.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>

        <div className="repo-actions-row">
          {repo.cloneStatus === "CLONED" ? (
            repo.indexStatus === "INDEXED" ? (
              <Link
                href={`/chat/${repo.id}`}
                className="btn-sm btn-accent"
                style={{ textDecoration: "none" }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                Chat
              </Link>
            ) : repo.indexStatus === "INDEXING" ? (
              <span className="indexing-label">
                <Spinner size={12} />
                Indexing{" "}
                {repo.indexedFiles && repo.totalFiles
                  ? `${repo.indexedFiles}/${repo.totalFiles}`
                  : "in progress"}
                …
              </span>
            ) : repo.indexStatus === "FAILED" ? (
              <button
                className="btn-sm btn-danger"
                onClick={() => onRetryIndex(repo.id)}
                disabled={isRetryingIndex}
              >
                {isRetryingIndex ? <Spinner size={12} /> : null}
                {isRetryingIndex ? "Retrying…" : "Retry index"}
              </button>
            ) : (
              <span className="badge-info">⏳ Waiting to index</span>
            )
          ) : repo.cloneStatus === "FAILED" ? (
            <button
              className="btn-sm btn-danger"
              onClick={() => onClone(repo.id)}
              disabled={isCloning}
            >
              Retry clone
            </button>
          ) : repo.cloneStatus === "PENDING" ? (
            <button
              className="btn-sm btn-accent"
              onClick={() => onClone(repo.id)}
              disabled={isCloning}
            >
              {isCloning ? <Spinner size={12} /> : null}
              {isCloning ? "Starting…" : "Clone repo"}
            </button>
          ) : (
            <span className="cloning-label">
              <Spinner size={12} />
              Cloning in progress…
            </span>
          )}

          <button
            className="btn-icon btn-delete"
            onClick={() => {
              if (confirm(`Delete ${repo.name}? This cannot be undone.`)) {
                onDelete(repo.id);
              }
            }}
            title="Delete repository"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Empty State
// ────────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
        </svg>
      </div>
      <h3 className="empty-title">No repositories yet</h3>
      <p className="empty-sub">
        Add a public GitHub repository to start analyzing its codebase,
        dependencies, and architecture.
      </p>
      <button className="btn-primary" onClick={onAdd} id="empty-add-repo-btn">
        Add your first repository
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Main Dashboard
// ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data: session, isPending } = authClient.useSession();
  const router = useRouter();

  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [cloningIds, setCloningIds] = useState<Set<string>>(new Set());
  const [retryingIndexIds, setRetryingIndexIds] = useState<Set<string>>(new Set());

  // Redirect if unauthenticated
  useEffect(() => {
    if (!isPending && !session) router.push("/sign-in");
  }, [session, isPending, router]);

  // Fetch repos
  const fetchRepos = useCallback(async () => {
    try {
      const res = await fetch("/api/repos");
      if (res.ok) {
        const data = await res.json();
        setRepos(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  // Poll repos that are currently cloning or indexing
  useEffect(() => {
    const active = repos.filter(
      (r) => r.cloneStatus === "CLONING" || r.indexStatus === "INDEXING",
    );
    if (active.length === 0) return;

    const interval = setInterval(async () => {
      const updates = await Promise.all(
        active.map(async (r) => {
          const res = await fetch(`/api/repos/${r.id}/status`);
          if (res.ok) return res.json();
          return null;
        }),
      );

      setRepos((prev) =>
        prev.map((r) => {
          const update = updates.find((u) => u?.id === r.id);
          return update ? { ...r, ...update } : r;
        }),
      );
    }, 3000);

    return () => clearInterval(interval);
  }, [repos]);

  const handleClone = async (repoId: string) => {
    setCloningIds((s) => new Set(s).add(repoId));
    try {
      await fetch(`/api/repos/${repoId}/clone`, { method: "POST" });
      // Optimistically update status
      setRepos((prev) =>
        prev.map((r) =>
          r.id === repoId ? { ...r, cloneStatus: "CLONING" } : r,
        ),
      );
    } finally {
      setCloningIds((s) => {
        const n = new Set(s);
        n.delete(repoId);
        return n;
      });
    }
  };

  const handleAdded = (repo: Repo) => {
    setRepos((prev) => [repo, ...prev]);
  };

  const handleRetryIndex = async (repoId: string) => {
    setRetryingIndexIds((s) => new Set(s).add(repoId));
    try {
      await fetch(`/api/repos/${repoId}/index`, { method: "POST" });
      setRepos((prev) =>
        prev.map((r) =>
          r.id === repoId ? { ...r, indexStatus: "INDEXING" } : r
        )
      );
    } finally {
      setRetryingIndexIds((s) => {
        const n = new Set(s);
        n.delete(repoId);
        return n;
      });
    }
  };

  const handleDelete = async (repoId: string) => {
    try {
      const res = await fetch(`/api/repos/${repoId}`, { method: "DELETE" });
      if (res.ok) {
        setRepos((prev) => prev.filter((r) => r.id !== repoId));
      }
    } catch (error) {
      console.error("Failed to delete repo:", error);
    }
  };

  const handleSignOut = async () => {
    await authClient.signOut({
      fetchOptions: { onSuccess: () => router.push("/sign-in") },
    });
  };

  if (isPending || !session) {
    return (
      <div className="fullscreen-center">
        <Spinner size={36} className="page-spinner" />
      </div>
    );
  }

  const initials = session.user.name
    ? session.user.name
        .split(" ")
        .map((n: string) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  const clonedCount = repos.filter((r) => r.cloneStatus === "CLONED").length;
  const indexedCount = repos.filter((r) => r.indexStatus === "INDEXED").length;

  return (
    <div className="db-root">
      {/* ── Navbar ───────────────────────────────────────────── */}
      <nav className="db-nav">
        <div className="nav-brand">
          <div className="auth-logo small">OS</div>
          <span className="nav-brand-name">OpenSage</span>
        </div>

        <div className="nav-center">
          <span className="nav-pill">Dashboard</span>
        </div>

        <div className="nav-right">
          <div
            className="user-avatar"
            title={session.user.name ?? session.user.email}
          >
            {initials}
          </div>
          <button
            id="signout-btn"
            onClick={handleSignOut}
            className="signout-btn"
          >
            Sign out
          </button>
        </div>
      </nav>

      {/* ── Page Body ─────────────────────────────────────────── */}
      <main className="db-main">
        {/* Page header */}
        <div className="db-page-header">
          <div>
            <h1 className="db-page-title">Repositories</h1>
            <p className="db-page-sub">
              Add any GitHub repo to clone it and build a knowledge graph over
              its codebase.
            </p>
          </div>
          <div className="db-header-actions">
            <button
              id="add-repo-btn"
              className="btn-primary"
              onClick={() => setShowModal(true)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Repository
            </button>
          </div>
        </div>

        {/* Stats bar */}
        {repos.length > 0 && (
          <div className="stats-bar">
            <div className="stat-chip">
              <span className="stat-num">{repos.length}</span>
              <span className="stat-label">Linked</span>
            </div>
            <div className="stat-sep" />
            <div className="stat-chip">
              <span className="stat-num">{clonedCount}</span>
              <span className="stat-label">Cloned</span>
            </div>
            <div className="stat-sep" />
            <div className="stat-chip">
              <span className="stat-num">{indexedCount}</span>
              <span className="stat-label">Indexed</span>
            </div>
            <div className="stat-sep" />
            <div className="stat-chip">
              <span className="stat-num">
                {
                  repos.filter(
                    (r) =>
                      r.cloneStatus === "CLONING" ||
                      r.indexStatus === "INDEXING",
                  ).length
                }
              </span>
              <span className="stat-label">In progress</span>
            </div>
          </div>
        )}

        {/* Onboarding cards — only shown when repo list is empty */}
        {!loading && repos.length === 0 && (
          <div className="onboard-grid">
            {/* Option A: Link any repo */}
            <div
              className="onboard-card"
              id="onboard-link-repo"
              onClick={() => setShowModal(true)}
            >
              <div className="onboard-icon onboard-icon--link">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              </div>
              <h3 className="onboard-title">Link a Repository</h3>
              <p className="onboard-desc">
                Paste the URL of any public GitHub repository — yours or someone
                else's.
              </p>
              <span className="onboard-cta">Paste URL →</span>
            </div>

            {/* Option B: Connect GitHub (coming soon) */}
            <div
              className="onboard-card onboard-card--muted"
              id="onboard-connect-github"
            >
              <div className="onboard-icon onboard-icon--github">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                </svg>
              </div>
              <h3 className="onboard-title">
                Connect GitHub
                <span className="coming-soon-badge">Soon</span>
              </h3>
              <p className="onboard-desc">
                Browse and import directly from your GitHub account — private
                repos included.
              </p>
              <span className="onboard-cta onboard-cta--muted">
                Coming soon
              </span>
            </div>
          </div>
        )}

        {/* Repo list */}
        {loading ? (
          <div className="fullscreen-center" style={{ minHeight: 200 }}>
            <Spinner size={28} className="page-spinner" />
          </div>
        ) : repos.length > 0 ? (
          <div className="repo-list">
            {repos.map((repo) => (
              <RepoCard
                key={repo.id}
                repo={repo}
                onClone={handleClone}
                onDelete={handleDelete}
                onRetryIndex={handleRetryIndex}
                isCloning={cloningIds.has(repo.id)}
                isRetryingIndex={retryingIndexIds.has(repo.id)}
              />
            ))}
          </div>
        ) : null}

        {/* Empty state (after loading, no repos) — shown below onboard cards */}
        {!loading && repos.length === 0 && (
          <EmptyState onAdd={() => setShowModal(true)} />
        )}
      </main>

      {/* ── Modal ────────────────────────────────────────────── */}
      {showModal && (
        <AddRepoModal
          onClose={() => setShowModal(false)}
          onAdded={handleAdded}
        />
      )}
    </div>
  );
}
