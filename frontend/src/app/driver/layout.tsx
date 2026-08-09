import type { Metadata } from "next";
import RoleGuard from "@/components/shared/RoleGuard";
import MapProviders from "@/components/MapProviders";

export const metadata: Metadata = {
  title: "Driver workspace",
  robots: { index: false, follow: false },
};

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allowedRoles={["driver", "admin"]}>
      <MapProviders>
        {children}
      </MapProviders>
    </RoleGuard>
  );
}
