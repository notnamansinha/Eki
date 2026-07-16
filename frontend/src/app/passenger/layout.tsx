import RoleGuard from "@/components/shared/RoleGuard";
import MapProviders from "@/components/MapProviders";

export default function PassengerLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allowedRoles={["passenger", "driver", "admin"]}>
      <MapProviders>
        {children}
      </MapProviders>
    </RoleGuard>
  );
}
