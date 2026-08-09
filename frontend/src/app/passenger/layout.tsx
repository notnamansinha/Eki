import type { Metadata } from "next";
import RoleGuard from "@/components/shared/RoleGuard";

export const metadata: Metadata = {
  title: "Passenger live map",
  robots: { index: false, follow: false },
};

export default function PassengerLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allowedRoles={["passenger", "driver", "admin"]}>
      {children}
    </RoleGuard>
  );
}
