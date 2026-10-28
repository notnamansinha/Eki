// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import AdminLayout from "./layout";
const guard = vi.hoisted(() => ({ roles: [] as string[] }));
vi.mock("@/components/shared/RoleGuard", () => ({ default: ({ allowedRoles, children }: { allowedRoles: string[]; children: React.ReactNode }) => { guard.roles = allowedRoles; return <>{children}</>; } }));
vi.mock("@/components/shared/WorkspacePrefetch", () => ({ default: () => null }));
vi.mock("@/components/MapProviders", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
afterEach(cleanup);
describe("administration access", () => {
  it("admits only administrators, so the passenger-panel switch is admin-only", () => {
    render(<AdminLayout><p>admin</p></AdminLayout>);
    expect(guard.roles).toEqual(["admin"]);
  });
});
