"use client";

import dynamic from "next/dynamic";
import {
  MapPinned as MapIcon,
  UsersRound as UsersIcon,
  BusFront as BusIcon,
  LayoutDashboard,
  Settings as SettingsIcon,
  Activity,
} from "lucide-react";
import { useState } from "react";

const loadingPanel = () => (
  <div className="h-full grid place-items-center text-white/50" role="status" aria-label="Loading panel">
    Loading panel…
  </div>
);

const RouteManagementPanel = dynamic(() => import("@/components/admin/RouteManagementPanel"), { ssr: false, loading: loadingPanel });
const FleetManagementPanel = dynamic(() => import("@/components/admin/FleetManagementPanel"), { ssr: false, loading: loadingPanel });
const DashboardPanel = dynamic(() => import("@/components/admin/DashboardPanel"), { ssr: false, loading: loadingPanel });
const SettingsPanel = dynamic(() => import("@/components/admin/SettingsPanel"), { ssr: false, loading: loadingPanel });
const RideHistoryPanel = dynamic(() => import("@/components/admin/RideHistoryPanel"), { ssr: false, loading: loadingPanel });

type AdminTab = "dashboard" | "routes" | "fleet" | "personnel" | "history" | "settings";

const TABS: { id: AdminTab; label: string; Icon: React.FC<{ className?: string }> }[] = [
  { id: "dashboard",  label: "Dashboard",  Icon: LayoutDashboard },
  { id: "routes",     label: "Routes",     Icon: MapIcon },
  { id: "fleet",      label: "Fleet",      Icon: BusIcon },
  { id: "personnel",  label: "Personnel",  Icon: UsersIcon },
  { id: "history",    label: "History",    Icon: Activity },
  { id: "settings",   label: "Settings",   Icon: SettingsIcon },
];

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");
  const [visitedTabs, setVisitedTabs] = useState<AdminTab[]>(["dashboard"]);

  const selectTab = (tab: AdminTab) => {
    setActiveTab(tab);
    setVisitedTabs((current) => current.includes(tab) ? current : [...current, tab]);
  };

  const renderPanel = (tab: AdminTab) => {
    switch (tab) {
      case "dashboard": return <DashboardPanel />;
      case "routes": return <RouteManagementPanel />;
      case "fleet": return <FleetManagementPanel mode="fleet" />;
      case "personnel": return <FleetManagementPanel mode="personnel" />;
      case "history": return <RideHistoryPanel />;
      case "settings": return <SettingsPanel />;
    }
  };

  return (
    <main
      className="bg-brand-dark text-white flex flex-col font-sans"
      style={{ height: "100dvh", overflow: "hidden" }}
    >
      {/* ── Tab Bar ── */}
      <div className="shrink-0 w-full border-b border-white/5 bg-brand-surface/30 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-stretch overflow-x-auto hide-scrollbar">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                id={`admin-tab-${id}`}
                onClick={() => selectTab(id)}
                className={`relative flex items-center gap-2 px-4 py-3.5 text-sm font-semibold transition-all whitespace-nowrap ${
                  activeTab === id ? "text-white" : "text-white/50 hover:text-white/70"
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
        {TABS.map(({ id }) => visitedTabs.includes(id) && (
          <div key={id} className={activeTab === id ? "h-full overflow-y-auto" : "hidden"}>
            {renderPanel(id)}
          </div>
        ))}
      </div>
    </main>
  );
}
