"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BusFront as Bus } from "lucide-react";

export default function Header() {
  const pathname = usePathname(); 

  return (
    <header className="sticky top-0 z-[100] w-full" style={{
      background: "rgba(9, 9, 11, 0.85)",
      backdropFilter: "blur(12px)",
      borderBottom: "1px solid var(--border-subtle)"
    }}>
      <div className="max-w-[1200px] mx-auto px-6 md:px-10 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center transition-transform group-hover:scale-105"
            style={{ background: "var(--accent)" }}>
            <Bus className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-extrabold tracking-tight" style={{ color: "var(--text-primary)" }}>
            eki
          </span>
        </Link>
      </div>
    </header>
  );
}
