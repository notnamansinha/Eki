import RoleGuard from "@/components/shared/RoleGuard";
import MapProviders from "@/components/MapProviders";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allowedRoles={["admin"]}>
      <MapProviders>
        {children}
      </MapProviders>
    </RoleGuard>
  );
}