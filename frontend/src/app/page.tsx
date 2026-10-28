"use client";

import Image from "next/image";
import { Loader2, LogIn } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
    <main className="relative h-dvh w-full overflow-hidden flex flex-col bg-black">
      {/* Native picture element for format negotiation — next/image can't
          serve WebP in static export mode (unoptimized:true). WebP saves
          ~180KB vs the JPG fallback for older browsers. */}
      <picture className="absolute inset-0 z-0 w-full h-full">
        <source srcSet="/images/hero-background.webp" type="image/webp" />
        <img
          src="/images/hero-background.jpg"
          alt=""
          aria-hidden="true"
          fetchPriority="high"
          decoding="async"
          className="object-cover md:object-[center_30%] w-full h-full"
        />
      </picture>
      <div className="absolute inset-0 bg-black/40 z-0 pointer-events-none" />

      <header className="absolute top-6 left-6 md:top-8 md:left-8 z-20 flex items-center justify-start pointer-events-none">
        <div className="bg-black/60 backdrop-blur-md border border-white/10 p-1 shadow-md shadow-black/50 flex items-center justify-center overflow-hidden">
          <Image
            src="/uni-logo.webp"
            alt="University Logo"
            width={490}
            height={490}
            className="h-16 md:h-24 w-auto object-contain block"
            priority
          />
        </div>
      </header>

      <section className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-6 md:px-12 w-full max-w-5xl mx-auto pt-6">
        <h1
          className="text-6xl md:text-[80px] lg:text-[96px] font-black leading-[1.05] text-white mb-6 w-full mx-auto"
          style={{
            letterSpacing: "0.5px",
            textShadow: "0 2px 8px rgba(0,0,0,0.2)",
            WebkitTextStroke: "1px rgba(255,255,255,0.08)",
          }}
        >
          Campus routes<br className="hidden md:block" /> and bus tracking
        </h1>

        <p
          className="text-xl md:text-3xl text-white/90 text-balance max-w-[650px] mx-auto mb-12 font-medium"
          style={{
            letterSpacing: "0.2px",
            textShadow: "0 2px 8px rgba(0,0,0,0.2)",
          }}
        >
          View campus routes and available bus locations. Arrival estimates depend on live service data.
        </p>

        <div className="flex flex-col sm:flex-row w-full sm:w-auto gap-4">
          <button
            type="button"
            onClick={loginWithGoogle}
            disabled={loginLoading || !loginReady}
            className="flex items-center justify-center gap-3 px-10 py-5 text-lg font-bold bg-white text-black rounded-full hover:bg-gray-200 active:scale-95 transition-transform disabled:opacity-60 shadow-xl"
          >
            {loginLoading ? <Loader2 className="size-6 animate-spin" /> : <LogIn className="size-6" />}
            {loginLoading ? "Opening Google…" : "Sign In with Google"}
          </button>
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
        {loginStalled && loginStallVisible && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <p className="max-w-lg text-sm text-white" role="status">Sign-in is still loading.</p>
            <button type="button" className="text-sm font-semibold text-white underline underline-offset-4" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        )}
      </section>

      <footer className="relative z-10 w-full pb-8 px-6 md:px-12 flex justify-between items-center text-white/70">
        <span className="text-xs font-bold drop-shadow-md">© 2026 Eki Transit</span>
        <span className="text-xs font-bold uppercase tracking-widest drop-shadow-md">Ahmedabad, India</span>
      </footer>
    </main>
  );
}
