import RoleGuard from "@/components/shared/RoleGuard";

export default function PassengerLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allowedRoles={["passenger", "driver", "admin"]}>
      {children}
    </RoleGuard>
  );
}
