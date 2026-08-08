import type { Metadata } from "next";
import RoleGuard from "@/components/shared/RoleGuard";

export const metadata: Metadata = {
  title: "Feedback administration",
  robots: { index: false, follow: false },
};

export default function FeedbackLayout({ children }: { children: React.ReactNode }) {
  return <RoleGuard allowedRoles={["admin"]}>{children}</RoleGuard>;
}
