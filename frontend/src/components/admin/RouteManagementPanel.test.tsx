// @vitest-environment jsdom
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RouteManagementPanel from "./RouteManagementPanel";
import { ApiError } from "@/lib/apiClient";
import { hasUnsavedChanges } from "@/lib/unsavedChanges";
const mocks = vi.hoisted(() => ({ save: vi.fn(), newId: vi.fn(), route: {
  id: "qa-route", name: "QA route", color: "#3B82F6", waypoints: [], configVersion: 2,
  stops: [{ id: "alpha", name: "Alpha", shortName: "A", lat: 23, lng: 72 }, { id: "beta", name: "Beta", shortName: "B", lat: 23.01, lng: 72.01 }],
} }));
vi.mock("@/hooks/useRoutes", () => ({ useRoutes: () => ({ routes: [mocks.route], loading: false }) }));
vi.mock("@/lib/firebaseAuth", () => ({ auth: { currentUser: { getIdToken: async () => "test-token" } } }));
vi.mock("@/lib/routeSaveClient", () => ({ saveRoute: mocks.save, newRouteSaveId: mocks.newId }));
vi.mock("@vis.gl/react-google-maps", () => ({ Map: ({ children }: { children: ReactNode }) => <div>{children}</div>, AdvancedMarker: () => null, useMap: () => null }));
vi.mock("@/components/maps/DirectionsRoute", () => ({ default: () => null }));
beforeEach(() => { mocks.save.mockReset(); mocks.newId.mockReset().mockReturnValue("qa-save-operation"); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function edit() { render(<RouteManagementPanel />); const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "Edit route QA route" })); return user; }
describe("route card distance", () => {
  const stopsRow = () => screen.getByRole("button", { name: /2 Stops/ }).parentElement!;
  it.each([[0, "2 Stops"], [undefined, "2 Stops"], [12_345, "2 Stops12.3 km"]])("shows distance %s without a stray zero", (distanceMeters, text) => {
    const route = mocks.route as typeof mocks.route & { distanceMeters?: number };
    route.distanceMeters = distanceMeters;
    try {
      render(<RouteManagementPanel />);
      expect(stopsRow().textContent).toBe(text);
    } finally { delete route.distanceMeters; }
  });
});

describe("route editing and operation recovery", () => {
  it("clears predictions immediately for a changed query and ignores a cancelled response", async () => {
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://qa.ngrok-free.dev");
    let resolveLater!: (response: Response) => void;
    const prediction = { name: "First result", lat: 23, lng: 72 };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ results: [prediction] })))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveLater = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    await edit(); vi.useFakeTimers();
    const input = screen.getByRole("searchbox", { name: "Search for a stop" });
    fireEvent.change(input, { target: { value: "First" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByRole("button", { name: "First result" })).toBeTruthy();
    fireEvent.change(input, { target: { value: "Second" } });
    expect(screen.queryByRole("button", { name: "First result" })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.change(input, { target: { value: "x" } });
    await act(async () => resolveLater(new Response(JSON.stringify({ results: [{ ...prediction, name: "Late result" }] }))));
    expect(screen.queryByRole("button", { name: "Late result" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    { draft: "", commit: "{Enter}" },
    { draft: "   ", commit: "{Enter}" },
    { draft: "", commit: "{Tab}" },
    { draft: "   ", commit: "{Tab}" },
  ])("keeps the previous stop name and explains a blank rename: %j", async ({ draft, commit }) => {
    mocks.save.mockResolvedValue({ saved: true });
    const user = await edit();
    await user.click(screen.getByRole("button", { name: /^Alpha/ }));
    const input = screen.getByRole("textbox", { name: "Rename stop Alpha" });
    await user.clear(input);
    if (draft) await user.type(input, draft);
    await user.keyboard(commit);
    expect(screen.getByRole("alert").textContent).toContain("Stop name cannot be blank");
    expect(screen.getByRole("button", { name: /^Alpha/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Update" }));
    expect(mocks.save.mock.calls[0][2].stops[0].name).toBe("Alpha");
  });

  it("cancels a stop rename with Escape, then allows a fresh rename to commit once", async () => {
    mocks.save.mockResolvedValue({ saved: true });
    const user = await edit();
    await user.click(screen.getByRole("button", { name: /^Alpha/ }));
    await user.clear(screen.getByRole("textbox", { name: "Rename stop Alpha" }));
    await user.type(screen.getByRole("textbox", { name: "Rename stop Alpha" }), "Discard this name");
    await user.keyboard("{Escape}{Tab}");
    expect(screen.queryByRole("textbox", { name: "Rename stop Alpha" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /^Alpha/ }));
    const input = screen.getByRole("textbox", { name: "Rename stop Alpha" });
    expect((input as HTMLInputElement).value).toBe("Alpha");
    await user.clear(input); await user.type(input, "Saved name{Enter}{Tab}");
    await user.click(screen.getByRole("button", { name: "Update" }));
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save.mock.calls[0][2].stops[0].name).toBe("Saved name");
    expect(mocks.route.stops[0].name).toBe("Alpha");
  });
  it("provides labels and selection state for route fields and colour controls", async () => {
    const user = await edit();
    expect((screen.getByLabelText("Route ID") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Display Name") as HTMLInputElement).value).toBe("QA route");
    const green = screen.getByRole("button", { name: "Route colour #10B981" });
    await user.click(green); expect(green.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Route colour #3B82F6" }).getAttribute("aria-pressed")).toBe("false");
  });
  it("swaps endpoints and cancels the draft without changing the original route", async () => {
    const user = await edit(); await user.click(screen.getByRole("button", { name: "Swap A & B" }));
    expect(screen.getAllByRole("button", { name: /^(Alpha|Beta)/ }).map(button => button.textContent?.split(/\d/)[0].trim())).toEqual(["Beta", "Alpha"]);
    await user.click(screen.getByRole("button", { name: "Cancel route editing" }));
    await user.click(screen.getByRole("button", { name: "Edit route QA route" }));
    expect(screen.getAllByRole("button", { name: /^(Alpha|Beta)/ }).map(button => button.textContent?.split(/\d/)[0].trim())).toEqual(["Alpha", "Beta"]);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("disables save after removing a stop and never deploys an empty route", async () => {
    const user = await edit(); await user.click(screen.getByRole("button", { name: "Remove stop Beta" }));
    expect((screen.getByRole("button", { name: "Update" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Cancel route editing" }));
    await user.click(screen.getByRole("button", { name: "Add Route" }));
    expect((screen.getByRole("button", { name: "Deploy" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("reconciles a failed save using the same operation ID and expected version", async () => {
    mocks.save.mockRejectedValueOnce(new ApiError("response lost", "NETWORK_TIMEOUT", null, "network", true)).mockResolvedValueOnce({ saved: true });
    const user = await edit(); await user.click(screen.getByRole("button", { name: "Update" }));
    await screen.findByText(/response lost/); await user.click(screen.getByRole("button", { name: "OK" }));
    await user.click(screen.getByRole("button", { name: "Update" }));
    expect(await screen.findByText("Route updated!")).toBeTruthy();
    expect(mocks.newId).toHaveBeenCalledOnce();
    expect(mocks.save.mock.calls.map(call => call[1])).toEqual(["qa-save-operation", "qa-save-operation"]);
    expect(mocks.save.mock.calls[1][2]).toMatchObject({ expectedVersion: 2 });
  });
  it("keeps a newly opened draft open when a cancelled earlier save completes later", async () => {
    let finishSave!: (value: unknown) => void;
    mocks.save.mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }));
    const user = await edit();
    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(screen.getByRole("button", { name: "Cancel route editing" }));
    await user.click(screen.getByRole("button", { name: "Add Route" }));
    await user.type(screen.getByLabelText("Display Name"), "Unsaved new route");
    await act(async () => { finishSave({ saved: true }); });
    expect((screen.getByLabelText("Display Name") as HTMLInputElement).value).toBe("Unsaved new route");
    expect(screen.getByRole("button", { name: "Deploy" })).toBeTruthy();
  });
  it("cancel never deletes a route", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); render(<RouteManagementPanel />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete route QA route" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
  it("closes the delete confirmation when deletion fails so only the error dialog remains", async () => {
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://qa.ngrok-free.dev");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Route is in service" }), { status: 409 })));
    render(<RouteManagementPanel />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete route QA route" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete Route" }));
    const message = await screen.findByText("Failed to delete: Route is in service");
    expect(screen.getAllByRole("dialog")).toEqual([message.closest("[role=dialog]")]);
    expect(screen.queryByText("Delete Route?")).toBeNull();
  });
  it("reports an edited route draft as unsaved until it is cancelled", async () => {
    const user = await edit();
    expect(hasUnsavedChanges()).toBe(false);
    await user.type(screen.getByLabelText("Display Name"), " renamed");
    expect(hasUnsavedChanges()).toBe(true);
    await user.click(screen.getByRole("button", { name: "Cancel route editing" }));
    expect(hasUnsavedChanges()).toBe(false);
  }, 15_000);
});
