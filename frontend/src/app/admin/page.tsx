"use client";

import dynamic from "next/dynamic";
import AdminPanelErrorBoundary from "@/components/admin/AdminPanelErrorBoundary";
import WorkspaceLink from "@/components/shared/WorkspaceLink";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { hasUnsavedChanges } from "@/lib/unsavedChanges";
import {
  MapPinned as MapIcon,
  BusFront as BusIcon,
  LayoutDashboard,
  Settings as SettingsIcon,
  Activity,
  MessageSquare,
  UsersRound,
} from "lucide-react";
import { useRef, useState } from "react";

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
const FeedbackPanel = dynamic(() => import("@/components/admin/FeedbackPanel"), { ssr: false, loading: loadingPanel });

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
  const tabButtons = useRef(new Map<AdminTab, HTMLButtonElement>());
  const [activeTab, setActiveTab] = useState<AdminTab>("operations");
  const [pendingTab, setPendingTab] = useState<AdminTab | null>(null);

  const selectTab = (tab: AdminTab) => {
    // Leaving a section unmounts its editor, so confirm before dropping a draft.
    if (tab !== activeTab && hasUnsavedChanges()) {
      setPendingTab(tab);
      return;
    }
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
        {/* One sliding row: on narrow screens the passenger switch is reached
            by scrolling past the last section instead of pinning beside them. */}
        <div className="max-w-7xl mx-auto flex min-w-0 items-center gap-2 overflow-x-auto hide-scrollbar px-4 sm:px-6">
          <div className="flex shrink-0 items-stretch" role="tablist" aria-label="Administration sections">
            {TABS.map(({ id, label, Icon, secondary }, index) => (
              <button
                key={id}
                id={`admin-tab-${id}`}
                ref={button => { if (button) tabButtons.current.set(id, button); else tabButtons.current.delete(id); }}
                role="tab"
                tabIndex={activeTab === id ? 0 : -1}
                onKeyDown={event => {
                  const nextIndex = event.key === "ArrowRight" ? (index + 1) % TABS.length
                    : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length
                    : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
                  if (nextIndex === null) return;
                  event.preventDefault();
                  const nextTab = TABS[nextIndex].id;
                  selectTab(nextTab);
                  tabButtons.current.get(nextTab)?.focus();
                }}
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
          <WorkspaceLink
            href="/passenger"
            className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-white/10 px-3 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          >
            <UsersRound className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Passenger Panel</span>
          </WorkspaceLink>
        </div>
      </div>

      {/* ── Content — fills remaining height, scrolls internally per panel ── */}
      <div
        id={`admin-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`admin-tab-${activeTab}`}
        className="flex-1 min-h-0 overflow-y-auto bg-brand-dark/20"
      >
        {/* Keyed by tab so switching sections clears a contained crash. */}
        <AdminPanelErrorBoundary key={activeTab}>
          {renderPanel(activeTab)}
        </AdminPanelErrorBoundary>
      </div>

      <ConfirmModal
        isOpen={pendingTab !== null}
        title="Discard unsaved changes?"
        description="Leaving this section discards the changes you have not saved."
        confirmText="Discard changes"
        cancelText="Keep editing"
        variant="warning"
        onConfirm={() => {
          if (pendingTab) setActiveTab(pendingTab);
          setPendingTab(null);
        }}
        onCancel={() => setPendingTab(null)}
      />
    </main>
  );
}
