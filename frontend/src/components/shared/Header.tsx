"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bus, LayoutDashboard, Compass, Map, User } from "lucide-react";

const NAV_LINKS: {href: string, label: string, icon: any}[] = [];

export default function Header() {
  const pathname = usePathname(); 

  return (
    <header className="sticky top-0 z-[100] w-full border-b border-white/5 bg-brand-dark/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-32 flex items-center justify-between">
        {/* Brand Logo */}
        <Link href="/" className="flex items-center gap-4 group">
          <div className="w-32 h-32 flex items-center justify-center transition-transform group-hover:scale-110">
            <img src="/BusLogo.png" alt="BusTrack Logo" className="w-full h-full object-contain" />
          </div>
          <span className="font-display font-bold text-4xl tracking-tight text-white italic">
            Bus<span className="text-white/40">Track</span>
          </span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((link) => {
            const Icon = link.icon;
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`
                  flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200
                  ${isActive 
                    ? "bg-white text-brand-dark shadow-sm" 
                    : "text-white/50 hover:text-white hover:bg-white/5"}
                `}
              >
                <Icon className={`w-4 h-4 ${isActive ? "text-brand-dark" : "text-white/40"}`} />
                {link.label}
              </Link>
            );
          })}
        </nav>

      </div>
    </header>
  );
}


