"use client";

import dynamic from "next/dynamic";
import {
  MapPinned as MapIcon,
  BusFront as BusIcon,
  LayoutDashboard,
  Settings as SettingsIcon,
  Activity,
  MessageSquare,
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
const FeedbackPanel = dynamic(() => import("@/app/feedback/page"), { ssr: false, loading: loadingPanel });

type AdminTab = "operations" | "routes" | "fleet" | "history" | "feedback" | "settings";

const TABS: { id: AdminTab; label: string; Icon: React.FC<{ className?: string }>; secondary?: boolean }[] = [
  { id: "operations", label: "Live Ops", Icon: LayoutDashboard },
  { id: "routes",     label: "Routes",     Icon: MapIcon },
  { id: "fleet",      label: "Fleet & People", Icon: BusIcon },
  { id: "history",    label: "History",    Icon: Activity },
  { id: "feedback",   label: "Feedback",   Icon: MessageSquare },
  { id: "settings",   label: "Settings",   Icon: SettingsIcon, secondary: true },
];

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>("operations");

  const selectTab = (tab: AdminTab) => {
    setActiveTab(tab);
  };

  const renderPanel = (tab: AdminTab) => {
    switch (tab) {
      case "operations": return <DashboardPanel />;
      case "routes": return <RouteManagementPanel />;
      case "fleet": return <FleetManagementPanel mode="combined" />;
      case "history": return <RideHistoryPanel />;
      case "feedback": return <FeedbackPanel embedded />;
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
          <div className="flex items-stretch overflow-x-auto hide-scrollbar" role="tablist" aria-label="Administration sections">
            {TABS.map(({ id, label, Icon, secondary }) => (
              <button
                key={id}
                id={`admin-tab-${id}`}
                role="tab"
                aria-selected={activeTab === id}
                aria-controls={`admin-panel-${id}`}
                onClick={() => selectTab(id)}
                className={`relative flex items-center gap-2 px-4 py-3.5 text-sm font-semibold transition-all whitespace-nowrap ${
                  secondary ? "ml-2 border-l border-white/10 pl-5" : ""} ${
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
      <div
        id={`admin-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`admin-tab-${activeTab}`}
        className="flex-1 min-h-0 overflow-y-auto bg-brand-dark/20"
      >
        {renderPanel(activeTab)}
      </div>
    </main>
  );
}
