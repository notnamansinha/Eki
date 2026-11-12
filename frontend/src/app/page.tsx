"use client";

import { Loader2 } from "lucide-react";
import Image from "next/image";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import TransitArtwork from "@/components/shared/TransitArtwork";
import InstallGuideLink from "@/components/shared/InstallGuideLink";

const WORKSPACES = ["/admin", "/passenger"] as const;

function readSavedWorkspace(): string | null {
  try { return window.localStorage.getItem("eki:last-workspace"); } catch { return null; }
}

function canOpenWorkspace(role: string | null, path: string): boolean {
  if (role === "admin") return WORKSPACES.includes(path as (typeof WORKSPACES)[number]);
  return path === "/passenger";
}

export default function HomePage() {
  const {
    user,
    loading,
    restoreSlow,
    roleError,
    loginReady,
    loginError,
    loginFallbackAvailable,
    loginLoading,
    loginWithGoogle,
    loginWithGoogleRedirect,
    logout,
    refreshAccess,
  } = useAuth();
  const router = useRouter();
  const [redirectDelayed, setRedirectDelayed] = useState(false);
  // A disabled sign-in button must never be the only thing on the page.
  const loginStalled = !user && !roleError && !loginReady && !loginError;
  const [loginStallVisible, setLoginStallVisible] = useState(false);

  useEffect(() => {
    if (!loginStalled) return;
    const timer = window.setTimeout(() => setLoginStallVisible(true), 10_000);
    return () => {
      window.clearTimeout(timer);
      setLoginStallVisible(false);
    };
  }, [loginStalled]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setTimeout(() => setRedirectDelayed(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [user]);

  useEffect(() => {
    if (!loading && user && !roleError) {
      const savedPath = readSavedWorkspace();
      const fallbackPath = user.role === "admin" ? "/admin" : "/passenger";
      router.replace(
        savedPath && canOpenWorkspace(user.role, savedPath)
          ? savedPath
          : fallbackPath,
      );
    }
  }, [user, loading, roleError, router]);

  if (!loading && roleError) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center gap-4 px-6 text-center bg-black text-white" role="alert">
        <h1 className="text-xl font-semibold">Access could not be verified</h1>
        <p>{roleError}</p>
        <div className="flex items-center gap-4">
          <button type="button" className="btn-primary px-5 py-2.5" onClick={() => void refreshAccess()}>Try again</button>
          {/* A revoked, deleted or unsynchronized account must be able to switch accounts. */}
          <button type="button" className="text-sm font-semibold underline underline-offset-4" onClick={() => void logout()}>Sign out</button>
          <button type="button" className="text-sm font-semibold underline underline-offset-4" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </main>
    );
  }

  // Only replace the page with a redirect spinner once we KNOW there's a
  // signed-in user. Do NOT block on `loading` — that hides the hero and
  // tanks LCP by 7–22 seconds in Lighthouse while Firebase Auth initialises.
  if (user) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center gap-3 bg-black text-white">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-sm text-white/80">
          {loading ? "Finishing your sign-in…" : "Opening your workspace…"}
        </p>
        {redirectDelayed && (
          <button type="button" className="text-sm underline underline-offset-4" onClick={() => window.location.reload()}>
            Try reloading
          </button>
        )}
      </main>
    );
  }

  return (
    <main className="transit-landing relative isolate min-h-dvh w-full flex flex-col bg-black">
      <TransitArtwork landing />

      <section className="transit-landing-content relative z-10 flex-1 flex flex-col items-center justify-center text-center px-6 md:px-12 w-full max-w-5xl mx-auto py-6">
        <h1
          className="font-black leading-[1.05] text-white w-full mx-auto"
          style={{
            letterSpacing: "0.5px",
            textShadow: "0 2px 8px rgba(0,0,0,0.48)",
            WebkitTextStroke: "1px rgba(255,255,255,0.08)",
          }}
        >
          Track your<br className="hidden md:block" /> campus bus
        </h1>

        <p
          className="text-white/90 text-balance max-w-[30em] mx-auto font-medium"
          style={{
            letterSpacing: "0.2px",
            textShadow: "0 2px 8px rgba(0,0,0,0.45)",
          }}
        >
          View University bus routes and available bus locations<br />{" "}
          Arrival estimates depend on live service data
        </p>

        <div className="flex flex-col sm:flex-row w-full sm:w-auto gap-4">
          <button
            type="button"
            onClick={loginWithGoogle}
            disabled={loginLoading || !loginReady}
            className="flex items-center justify-center gap-3 px-5 sm:px-10 py-5 text-lg font-bold bg-white text-black rounded-[2.125rem] text-balance hover:bg-gray-200 active:scale-95 transition-transform disabled:opacity-60 shadow-xl"
          >
            {loginLoading || !loginReady ? (
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            ) : (
              <Image src="/google-g.svg" width={20} height={20} className="shrink-0" alt="" />
            )}
            {loginLoading ? "Opening Google…" : loginReady ? "Continue with Google" : "Preparing sign-in…"}
          </button>
        </div>
        <div className="mt-3 text-sm text-white drop-shadow-md">
          For campus travel information, contact{" "}
          <a
            href="https://ahduni.edu.in/academics/schools-centres/office-of-the-dean-of-students/getting-around/"
            className="font-semibold underline underline-offset-4"
            target="_blank"
            rel="noreferrer"
          >
            Campus Operations
          </a>
        </div>
        {loginReady && loginFallbackAvailable && (
          <button
            type="button"
            onClick={loginWithGoogleRedirect}
            className="mt-4 text-sm font-semibold text-white underline underline-offset-4"
          >
            Continue with full-page Google sign-in
          </button>
        )}
        {loginError && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <p className="max-w-lg text-sm text-white" role="alert">{loginError}</p>
          </div>
        )}
        {!roleError && (restoreSlow || (loginStalled && loginStallVisible)) && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <p className="max-w-lg text-sm text-white" role="status">
              {restoreSlow
                ? "Still checking your sign-in. The connection looks slow; this continues on its own."
                : "Sign-in is still loading."}
            </p>
            <button type="button" className="text-sm font-semibold text-white underline underline-offset-4" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        )}
      </section>

      <footer className="transit-landing-footer relative z-10 w-full pb-8 px-6 md:px-12 flex flex-wrap gap-x-4 gap-y-2 justify-between items-center text-white/70">
        <span className="text-xs font-bold drop-shadow-md">© 2026 Eki Transit</span>
        <InstallGuideLink />
        <span className="text-xs font-bold uppercase tracking-widest drop-shadow-md">Ahmedabad, India</span>
      </footer>
    </main>
  );
}
