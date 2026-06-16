"use client";

import Link from "next/link";
import { Bus, MapPin, Navigation, LayoutDashboard, Wifi, Star, Bell, ShieldCheck, Loader2, LogIn } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";



const FEATURES = [
  { icon: Wifi, title: "Real-Time GPS", desc: "Sub-second location updates via Firebase Realtime Database." },
  { icon: MapPin, title: "On-Demand Stops", desc: "Passengers tap the map to request pickups anywhere on the route." },
  { icon: Navigation, title: "Smart Routing", desc: "Intelligent road-based routing calculates optimal driver paths." },
  { icon: Star, title: "Rider Ratings", desc: "Star ratings and comments collected per trip for quality control." },
  { icon: Bell, title: "Instant Alerts", desc: "Automated notifications for arrivals, request spikes, and deviations." },
  { icon: ShieldCheck, title: "Secure Access", desc: "Firebase-backed authentication and rules at every layer." },
];



export default function HomePage() {
  const { user, loading, loginWithGoogle } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.push(`/${user.role || 'passenger'}`);
    }
  }, [user, loading, router]);

  if (loading || user) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#212121]">
        <Loader2 className="w-10 h-10 text-white/20 animate-spin" />
      </main>
    );
  }

  return (
    <main
      className="min-h-screen overflow-x-hidden"
      style={{ background: "#212121", fontFamily: "'Inter', sans-serif", color: "#e0e0e0" }}
    >
      <style>{`
        * { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
        .apple-nav-link { color: #ffffff; font-size: 14px; font-weight: 500; padding: 0 12px; opacity: 0.7; transition: opacity 0.2s; text-decoration: none; }
        .apple-nav-link:hover { opacity: 1; }
        .portal-card { background: #2A2A2A; border-radius: 18px; padding: 40px; transition: transform 0.3s cubic-bezier(0.25,0.1,0.25,1); text-decoration: none; display: flex; flex-direction: column; border: 1px solid rgba(255,255,255,0.05); }
        .portal-card:hover { transform: scale(1.02); }
        .feature-card { padding: 32px 0; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .cta-btn-primary { display: inline-flex; align-items: center; gap: 8px; background: #0071e3; color: white; padding: 14px 28px; border-radius: 980px; font-size: 15px; font-weight: 500; text-decoration: none; transition: background 0.2s; }
        .cta-btn-primary:hover { background: #0077ed; }
        .cta-btn-secondary { display: inline-flex; align-items: center; gap: 6px; color: #0071e3; font-size: 15px; font-weight: 500; text-decoration: none; transition: opacity 0.2s; }
        .cta-btn-secondary:hover { opacity: 0.7; }
        .cta-btn-secondary::after { content: "›"; font-size: 18px; }
        .dark-section { background: #1d1d1f; }
        .dark-section * { color: #f5f5f7; }
      `}</style>

      {/* ── NAV BAR ─── Apple.com style */}
      <nav style={{ background: "rgba(0,0,0,0.95)", backdropFilter: "saturate(180%) blur(20px)", WebkitBackdropFilter: "saturate(180%) blur(20px)", position: "sticky", top: 0, zIndex: 100, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <div className="max-w-[980px] mx-auto px-5 h-20 md:h-[120px] flex items-center justify-between">
          <div className="flex items-center gap-3 md:gap-4 no-underline">
            <img src="/BusLogo.png" alt="BusTrack Logo" className="w-[50px] h-[50px] md:w-[110px] md:h-[110px] object-contain" />
            <span className="text-2xl md:text-3xl font-bold text-white tracking-tighter italic">BusTrack</span>
          </div>
          <button onClick={loginWithGoogle} className="cta-btn-primary px-4 py-2 md:px-[18px] md:py-[8px] text-[12px] md:text-[13px]">
            Sign In 
          </button>
        </div>
      </nav>

      {/* ── HERO ─── Full-width, dark bottom section like apple.com product pages */}
      <section className="bg-black min-h-[88vh] flex flex-col items-center justify-center text-center px-5 pt-[80px] pb-[60px] md:pt-[100px] md:pb-[80px]">
        <p className="text-xs md:text-sm font-medium text-[#6e6e73] tracking-widest uppercase mb-4 md:mb-5">
          BusTrack — Live
        </p>
        <h1 className="text-[clamp(2.5rem,8vw,6rem)] font-bold text-[#f5f5f7] tracking-tighter leading-none m-0 mb-6 md:mb-7 max-w-[800px]">
          The Smartest Way<br />to Ride the City.
        </h1>
        <p className="text-[clamp(1rem,2.5vw,1.4rem)] text-[#86868b] font-normal max-w-[560px] leading-relaxed mb-10 md:mb-12 px-4 md:px-0">
          Real-time bus tracking, on-demand stops, and full fleet oversight. One ecosystem for everyone.
        </p>
        <div className="flex gap-4 md:gap-5 flex-wrap justify-center w-full px-5 md:px-0">
          <button onClick={loginWithGoogle} className="cta-btn-primary px-6 py-3 md:px-[32px] md:py-[16px] text-sm md:text-[16px] w-full max-w-[280px] md:w-auto justify-center">
            <LogIn className="w-5 h-5" />
            Sign In with Google
          </button>
          <Link
            href="/route-planner"
            className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 border border-white/15 text-white px-6 py-3 md:px-[32px] md:py-[16px] rounded-full text-sm md:text-[16px] font-semibold no-underline transition-all w-full max-w-[280px] md:w-auto"
            style={{ backdropFilter: "blur(12px)" }}
          >
            <Navigation className="w-5 h-5" />
            Plan Your Trip
          </Link>
        </div>
      </section>





      {/* ── FEATURES ─── Clean list like apple tech specs */}
      <section className="bg-[#212121] px-5 py-16 md:py-[80px]">
        <div className="max-w-[740px] mx-auto">
          <h2 className="text-[clamp(1.5rem,4vw,3rem)] font-semibold text-white tracking-tight text-center mb-10 md:mb-16 leading-tight">
            Built for real cities.<br /><span className="text-[#a1a1a6]">Engineered for reliability.</span>
          </h2>
          <div>
            {FEATURES.map((f, i) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className={`py-6 md:py-8 flex gap-4 md:gap-8 items-start border-b border-white/10 ${i === 0 ? 'border-t' : ''}`}>
                  <div className="w-10 h-10 md:w-11 md:h-11 bg-[#333333] rounded-[10px] flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 md:w-6 md:h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-[16px] md:text-[17px] font-semibold text-white mb-2 tracking-tight">{f.title}</h3>
                    <p className="text-[14px] md:text-[15px] text-[#a1a1a6] leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ─── */}
      <section className="bg-[#1a1a1a] px-5 py-16 md:py-[120px] text-center">
        <h2 className="text-[clamp(1.8rem,5vw,3.5rem)] font-bold text-white tracking-tighter mb-3 leading-tight">
          Ready to ride smarter?
        </h2>
        <p className="text-[17px] md:text-[19px] text-[#a1a1a6] mb-10 md:mb-12 px-4">
          Join the live transit network today.
        </p>
        <div className="flex gap-4 justify-center flex-wrap px-5 md:px-0">
          <button onClick={loginWithGoogle} className="inline-flex items-center justify-center gap-2 bg-white text-[#111111] px-6 py-3 md:px-7 md:py-[14px] rounded-full text-sm md:text-[15px] font-semibold no-underline transition-colors hover:bg-gray-200 w-full max-w-[280px] md:w-auto">
            <LogIn className="w-4 h-4 md:w-4 md:h-4" />
            Sign In with Google
          </button>
        </div>
      </section>


    </main>
  );
}
