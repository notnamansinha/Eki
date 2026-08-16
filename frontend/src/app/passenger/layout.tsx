import type { Metadata } from "next";
import PassengerLoadingShell from "@/components/passenger/PassengerLoadingShell";
import RoleGuard from "@/components/shared/RoleGuard";

export const metadata: Metadata = {
  title: "Passenger live map",
  robots: { index: false, follow: false },
};

export default function PassengerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden" style={{ height: "100dvh" }}>
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
          {children}
        </RoleGuard>
      </div>
    </div>
  );
}
