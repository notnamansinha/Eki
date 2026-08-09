import type { Metadata } from "next";
import RoleGuard from "@/components/shared/RoleGuard";
import MapProviders from "@/components/MapProviders";

export const metadata: Metadata = {
  title: "Administration",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allowedRoles={["admin"]}>
      <MapProviders>
        {children}
      </MapProviders>
    </RoleGuard>
  );
}
