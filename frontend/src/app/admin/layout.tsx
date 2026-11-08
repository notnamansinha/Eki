import type { Metadata, Viewport } from "next";
import RoleGuard from "@/components/shared/RoleGuard";
import MapProviders from "@/components/MapProviders";
import WorkspacePrefetch from "@/components/shared/WorkspacePrefetch";
import "./theme.css";

// The status bar matches the AU off-white page instead of a coloured strip.
export const viewport: Viewport = { themeColor: "#f2efec" };

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
