import type { ReactNode } from "react";
// Stand-in for RoleGuard/WorkspacePrefetch: the fixture identity is already authorized.
export default function Passthrough({ children }: { children?: ReactNode }) { return <>{children}</>; }
