"use client";

import Link from "next/link";
import Image from "next/image";
import { Navigation, Loader2, LogIn, Map } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function HomePage() {
  const { user, loading, loginLoading, loginWithGoogle } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.push(`/${user.role || 'passenger'}`);
    }
  }, [user, loading, router]);

  if (loading || user) {
    return (
      <main className="min-h-dvh flex items-center justify-center bg-black">
        <Loader2 className="w-6 h-6 text-white animate-spin" />
      </main>
    );
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden flex flex-col bg-black">
      {/* ── FULL SCREEN BACKGROUND IMAGE ── */}
      <Image 
        src="/images/hero-background.png" 
        alt="Eki Transit Background" 
        fill
        className="object-cover md:object-[center_30%] absolute inset-0 z-0"
        priority
        quality={100}
      />
      {/* ── SUBTLE OVERLAY SHADOW ── */}
      <div className="absolute inset-0 bg-black/40 z-0 pointer-events-none" />

      {/* ── TOP LEFT UNIVERSITY LOGO ── */}
      <header className="absolute top-6 left-6 md:top-8 md:left-8 z-20 flex items-center justify-start pointer-events-none">
        <div className="bg-black/60 backdrop-blur-md border border-white/10 rounded-none p-1 shadow-md shadow-black/50 flex items-center justify-center overflow-hidden">
          <Image 
            src="/uni-logo.webp" 
            alt="University Logo" 
            width={280} 
            height={100} 
            className="h-16 md:h-24 w-auto object-contain block"
            priority 
          />
        </div>
      </header>

      {/* ── HERO CONTENT ─── */}
      <section className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-6 md:px-12 w-full max-w-5xl mx-auto pt-6">
        <h1 
          className="text-6xl md:text-[80px] lg:text-[96px] font-black leading-[1.05] text-white mb-6 w-full mx-auto"
          style={{
            letterSpacing: '0.5px',
            textShadow: '0 2px 8px rgba(0,0,0,0.2)',
            WebkitTextStroke: '1px rgba(255,255,255,0.08)'
          }}
        >
          Seamless campus mobility<br className="hidden md:block" /> at your fingertips
        </h1>

        <p 
          className="text-xl md:text-3xl text-white/90 text-balance max-w-[650px] mx-auto mb-12 font-medium"
          style={{
            letterSpacing: '0.2px',
            textShadow: '0 2px 8px rgba(0,0,0,0.2)'
          }}
        >
          Live GNSS location tracking and intelligent arrival estimates for effortless travel
        </p>

        <div className="flex flex-col sm:flex-row w-full sm:w-auto gap-4">
          <button
            onClick={loginWithGoogle}
            disabled={loginLoading}
            className="flex items-center justify-center gap-3 px-10 py-5 text-lg font-bold bg-white text-black rounded-full hover:bg-gray-200 active:scale-95 transition-transform disabled:opacity-60 shadow-xl"
          >
            {loginLoading ? (
              <Loader2 className="size-6 animate-spin" />
            ) : (
              <LogIn className="size-6" />
            )}
            {loginLoading ? "Opening Google…" : "Sign In with Google"}
          </button>
        </div>
      </section>

      {/* ── BOTTOM FOOTER ── */}
      <footer className="relative z-10 w-full pb-8 px-6 md:px-12 flex justify-between items-center text-white/70">
        <span className="text-xs font-bold uppercase tracking-widest drop-shadow-md">© 2026 Eki Transit</span>
        <span className="text-xs font-bold uppercase tracking-widest drop-shadow-md">Ahmedabad, India</span>
      </footer>
    </main>
  );
}
