"use client";

import { useEffect, useState } from "react";
import { useAuth, UserRole } from "@/hooks/useAuth";
import { Loader2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";

interface RoleGuardProps {
  children: React.ReactNode;
  allowedRoles: UserRole[];
  loadingFallback?: React.ReactNode;
}

export default function RoleGuard({ children, allowedRoles, loadingFallback }: RoleGuardProps) {
  const {
    user,
    loading,
    restoreSlow,
    roleError,
    logout,
    refreshAccess,
  } = useAuth();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  // Verification can outlast the restore notice (slow token and claims
  // requests), so a long spinner gets the same way out.
  const [loadingStalled, setLoadingStalled] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setLoadingStalled(true), 10_000);
    return () => {
      window.clearTimeout(timer);
      setLoadingStalled(false);
    };
  }, [loading]);

  useEffect(() => {
    if (!loading && !user && !roleError) router.replace("/");
  }, [loading, roleError, router, user]);

  useEffect(() => {
    if (user && allowedRoles.includes(user.role)) {
      try {
        window.localStorage.setItem("eki:last-workspace", pathname);
      } catch {
        // Workspace memory is optional when browser storage is unavailable.
      }
    }
  }, [allowedRoles, pathname, user]);

  if (loading && (restoreSlow || loadingStalled)) {
    // Still fail-closed: nothing protected mounts until verification finishes,
    // but a slow network gets an explanation and a way out instead of a spinner.
    return (
      <div
        className="w-full flex flex-col items-center justify-center gap-4 px-6 text-center"
        style={{ height: "100dvh", background: "var(--surface-0)" }}
      >
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--text-tertiary)" }} aria-hidden="true" />
        <p role="status" className="max-w-sm text-sm" style={{ color: "var(--text-secondary)" }}>
          Still signing you in. The connection looks slow; this continues on its own.
        </p>
        <button type="button" className="text-sm font-semibold underline underline-offset-4" style={{ color: "var(--text-primary)" }} onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }

  if (loading) {
    if (loadingFallback) return <>{loadingFallback}</>;

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

  if (roleError) {
    return (
      <div
        className="w-full flex flex-col items-center justify-center px-6 text-center"
        style={{ height: "100dvh", background: "var(--surface-0)" }}
        role="alert"
      >
        <ShieldAlert className="mb-5 h-8 w-8" style={{ color: "var(--status-danger)" }} />
        <h1 className="mb-2 text-2xl font-extrabold" style={{ color: "var(--text-primary)" }}>
          Access could not be verified
        </h1>
        <p className="mb-6 max-w-sm text-sm" style={{ color: "var(--text-secondary)" }}>
          {roleError}
        </p>
        <div className="flex items-center gap-4">
          <button type="button" className="btn-primary px-5 py-2.5 text-sm" onClick={() => void refreshAccess()}>
            Try again
          </button>
          <button
            type="button"
            className="text-sm font-semibold"
            style={{ color: "var(--text-secondary)" }}
            onClick={() => void logout()}
          >
            Sign out
          </button>
          <button
            type="button"
            className="text-sm font-semibold"
            style={{ color: "var(--text-secondary)" }}
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }

  if (!user) return null;

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
        <p className="text-[11px] font-semibold mb-8 uppercase tracking-widest" style={{ color: "var(--text-ghost)" }}>
          Role: {user.role}
        </p>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="text-[13px] font-semibold transition-colors"
            style={{ color: "var(--text-secondary)" }}
          >
            Sign out
          </button>
          <Link
            href="/"
            className="text-[13px] font-medium transition-colors"
            style={{ color: "var(--accent)" }}
          >
            Return Home
          </Link>
        </div>

        <ConfirmModal
          isOpen={showLogoutConfirm}
          title="Sign out?"
          description="Are you sure you want to sign out of your account?"
          confirmText="Sign out"
          onCancel={() => setShowLogoutConfirm(false)}
          onConfirm={() => {
            setShowLogoutConfirm(false);
            void logout();
          }}
        />
      </div>
    );
  }

  return <>{children}</>;
}
