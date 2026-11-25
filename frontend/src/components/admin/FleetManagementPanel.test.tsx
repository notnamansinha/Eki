// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FleetManagementPanel from "./FleetManagementPanel";
import type { ActiveBusEntry } from "@/lib/activeBusEntries";
import type { UseActiveBusesOptions } from "@/hooks/useActiveBuses";
import { hasUnsavedChanges } from "@/lib/unsavedChanges";
const DEFAULT_BUSES = [{ id: "qa-bus", name: "QA Bus", assignedRoutes: ["qa-route"] as string[] | undefined, assignedRouteId: undefined as string | undefined }];
const live = vi.hoisted(() => ({ entries: [] as ActiveBusEntry[], options: null as UseActiveBusesOptions | null, driversUnavailable: false, buses: [] as Array<{ id: string; name: string; assignedRoutes?: string[]; assignedRouteId?: string }> }));
vi.mock("@/hooks/useBuses", () => ({ useBuses: () => ({ buses: live.buses, loading: false }) }));
vi.mock("@/hooks/useDrivers", () => { const drivers = [{ id: "qa-driver", name: "QA Driver", authUid: "qa-driver-uid", busId: "qa-bus" }]; return { useDrivers: () => ({ drivers: live.driversUnavailable ? [] : drivers, loading: false }) }; });
vi.mock("@/hooks/useRoutes", () => ({ useRoutes: () => ({ routes: [{ id: "qa-route", name: "QA route" }], loading: false }) }));
vi.mock("@/hooks/useActiveBuses", () => ({ useActiveBuses: (options?: UseActiveBusesOptions) => { live.options = options ?? null; return live.entries; } }));
vi.mock("@/lib/firebaseAuth", () => ({ auth: { currentUser: { getIdToken: async () => "test-token" } } }));
beforeEach(() => { live.entries = []; live.driversUnavailable = false; live.buses = DEFAULT_BUSES.map(bus => ({ ...bus })); vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://qa.ngrok-free.dev"); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("fleet live read failures and drafts", () => {
  it("names a permission denial instead of blaming the connection", () => {
    render(<FleetManagementPanel />);
    act(() => live.options?.onReadError?.(Object.assign(new Error("permission_denied at /publicRouteBuses"), { code: "PERMISSION_DENIED" })));
    expect(screen.getByText(/not permitted to read live data/)).toBeTruthy();
    expect(screen.queryByText(/Check your connection/)).toBeNull();
  });

  it("keeps the connection advice for other read failures", () => {
    render(<FleetManagementPanel />);
    act(() => live.options?.onReadError?.(new Error("Network request failed")));
    expect(screen.getByText("Live vehicle updates are unavailable. Check your connection and reload to retry.")).toBeTruthy();
  });

  it("reports an add-vehicle draft as unsaved so switching tabs warns first", async () => {
    render(<FleetManagementPanel />); const user = userEvent.setup();
    expect(hasUnsavedChanges()).toBe(false);
    await user.type(screen.getByLabelText("New operator display name"), "Draft driver");
    expect(hasUnsavedChanges()).toBe(true);
    await user.clear(screen.getByLabelText("New operator display name"));
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("reports a changed vehicle edit as unsaved, but not an untouched or cancelled one", async () => {
    render(<FleetManagementPanel />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit vehicle QA Bus" }));
    expect(hasUnsavedChanges()).toBe(false);
    const editor = within(screen.getByText("Editing Vehicle").parentElement!);
    await user.click(editor.getByRole("checkbox", { name: "QA route" }));
    expect(hasUnsavedChanges()).toBe(true);
    await user.click(screen.getByRole("button", { name: "Cancel editing vehicle" }));
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("treats unticking and reticking an assigned route as no change", async () => {
    live.buses = [{ id: "qa-bus", name: "QA Bus", assignedRoutes: ["qa-route", "qa-route-2"] }];
    render(<FleetManagementPanel />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit vehicle QA Bus" }));
    const editor = within(screen.getByText("Editing Vehicle").parentElement!);
    await user.click(editor.getByRole("checkbox", { name: "QA route" }));
    expect(hasUnsavedChanges()).toBe(true);
    // Reticking appends the route after qa-route-2: a new order, the same assignment.
    await user.click(editor.getByRole("checkbox", { name: "QA route" }));
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("keeps an operator edit unsaved when the saved operator list becomes unavailable mid-edit", async () => {
    const view = render(<FleetManagementPanel />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit operator QA Driver" }));
    expect(hasUnsavedChanges()).toBe(false);
    await user.type(screen.getByLabelText("Edit operator display name"), " renamed");
    expect(hasUnsavedChanges()).toBe(true);
    live.driversUnavailable = true; view.rerender(<FleetManagementPanel />);
    expect(hasUnsavedChanges()).toBe(true);
    live.driversUnavailable = false; view.rerender(<FleetManagementPanel />);
    await user.click(screen.getByRole("button", { name: "Cancel editing operator" }));
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("stops reporting the draft once the panel unmounts", async () => {
    const view = render(<FleetManagementPanel />); const user = userEvent.setup();
    await user.type(screen.getByLabelText("New operator ID"), "draft_driver");
    expect(hasUnsavedChanges()).toBe(true);
    view.unmount();
    expect(hasUnsavedChanges()).toBe(false);
  });
});

describe("fleet and personnel controls", () => {
  it("keeps route checkboxes operable when editing a vehicle and discards cancelled selections", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<FleetManagementPanel />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit vehicle QA Bus" }));
    const editor = within(screen.getByText("Editing Vehicle").parentElement!);
    const route = editor.getByRole("checkbox", { name: "QA route" }) as HTMLInputElement;
    expect(route.checked).toBe(true);
    await user.click(route);
    expect(route.checked).toBe(false);
    await user.click(screen.getByRole("button", { name: "Cancel editing vehicle" }));
    await user.click(screen.getByRole("button", { name: "Edit vehicle QA Bus" }));
    const reopened = within(screen.getByText("Editing Vehicle").parentElement!);
    expect((reopened.getByRole("checkbox", { name: "QA route" }) as HTMLInputElement).checked).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("announces and focuses operator validation in the operator form", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<FleetManagementPanel />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add new operator" }));
    const error = screen.getByRole("alert");
    expect(error.textContent).toContain("Operator ID is required.");
    expect(error.parentElement?.textContent).toContain("Register new operator");
    expect(document.activeElement).toBe(error);
    await user.click(screen.getByRole("button", { name: "Add new operator" }));
    expect(document.activeElement).toBe(error);
    expect(fetchMock).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("New operator ID"), "driver1");
    await user.click(screen.getByRole("button", { name: "Add new operator" }));
    expect(screen.getByRole("alert").textContent).toContain("Operator display name is required.");
    expect(document.activeElement).toBe(screen.getByRole("alert"));
  });

  it("keeps a server operator error beside the form and retains the draft", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"Operator already exists"}', { status: 409 })));
    render(<FleetManagementPanel />); const user = userEvent.setup();
    await user.type(screen.getByLabelText("New operator ID"), "existing_driver");
    await user.type(screen.getByLabelText("New operator display name"), "Draft driver");
    await user.type(screen.getByLabelText("Firebase Auth UID for new operator"), "uid_1");
    await user.click(screen.getByRole("button", { name: "Add new operator" }));
    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain("Operator already exists");
    expect(error.parentElement?.textContent).toContain("Register new operator");
    expect(document.activeElement).toBe(error);
    expect((screen.getByLabelText("New operator display name") as HTMLInputElement).value).toBe("Draft driver");
  });
  it("keeps a newly received fix online between freshness ticks and still expires silence", () => {
    vi.useFakeTimers(); const start = Date.now();
    live.entries = [{ busId: "qa-bus", routeId: "qa-route", deviceState: "online", timestamp: start }];
    const view = render(<FleetManagementPanel />);
    expect(screen.getByText("Device online")).toBeTruthy();
    vi.setSystemTime(start + 12_000);
    live.entries = [{ ...live.entries[0], timestamp: Date.now() }];
    view.rerender(<FleetManagementPanel />);
    expect(screen.getByText("Device online")).toBeTruthy();
    vi.setSystemTime(start + 400_000);
    view.rerender(<FleetManagementPanel />);
    expect(screen.getByText("Device offline / stale")).toBeTruthy();
  });
  it("validates empty vehicle and operator forms before any API call", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); render(<FleetManagementPanel />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add new vehicle" })); expect(screen.getByText("Vehicle ID is required.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Dismiss error" }));
    await user.click(screen.getByRole("button", { name: "Add new operator" })); expect(screen.getByText("Operator ID is required.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["vehicle QA Bus", "operator QA Driver"])("cancels deletion of %s without a write", async target => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); render(<FleetManagementPanel />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: `Delete ${target}` }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("cancels inline edits and collapses/reopens saved vehicle and operator lists", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); render(<FleetManagementPanel />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit vehicle QA Bus" }));
    await user.clear(screen.getByLabelText("Edit vehicle display name")); await user.type(screen.getByLabelText("Edit vehicle display name"), "Unsaved vehicle");
    await user.click(screen.getByRole("button", { name: "Cancel editing vehicle" }));
    await user.click(screen.getByRole("button", { name: "Collapse saved vehicles" }));
    expect(screen.queryByRole("button", { name: "Edit vehicle QA Bus" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Expand saved vehicles" }));
    expect(screen.getByRole("button", { name: "Edit vehicle QA Bus" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Edit operator QA Driver" }));
    await user.click(screen.getByRole("button", { name: "Cancel editing operator" }));
    await user.click(screen.getByRole("button", { name: "Collapse saved operators" }));
    await user.click(screen.getByRole("button", { name: "Expand saved operators" }));
    expect(screen.getByRole("button", { name: "Edit operator QA Driver" })).toBeTruthy(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("retains new vehicle input after a server rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"vehicle already exists"}', { status: 409 })));
    render(<FleetManagementPanel />); const user = userEvent.setup();
    await user.type(screen.getByLabelText("New vehicle Bus ID"), "qa-bus-new");
    await user.type(screen.getByLabelText("New vehicle display name"), "QA duplicate");
    await user.click(screen.getByRole("checkbox", { name: "QA route" }));
    await user.click(screen.getByRole("button", { name: "Add new vehicle" }));
    expect(await screen.findByText(/vehicle already exists/)).toBeTruthy();
    expect((screen.getByLabelText("New vehicle display name") as HTMLInputElement).value).toBe("QA duplicate");
  });
  it("refuses to register a vehicle ID that already exists instead of overwriting it", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<FleetManagementPanel />); const user = userEvent.setup();
    await user.type(screen.getByLabelText("New vehicle Bus ID"), " qa-bus ");
    await user.type(screen.getByLabelText("New vehicle display name"), "Replacement");
    await user.click(screen.getByRole("button", { name: "Add new vehicle" }));
    expect(screen.getByText(/Vehicle ID "qa-bus" already exists/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((screen.getByLabelText("New vehicle display name") as HTMLInputElement).value).toBe("Replacement");
  }, 15_000);
  it("refuses to register an operator ID that already exists instead of overwriting it", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<FleetManagementPanel />); const user = userEvent.setup();
    await user.type(screen.getByLabelText("New operator ID"), "qa-driver");
    await user.type(screen.getByLabelText("New operator display name"), "Someone else");
    await user.type(screen.getByLabelText("Firebase Auth UID for new operator"), "other-uid");
    await user.click(screen.getByRole("button", { name: "Add new operator" }));
    expect(screen.getByRole("alert").textContent).toContain('Operator ID "qa-driver" already exists');
    expect(fetchMock).not.toHaveBeenCalled();
  }, 15_000);
  it("keeps a legacy single-route assignment when only the vehicle name is edited", async () => {
    live.buses = [{ id: "qa-bus", name: "QA Bus", assignedRouteId: "qa-route" }];
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"saved":true}', { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    render(<FleetManagementPanel />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit vehicle QA Bus" }));
    expect((within(screen.getByText("Editing Vehicle").parentElement!).getByRole("checkbox", { name: "QA route" }) as HTMLInputElement).checked).toBe(true);
    await user.type(screen.getByLabelText("Edit vehicle display name"), " renamed");
    await user.click(screen.getByRole("button", { name: "Save vehicle changes" }));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: "QA Bus renamed", assignedRoutes: ["qa-route"] });
  }, 15_000);
  it.each([["vehicle QA Bus", "Vehicle"], ["operator QA Driver", "Operator"]])("shows why deleting %s failed instead of leaving the error behind the dialog", async (target, kind) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"Still bound to an active ride."}', { status: 409 })));
    render(<FleetManagementPanel />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: `Delete ${target}` }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Delete/ }));
    expect(await screen.findByText(`Failed to delete ${kind}: Still bound to an active ride.`)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  }, 15_000);
});
