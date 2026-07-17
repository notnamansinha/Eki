"use client";

import RouteManagementPanel from "@/components/admin/RouteManagementPanel";
import FleetManagementPanel from "@/components/admin/FleetManagementPanel";
import DashboardPanel from "@/components/admin/DashboardPanel";
import SettingsPanel from "@/components/admin/SettingsPanel";
import {
  MapPinned as MapIcon,
  UsersRound as UsersIcon,
  ShieldCheck,
  BusFront as BusIcon,
  LayoutDashboard,
  Settings as SettingsIcon,
} from "lucide-react";
import { useState } from "react";

type AdminTab = "dashboard" | "routes" | "fleet" | "personnel" | "settings";

const TABS: { id: AdminTab; label: string; Icon: React.FC<{ className?: string }> }[] = [
  { id: "dashboard",  label: "Dashboard",  Icon: LayoutDashboard },
  { id: "routes",     label: "Routes",     Icon: MapIcon },
  { id: "fleet",      label: "Fleet",      Icon: BusIcon },
  { id: "personnel",  label: "Personnel",  Icon: UsersIcon },
  { id: "settings",   label: "Settings",   Icon: SettingsIcon },
];

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");

  return (
    <main
      className="bg-brand-dark text-white flex flex-col font-sans"
      style={{ height: "100dvh", overflow: "hidden" }}
    >
      {/* ── Slim identity header ── */}
      <header className="shrink-0 w-full border-b border-white/5 bg-brand-dark/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-12 flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg bg-brand-accent/20 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-3 h-3 text-brand-accent" />
          </div>
          <span className="font-bold text-sm text-white">Admin Panel</span>
        </div>
      </header>

      {/* ── Tab Bar ── */}
      <div className="shrink-0 w-full border-b border-white/5 bg-brand-surface/30 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-stretch overflow-x-auto hide-scrollbar">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                id={`admin-tab-${id}`}
                onClick={() => setActiveTab(id)}
                className={`relative flex items-center gap-2 px-4 py-3.5 text-sm font-semibold transition-all whitespace-nowrap ${
                  activeTab === id ? "text-white" : "text-white/40 hover:text-white/70"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
                {activeTab === id && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-accent rounded-full" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Content — fills remaining height, scrolls internally per panel ── */}
      <div className="flex-1 min-h-0 overflow-hidden bg-brand-dark/20">
        {activeTab === "dashboard"  && <DashboardPanel />}
        {activeTab === "routes"     && <RouteManagementPanel />}
        {activeTab === "fleet"      && <FleetManagementPanel mode="fleet" />}
        {activeTab === "personnel"  && <FleetManagementPanel mode="personnel" />}
        {activeTab === "settings"   && <SettingsPanel />}
      </div>
    </main>
  );
}
