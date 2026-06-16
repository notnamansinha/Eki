import Link from "next/link";
import { Bus, Globe, Send, Mail } from "lucide-react";

export default function Footer() {
  return (
    <footer className="footer-bg border-t border-white/5 pt-16 pb-8">
      <div className="max-w-7xl mx-auto px-6">
        {/* Removed Brand, Mission, and Contact sections for a minimal footer */}

        {/* Bottom Bar */}
        <div style={{ maxWidth: 980, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <p style={{ fontSize: 13, color: "#a1a1a6" }}>Copyright © 2025 BusTrack. All rights reserved.</p>
          <div style={{ display: "flex", gap: "24px" }}>
            <Link href="/passenger" style={{ fontSize: 13, color: "#a1a1a6", textDecoration: "none" }} className="hover:text-white transition-colors">Passenger View</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
