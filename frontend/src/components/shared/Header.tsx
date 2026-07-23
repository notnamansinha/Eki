"use client";

import Link from "next/link";

export default function Header() {
  return (
    <header className="sticky top-0 z-[100] w-full" style={{
      background: "rgba(9, 9, 11, 0.98)",
      borderBottom: "1px solid var(--border-subtle)"
    }}>
      <div className="max-w-[1200px] mx-auto px-6 md:px-10 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/eki-logo.png" alt="Eki Transit Logo" className="h-6 w-auto" />
        </Link>
      </div>
    </header>
  );
}
