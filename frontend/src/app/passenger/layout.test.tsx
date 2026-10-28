// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import PassengerLayout from "./layout";
vi.mock("@/components/shared/RoleGuard", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/shared/WorkspacePrefetch", () => ({ default: () => null }));
afterEach(cleanup);
describe("passenger layout loading shell", () => {
  it("marks only initialization UI for hiding, keeping the illustration as the backdrop", () => {
    const { container } = render(<PassengerLayout><div data-passenger-workspace>ready</div></PassengerLayout>);
    const status = screen.getByText("Restoring your transit session…").closest("[data-passenger-loading-placeholder]");
    expect(status).not.toBeNull();
    expect(container.querySelector("picture")?.closest("[data-passenger-loading-placeholder]")).toBeNull();
    expect(container.querySelector(".passenger-layout")?.matches(":has([data-passenger-workspace])")).toBe(true);
  });
  it("hides initialization UI once the workspace is mounted and stops document overscroll", () => {
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8").replace(/\s+/g, " ");
    expect(css).toContain(".passenger-layout:has([data-passenger-workspace]) [data-passenger-loading-placeholder] { display: none; }");
    expect(css).toMatch(/html:has\(\.passenger-layout\)[^{]*{ overscroll-behavior-y: none;/);
  });
});
