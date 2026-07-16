"use client";

import { useAuth, UserRole } from "@/hooks/useAuth";
import { Loader2, ShieldAlert, LogIn } from "lucide-react";

interface RoleGuardProps {
  children: React.ReactNode;
  allowedRoles: UserRole[];
}

export default function RoleGuard({ children, allowedRoles }: RoleGuardProps) {
  const { user, loading, loginLoading, loginWithGoogle, logout } = useAuth();

  if (loading) {
    return (
      <div
        className="w-full flex flex-col items-center justify-center"
        style={{ height: "100dvh", background: "var(--surface-0)" }}
      >
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center"
            style={{ background: "var(--surface-3)", border: "1px solid var(--border-default)" }}
          >
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--text-tertiary)" }} />
          </div>
          <p className="text-[13px] font-semibold" style={{ color: "var(--text-ghost)" }}>
            Signing you in…
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className="w-full flex flex-col items-center justify-center px-6 text-center"
        style={{ height: "100dvh", background: "var(--surface-0)" }}
      >
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6"
          style={{ background: "var(--surface-3)", border: "1px solid var(--border-default)" }}
        >
          <ShieldAlert className="w-7 h-7" style={{ color: "var(--text-tertiary)" }} />
        </div>
        <h1
          className="text-2xl font-extrabold tracking-tight mb-2"
          style={{ color: "var(--text-primary)" }}
        >
          Access Restricted
        </h1>
        <p
          className="text-[14px] max-w-xs mb-8 leading-relaxed"
          style={{ color: "var(--text-secondary)" }}
        >
          Sign in to access this section.
        </p>
        <button
          onClick={loginWithGoogle}
          disabled={loginLoading}
          className="btn-primary px-6 py-3 flex items-center gap-2.5 text-[13px] font-bold disabled:opacity-60"
        >
          {loginLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <LogIn className="w-4 h-4" />
          )}
          {loginLoading ? "Opening Google…" : "Sign in with Google"}
        </button>
      </div>
    );
  }

  if (!allowedRoles.includes(user.role)) {
    return (
      <div
        className="w-full flex flex-col items-center justify-center px-6 text-center"
        style={{ height: "100dvh", background: "var(--surface-0)" }}
      >
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6"
          style={{ background: "var(--status-danger-bg)", border: "1px solid rgba(248, 113, 113, 0.2)" }}
        >
          <ShieldAlert className="w-7 h-7" style={{ color: "var(--status-danger)" }} />
        </div>
        <h1
          className="text-2xl font-extrabold tracking-tight mb-2"
          style={{ color: "var(--text-primary)" }}
        >
          Unauthorized
        </h1>
        <p
          className="text-[13px] max-w-xs mb-1 leading-relaxed"
          style={{ color: "var(--text-secondary)" }}
        >
          <span style={{ color: "var(--text-primary)" }}>{user.email}</span> does not have access to this panel.
        </p>
        <p className="text-[11px] font-bold mb-8 uppercase tracking-widest" style={{ color: "var(--text-ghost)" }}>
          Role: {user.role}
        </p>
        <div className="flex items-center gap-4">
          <button
            onClick={logout}
            className="text-[13px] font-semibold transition-colors"
            style={{ color: "var(--text-secondary)" }}
          >
            Sign out
          </button>
          <a
            href="/"
            className="text-[13px] font-bold transition-colors"
            style={{ color: "var(--accent)" }}
          >
            Return Home
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
