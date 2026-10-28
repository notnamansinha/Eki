// @vitest-environment jsdom
import { lazy, Suspense, useState, type ComponentType } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { useUnsavedChanges } from "@/lib/unsavedChanges";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import AdminPage from "./page";
vi.mock("next/dynamic", () => ({ default: (loader: () => Promise<{ default: ComponentType<Record<string, unknown>> }>) => {
  const Loaded = lazy(loader);
  return function TestDynamic(props: Record<string, unknown>) { return <Suspense fallback="Loading panel"><Loaded {...props} /></Suspense>; };
} }));
vi.mock("@/components/admin/DashboardPanel", () => ({ default: () => <p>Operations content</p> }));
vi.mock("@/components/admin/RouteManagementPanel", () => ({ default: function Routes() {
  const [dirty, setDirty] = useState(false); useUnsavedChanges(dirty);
  return <><p>Routes content</p><button type="button" onClick={() => setDirty(true)}>Start draft</button></>;
} }));
vi.mock("@/components/admin/FleetManagementPanel", () => ({ default: () => <p>Fleet content</p> }));
const crash = vi.hoisted(() => ({ history: false }));
vi.mock("@/components/admin/RideHistoryPanel", () => ({ default: () => {
  if (crash.history) throw new Error("malformed ride_sessions document");
  return <p>History content</p>;
} }));
vi.mock("@/components/admin/FeedbackPanel", () => ({ default: () => <p>Feedback content</p> }));
vi.mock("@/components/admin/SettingsPanel", () => ({ default: () => <p>Settings content</p> }));
afterEach(() => { cleanup(); crash.history = false; vi.restoreAllMocks(); });
describe("all administration sections", () => {
  it("ends the sliding section row with the passenger panel link, outside the tab list", () => {
    render(<AdminPage />);
    const link = screen.getByRole("link", { name: "Passenger Panel" });
    const tablist = screen.getByRole("tablist");
    expect(link.getAttribute("href")).toBe("/passenger");
    expect(tablist.contains(link)).toBe(false);
    // The link scrolls with the tabs instead of pinning beside them.
    const row = tablist.parentElement!;
    expect(row.className).toContain("overflow-x-auto");
    expect(row.lastElementChild).toBe(link);
    expect(tablist.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it.each([
    ["Live Ops", "Operations"], ["Routes", "Routes"], ["Fleet & People", "Fleet"],
    ["History", "History"], ["Feedback", "Feedback"], ["Settings", "Settings"],
  ])("opens %s with the matching panel and selection state", async (label, content) => {
    render(<AdminPage />); const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: label }));
    expect(await screen.findByText(`${content} content`)).toBeTruthy();
    expect(screen.getByRole("tab", { name: label }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(screen.getByRole("tab", { name: label }).id);
    expect(screen.getAllByRole("tab").filter(tab => tab.getAttribute("tabindex") === "0")).toHaveLength(1);
  });
  it("navigates with arrow keys, Home and End, wrapping between the first and last tabs", async () => {
    render(<AdminPage />); const user=userEvent.setup();
    screen.getByRole("tab", { name: "Live Ops" }).focus();
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Settings" }));
    await screen.findByText("Settings content");
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Live Ops" }));
    await user.keyboard("{End}"); expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Settings" }));
    await user.keyboard("{Home}"); expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Live Ops" }));
  });
  it("asks before another section discards an unsaved draft", async () => {
    render(<AdminPage />); const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Routes" }));
    await user.click(await screen.findByRole("button", { name: "Start draft" }));
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await user.click(screen.getByRole("tab", { name: "History" }));
    const dialog = screen.getByRole("dialog");
    expect(screen.getByText("Routes content")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("tab", { name: "Routes" }).getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("tab", { name: "History" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Discard changes" }));
    expect(await screen.findByText("History content")).toBeTruthy();
    const later = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });
  it("contains a panel crash so the tab bar and other sections keep working", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    crash.history = true;
    render(<AdminPage />); const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "History" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not be displayed/);
    expect(screen.getByRole("tablist")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Fleet & People" }));
    expect(await screen.findByText("Fleet content")).toBeTruthy();
    crash.history = false;
    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(await screen.findByText("History content")).toBeTruthy();
    crash.history = true;
    await user.click(screen.getByRole("tab", { name: "Live Ops" }));
    await screen.findByText("Operations content");
  });
  it("retries a crashed panel in place", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    crash.history = true;
    render(<AdminPage />); const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "History" }));
    await screen.findByRole("alert");
    crash.history = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("History content")).toBeTruthy();
  });
});
