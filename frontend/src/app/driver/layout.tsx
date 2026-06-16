import RoleGuard from "@/components/shared/RoleGuard";

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allowedRoles={["driver", "admin"]}>
      {children}
    </RoleGuard>
  );
}
