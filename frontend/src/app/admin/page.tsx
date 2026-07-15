"use client";

import RouteManagementPanel from "@/components/admin/RouteManagementPanel";
import FleetManagementPanel from "@/components/admin/FleetManagementPanel";
import FleetMapOverview from "@/components/admin/FleetMapOverview";
import { AdminDataProvider } from "@/contexts/AdminDataContext";
import { Map as MapIcon, Users, ShieldCheck, Bus as BusIcon, Route as RouteIcon, LayoutGrid } from "lucide-react";
import { useState } from "react";

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<"routes" | "fleet" | "personnel">("fleet");
  const [showMap, setShowMap] = useState(false);
  const [hasOpenedMap, setHasOpenedMap] = useState(false);

  const toggleMap = () => {
    setShowMap((current) => {
      const next = !current;
      if (next) setHasOpenedMap(true);
      return next;
    });
  };

  return (
    <AdminDataProvider>
    <main className="min-h-screen bg-brand-dark text-white flex flex-col font-sans admin-page">

      {/* ── Slim identity header ── */}
      <header className="sticky top-0 z-[100] w-full border-b border-white/5 bg-brand-dark/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-3 h-3 text-white/50" />
            </div>
            <span
              className="font-black text-sm uppercase tracking-[0.18em] text-white"
            >
              Admin Panel
            </span>
          </div>

          <button
            onClick={toggleMap}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold uppercase tracking-wider text-white transition-colors"
          >
            {showMap ? (
              <>
                <LayoutGrid className="w-3.5 h-3.5 text-white/70" />
                <span>Dashboard</span>
              </>
            ) : (
              <>
                <MapIcon className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                <span>Live Map</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* ── Page-level Tab Bar ── */}
      {!showMap && (
        <div className="w-full border-b border-white/5 bg-brand-surface/30 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="flex items-stretch gap-0">
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
                id="admin-tab-routes"
                onClick={() => setActiveTab("routes")}
                className={`relative flex items-center gap-2.5 px-5 py-3.5 text-xs font-black uppercase tracking-widest transition-all ${
                  activeTab === "routes"
                    ? "text-white"
                    : "text-white/30 hover:text-white/60"
                }`}
              >
                <RouteIcon className="w-3.5 h-3.5 shrink-0" />
                <span>Routes</span>
                {activeTab === "routes" && (
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
      )}

      {/* ── Content ── */}
      <div className="flex-1 bg-brand-dark/20 relative min-h-0 overflow-hidden">
        {/* Map layer — always present in background but only visible when showMap is true */}
        <div className={`absolute inset-0 transition-opacity duration-500 ${showMap ? "opacity-100 pointer-events-auto z-20" : "opacity-0 pointer-events-none z-0"}`}>
          {hasOpenedMap && <FleetMapOverview />}
        </div>

        {/* Content panel */}
        <div className={`relative z-10 w-full h-full transition-all duration-500 ${showMap ? "opacity-0 translate-y-4 pointer-events-none" : "opacity-100 translate-y-0"}`}>
          <div className="w-full h-full overflow-y-auto transition-all duration-300 opacity-100 translate-y-0 pointer-events-auto relative">
            {activeTab === "routes" && <RouteManagementPanel />}
            {activeTab === "fleet" && <FleetManagementPanel mode="fleet" />}
            {activeTab === "personnel" && <FleetManagementPanel mode="personnel" />}
          </div>
        </div>
      </div>
    </main>
    </AdminDataProvider>
  );
}
