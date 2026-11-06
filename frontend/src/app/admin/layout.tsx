import type { Metadata } from "next";
import RoleGuard from "@/components/shared/RoleGuard";
import MapProviders from "@/components/MapProviders";
import WorkspacePrefetch from "@/components/shared/WorkspacePrefetch";
import "./theme.css";

export const metadata: Metadata = {
  title: "Administration",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-layout min-h-dvh">
      <RoleGuard allowedRoles={["admin"]}>
        <WorkspacePrefetch destination="/passenger" />
        <MapProviders>
          {children}
        </MapProviders>
      </RoleGuard>
    </div>
  );
}
