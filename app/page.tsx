"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export default function Home() {
  const { data: session, isPending } = authClient.useSession();
  const router = useRouter();

  // Redirect unauthenticated visitors to sign-in
  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in");
    }
  }, [session, isPending, router]);

  if (isPending) {
    return (
      <div className="home-loading">
        <span className="btn-spinner large" />
      </div>
    );
  }

  if (!session) return null;

  const initials = session.user.name
    ? session.user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  const handleSignOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => router.push("/sign-in"),
      },
    });
  };

  return (
    <div className="dashboard">
      {/* Navbar */}
      <nav className="dashboard-nav">
        <div className="nav-brand">
          <div className="auth-logo small">OS</div>
          <span className="nav-brand-name">OpenSage</span>
        </div>
        <div className="nav-right">
          <div className="user-avatar" title={session.user.name ?? session.user.email}>
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

      {/* Content */}
      <main className="dashboard-main">
        <div className="dashboard-hero">
          <div className="hero-badge">✅ Authenticated</div>
          <h1 className="dashboard-welcome">
            Welcome back, {session.user.name?.split(" ")[0] ?? "there"}!
          </h1>
          <p className="dashboard-sub">
            You&apos;re signed in as <strong>{session.user.email}</strong>
          </p>
        </div>

        {/* Session info card */}
        <div className="session-card">
          <h2 className="session-card-title">Session Details</h2>
          <div className="session-rows">
            <div className="session-row">
              <span className="session-key">User ID</span>
              <code className="session-val">{session.user.id}</code>
            </div>
            <div className="session-row">
              <span className="session-key">Name</span>
              <span className="session-val">{session.user.name}</span>
            </div>
            <div className="session-row">
              <span className="session-key">Email</span>
              <span className="session-val">{session.user.email}</span>
            </div>
            <div className="session-row">
              <span className="session-key">Email Verified</span>
              <span className="session-val">
                {session.user.emailVerified ? "✅ Yes" : "⚠️ No"}
              </span>
            </div>
          </div>
        </div>

        <div className="dashboard-actions">
          <Link href="/sign-in" className="action-link">← Back to Sign in</Link>
        </div>
      </main>
    </div>
  );
}
