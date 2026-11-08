import type { Metadata, Viewport } from "next";
import PassengerLoadingShell from "@/components/passenger/PassengerLoadingShell";
import RoleGuard from "@/components/shared/RoleGuard";
import WorkspacePrefetch from "@/components/shared/WorkspacePrefetch";
import "./theme.css";

// The status bar matches the AU off-white page instead of a coloured strip.
export const viewport: Viewport = { themeColor: "#f2efec" };

export const metadata: Metadata = {
  title: "Passenger live map",
  robots: { index: false, follow: false },
};

export default function PassengerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="passenger-layout relative overflow-hidden" style={{ height: "100dvh" }}>
      <PassengerLoadingShell />
      <div className="absolute inset-0 z-30">
        <RoleGuard
          allowedRoles={["passenger", "driver", "admin"]}
          loadingFallback={
            <p className="sr-only" role="status" aria-live="polite">
              Restoring your transit session…
            </p>
          }
        >
          <WorkspacePrefetch destination="/admin" />
          {children}
        </RoleGuard>
      </div>
    </div>
  );
}
