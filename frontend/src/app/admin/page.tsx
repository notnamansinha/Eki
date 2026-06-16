"use client";

import RouteManagementPanel from "@/components/admin/RouteManagementPanel";
import FleetManagementPanel from "@/components/admin/FleetManagementPanel";
import { Map as MapIcon, Users, ShieldCheck, Bus as BusIcon } from "lucide-react";
import { useState } from "react";

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<"routes" | "fleet" | "personnel">("routes");

  return (
    <main className="min-h-screen bg-brand-dark text-white flex flex-col font-sans">

      {/* ── Slim identity header (title only) ── */}
      <header className="sticky top-0 z-[100] w-full border-b border-white/5 bg-brand-dark/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-12 flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-3 h-3 text-white/50" />
          </div>
          <span
            className="font-black text-sm uppercase tracking-[0.18em] text-white"
            style={{ fontFamily: "Outfit" }}
          >
            Admin Panel
          </span>
        </div>
      </header>

      {/* ── Page-level Tab Bar ── */}
      <div className="w-full border-b border-white/5 bg-brand-surface/30 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-stretch gap-0">
            <button
              id="admin-tab-routes"
              onClick={() => setActiveTab("routes")}
              className={`relative flex items-center gap-2.5 px-5 py-3.5 text-xs font-black uppercase tracking-widest transition-all ${
                activeTab === "routes"
                  ? "text-white"
                  : "text-white/30 hover:text-white/60"
              }`}
            >
              <MapIcon className="w-3.5 h-3.5 shrink-0" />
              <span>Routes</span>
              {activeTab === "routes" && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-white rounded-full" />
              )}
            </button>

            <button
              id="admin-tab-fleet"
              onClick={() => setActiveTab("fleet")}
              className={`relative flex items-center gap-2.5 px-5 py-3.5 text-xs font-black uppercase tracking-widest transition-all ${
                activeTab === "fleet"
                  ? "text-white"
                  : "text-white/30 hover:text-white/60"
              }`}
            >
              <BusIcon className="w-3.5 h-3.5 shrink-0" />
              <span>Fleet</span>
              {activeTab === "fleet" && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-white rounded-full" />
              )}
            </button>

            <button
              id="admin-tab-personnel"
              onClick={() => setActiveTab("personnel")}
              className={`relative flex items-center gap-2.5 px-5 py-3.5 text-xs font-black uppercase tracking-widest transition-all ${
                activeTab === "personnel"
                  ? "text-white"
                  : "text-white/30 hover:text-white/60"
              }`}
            >
              <Users className="w-3.5 h-3.5 shrink-0" />
              <span>Personnel</span>
              {activeTab === "personnel" && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-white rounded-full" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 bg-brand-dark/20">
        {activeTab === "routes" ? <RouteManagementPanel /> : <FleetManagementPanel mode={activeTab} />}
      </div>
    </main>
  );
}
