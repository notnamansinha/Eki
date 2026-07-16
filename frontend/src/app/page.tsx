"use client";

import Link from "next/link";
import { BusFront as Bus, Navigation, Loader2, LogIn, ArrowRight, Zap, SignalHigh as Radio, Clock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { rtdb, auth } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import { onAuthStateChanged } from "firebase/auth";

interface ActiveBusCountEntry {
  deviceState?: string;
  tripState?: string;
  timestamp?: number;
}

export default function HomePage() {
  const { user, loading, roleResolved, loginLoading, loginWithGoogle } = useAuth();
  const router = useRouter();
  const [activeBusCount, setActiveBusCount] = useState(0);

  useEffect(() => {
    if (!loading && user && roleResolved) {
      router.push(`/${user.role || 'passenger'}`);
    }
  }, [user, loading, roleResolved, router]);

  // Live bus count for social proof
  useEffect(() => {
    let unsubscribeBuses: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      if (!firebaseUser) {
        setActiveBusCount(0);
        unsubscribeBuses?.();
        unsubscribeBuses = undefined;
        return;
      }

      if (unsubscribeBuses) return;

      const busesRef = ref(rtdb, "activeBuses");
      unsubscribeBuses = onValue(busesRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const now = Date.now();
          const count = Object.values(data as Record<string, ActiveBusCountEntry>).filter(
            (b) => b.deviceState === "online" && b.tripState === "in_service" && b.timestamp && (now - b.timestamp) < 300_000
          ).length;
          setActiveBusCount(count);
        } else {
          setActiveBusCount(0);
        }
      });
    });

    return () => {
      unsubscribeAuth();
      unsubscribeBuses?.();
    };
  }, []);

  if (loading || user) {
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
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "var(--accent)" }}>
              <Bus className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-extrabold tracking-tight" style={{ color: "var(--text-primary)" }}>
              eki
            </span>
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
        
        <h1 className="font-extrabold tracking-tighter leading-[0.92] mb-6 max-w-[900px]"
          style={{ fontSize: "clamp(2.8rem, 7vw, 5.5rem)", color: "var(--text-primary)" }}>
          Know exactly when{" "}
          <span style={{ color: "var(--text-tertiary)" }}>your bus arrives.</span>
        </h1>
        
        <p className="text-lg md:text-xl font-medium max-w-[520px] leading-relaxed mb-10"
          style={{ color: "var(--text-secondary)" }}>
          Live GPS tracking with speed-aware ETAs for Ahmedabad transit. 
          Open your phone, see your bus, know when to leave.
        </p>
        
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={loginWithGoogle}
            disabled={loginLoading}
            className="btn-primary px-7 py-3.5 flex items-center gap-2.5 font-bold text-[14px] disabled:opacity-60"
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
            className="btn-rc-outline px-7 py-3.5 flex items-center gap-2.5 font-bold text-[14px]"
          >
            <Navigation className="w-4 h-4" />
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
            ].map((f) => {
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
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight leading-tight mb-3"
              style={{ color: "var(--text-primary)" }}>
              Stop guessing.
            </h2>
            <p className="text-lg" style={{ color: "var(--text-secondary)" }}>
              Track your bus in real-time. It&apos;s free.
            </p>
          </div>
          <button
            onClick={loginWithGoogle}
            disabled={loginLoading}
            className="btn-primary px-8 py-4 text-[15px] font-bold inline-flex items-center gap-3 shrink-0 disabled:opacity-60"
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
