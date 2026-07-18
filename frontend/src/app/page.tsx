"use client";

import Link from "next/link";
import { BusFront as Bus, Navigation, Map, Loader2, LogIn, ArrowRight, Zap, MessageCircle, Clock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { rtdb, auth } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import { signInAnonymously } from "firebase/auth";

export default function HomePage() {
  const { user, loading, loginLoading, loginWithGoogle } = useAuth();
  const router = useRouter();
  const [activeBusCount, setActiveBusCount] = useState(0);

  useEffect(() => {
    if (!loading && user && !user.isAnonymous) {
      router.push(`/${user.role || 'passenger'}`);
    }
  }, [user, loading, router]);

  // Live bus count for social proof
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let isMounted = true;
    
    signInAnonymously(auth).then(() => {
      if (!isMounted) return;
      const busesRef = ref(rtdb, "activeBuses");
      unsub = onValue(busesRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const now = Date.now();
          const count = Object.values(data as Record<string, any>).filter(
            (b: any) => b.deviceState === "online" && b.tripState === "in_service" && (now - b.timestamp) < 300_000
          ).length;
          setActiveBusCount(count);
        } else {
          setActiveBusCount(0);
        }
      }, (error) => {
        console.warn("[RTDB] activeBuses read failed:", error.message);
      });
    }).catch(() => { });
    
    return () => {
      isMounted = false;
      if (unsub) unsub();
    };
  }, []);

  if (loading || (user && !user.isAnonymous)) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: "var(--surface-0)" }}>
        <Loader2 className="w-6 h-6 text-[var(--text-tertiary)] animate-spin" />
      </main>
    );
  }

  return (
    <main className="min-h-screen relative noise-bg" style={{ background: "var(--surface-0)" }}>

      {/* ── NAV ─── */}
      <nav className="fixed top-0 w-full z-50" style={{
        background: "rgba(9, 9, 11, 0.85)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--border-subtle)"
      }}>
        <div className="max-w-[1200px] mx-auto px-6 md:px-10 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
              <img src="/eki-logo.png" alt="Eki Transit Logo" className="h-[28px] w-auto" />
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/route-planner"
              className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors"
              style={{ color: "var(--text-secondary)" }}
            >
              <Navigation className="w-3.5 h-3.5" />
              Plan Trip
            </Link>
            <button
              onClick={loginWithGoogle}
              disabled={loginLoading}
              className="btn-primary px-5 py-2 flex items-center gap-2 text-[13px] disabled:opacity-60"
            >
              {loginLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>
                  Sign In <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* ── HERO ─── */}
      <section className="relative pt-[140px] pb-20 px-6 md:px-10 max-w-[1200px] mx-auto">
        {/* Live status */}
        {activeBusCount > 0 && (
          <div className="status-live mb-8 animate-fade-in">
            {activeBusCount} bus{activeBusCount !== 1 ? "es" : ""} live now
          </div>
        )}
        {activeBusCount === 0 && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-8 text-[11px] font-semibold"
            style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}>
            <Clock className="w-3 h-3" />
            Service starts at 8:00 AM
          </div>
        )}

        <h1 className="text-display-hero mb-6 max-w-[900px]"
          style={{ color: "var(--text-primary)" }}>
          Know exactly when{" "}
          <span style={{ color: "var(--text-tertiary)" }}>your bus arrives.</span>
        </h1>

        <p className="text-body-primary max-w-[520px] mb-10"
          style={{ color: "var(--text-secondary)" }}>
          Live GPS tracking with speed-aware ETAs for Ahmedabad transit.
          Open your phone, see your bus, know when to leave.
        </p>

        <div className="flex gap-3 flex-wrap">
          <button
            onClick={loginWithGoogle}
            disabled={loginLoading}
            className="btn-primary px-7 py-3.5 flex items-center gap-2.5 font-semibold text-[14px] disabled:opacity-60"
          >
            {loginLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <LogIn className="w-4 h-4" />
            )}
            {loginLoading ? "Opening Google…" : "Sign In with Google"}
          </button>
          <Link
            href="/route-planner"
            className="btn-rc-outline px-7 py-3.5 flex items-center gap-2.5 font-semibold text-[14px]"
          >
            <Map className="w-4 h-4" />
            Plan a Trip
          </Link>
        </div>
      </section>

      {/* ── DIVIDER ── */}
      <div className="w-full" style={{ borderTop: "1px solid var(--border-subtle)" }} />

      {/* ── CAPABILITIES ─── */}
      <section className="relative py-20 px-6 md:px-10">
        <div className="max-w-[1200px] mx-auto">
          <div className="mb-14">
            <p className="label-xs mb-3">What it does</p>
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight leading-tight max-w-[600px]"
              style={{ color: "var(--text-primary)" }}>
              Built for riders who value their time.
            </h2>
          </div>

          {/* Staggered 2-col layout with large numbers as anchors */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              {
                stat: "200ms",
                label: "Update latency",
                desc: "Sub-second GPS updates via Firebase Realtime Database. Bus positions refresh faster than you can blink.",
                icon: Zap,
              },
              {
                stat: "60fps",
                label: "Smooth tracking",
                desc: "GPU-accelerated marker interpolation creates fluid bus movement between discrete GPS pings.",
                icon: Navigation,
              },
              {
                stat: "±30s",
                label: "ETA accuracy",
                desc: "Speed-aware arrival estimates that account for current bus velocity, traffic stops, and delay buffers.",
                icon: Clock,
              },
              {
                stat: "2-way",
                label: "Live comms",
                desc: "Direct messaging channel between driver and riders. Ask about stops, report issues, get real responses.",
                icon: Radio,
              },
            ].map((f, i) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.label}
                  className="p-7 rounded-2xl border transition-colors group"
                  style={{
                    background: "var(--surface-1)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  <div className="flex items-start justify-between mb-5">
                    <div>
                      <span className="text-3xl font-extrabold tracking-tight" style={{ color: "var(--text-primary)" }}>
                        {f.stat}
                      </span>
                      <p className="label-xs mt-1">{f.label}</p>
                    </div>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{ background: "var(--surface-3)" }}>
                      <Icon className="w-5 h-5" style={{ color: "var(--text-tertiary)" }} />
                    </div>
                  </div>
                  <p className="text-[15px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    {f.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── DIVIDER ── */}
      <div className="w-full" style={{ borderTop: "1px solid var(--border-subtle)" }} />

      {/* ── FINAL CTA ─── */}
      <section className="relative py-24 px-6 md:px-10 max-w-[1200px] mx-auto">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-10">
          <div>
            <h2 className="text-title-screen mb-3"
              style={{ color: "var(--text-primary)" }}>
              Stop guessing.
            </h2>
            <p className="text-body-primary" style={{ color: "var(--text-secondary)" }}>
              Track your bus in real-time. It's free.
            </p>
          </div>
          <button
            onClick={loginWithGoogle}
            disabled={loginLoading}
            className="btn-primary px-8 py-4 text-[15px] font-medium inline-flex items-center gap-3 shrink-0 disabled:opacity-60"
          >
            {loginLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowRight className="w-4 h-4" />
            )}
            {loginLoading ? "Opening Google…" : "Get Started"}
          </button>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ borderTop: "1px solid var(--border-subtle)" }} className="py-6 px-6 md:px-10">
        <div className="max-w-[1200px] mx-auto flex flex-col md:flex-row justify-between items-center gap-3">
          <span className="label-xs">© 2026 Eki Transit</span>
          <span className="label-xs" style={{ color: "var(--text-ghost)" }}>Ahmedabad, India</span>
        </div>
      </footer>
    </main>
  );
}
