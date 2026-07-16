"use client";

import Link from "next/link";
import { BusFront as Bus } from "lucide-react";

export default function Header() {
  return (
    <header className="sticky top-0 z-[100] w-full" style={{
      background: "rgba(9, 9, 11, 0.85)",
      backdropFilter: "blur(12px)",
      borderBottom: "1px solid var(--border-subtle)"
    }}>
      <div className="max-w-[1200px] mx-auto px-6 md:px-10 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <img src="/logo.webp" alt="Eki Transit Logo" className="h-6 w-auto" style={{ filter: "brightness(0) invert(1)" }} />
        </Link>
      </div>
    </header>
  );
}
