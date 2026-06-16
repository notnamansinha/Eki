import RoleGuard from "@/components/shared/RoleGuard";

export default function FeedbackLayout({ children }: { children: React.ReactNode }) {
  return <RoleGuard allowedRoles={["admin"]}>{children}</RoleGuard>;
}
