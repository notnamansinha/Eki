// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PassengerRoutesSettings from "./PassengerRoutesSettings";
import { hasUnsavedChanges } from "@/lib/unsavedChanges";
import type { PassengerRouteConfig } from "@/lib/passengerRouteSchedule";

type MockRoute = { id: string; name: string; color: string; stops: { id: string; name: string; shortName: string }[] };

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  retry: vi.fn(),
  config: { routes: [] } as PassengerRouteConfig,
  configLoading: false,
  configError: null as string | null,
  routes: [] as MockRoute[],
  routesLoading: false,
  routesError: null as string | null,
}));
vi.mock("@/hooks/usePassengerRouteConfig", () => ({
  usePassengerRouteConfig: () => ({ config: mocks.config, loading: mocks.configLoading, error: mocks.configError, saveConfig: mocks.save }),
}));
vi.mock("@/hooks/useRoutes", () => ({
  useRoutes: () => ({ routes: mocks.routes, loading: mocks.routesLoading, error: mocks.routesError, retry: mocks.retry }),
}));

const ROUTE_A: MockRoute = {
  id: "route_a", name: "1A", color: "#2563eb",
  stops: [
    { id: "a1", name: "Main Gate", shortName: "MG" },
    { id: "a2", name: "Library", shortName: "LIB" },
    { id: "a3", name: "Hostel", shortName: "HOS" },
  ],
};
const ROUTE_B: MockRoute = {
  id: "route_b", name: "2B", color: "#16a34a",
  stops: [{ id: "b1", name: "Stadium", shortName: "STA" }, { id: "b2", name: "Hospital", shortName: "HSP" }],
};
const EMPTY_ROUTE: MockRoute = { id: "route_c", name: "3C", color: "#f59e0b", stops: [] };

function setTime(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  mocks.save.mockReset();
  mocks.retry.mockReset();
  mocks.config = { routes: [] };
  mocks.configLoading = false;
  mocks.configError = null;
  mocks.routes = [ROUTE_A, ROUTE_B, EMPTY_ROUTE];
  mocks.routesLoading = false;
  mocks.routesError = null;
});
afterEach(cleanup);

describe("admin passenger routes settings", () => {
  it("selects nothing by default when no routes have been published", () => {
    render(<PassengerRoutesSettings />);
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(3);
    expect(boxes.every(box => !box.checked)).toBe(true);
    expect(screen.queryByRole("region")).toBeNull();
    expect((screen.getByRole("button", { name: "No route changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("reveals a selected route's stops in travel order, each with a labelled time input", async () => {
    render(<PassengerRoutesSettings />); const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /1A/ }));
    const card = screen.getByRole("region", { name: "1A" });
    const inputs = within(card).getAllByLabelText(/^Time for .* on 1A$/) as HTMLInputElement[];
    expect(inputs.map(input => input.getAttribute("aria-label"))).toEqual([
      "Time for Main Gate on 1A", "Time for Library on 1A", "Time for Hostel on 1A",
    ]);
    expect(inputs.every(input => input.type === "time" && input.value === "")).toBe(true);
    expect(new Set(inputs.map(input => input.id)).size).toBe(3);
    expect(within(card).getAllByRole("listitem").map(item => item.textContent)).toEqual(["1Main Gate", "2Library", "3Hostel"]);
    expect(hasUnsavedChanges()).toBe(true);
  });

  it("blocks save and flags the stop when a time is missing", async () => {
    render(<PassengerRoutesSettings />); const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /2B/ }));
    setTime("Time for Stadium on 2B", "07:30");
    await user.click(screen.getByRole("button", { name: "Save routes" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain('Set a time for "Hospital" on 2B.');
    expect(mocks.save).not.toHaveBeenCalled();
    const missing = screen.getByLabelText("Time for Hospital on 2B");
    expect(missing.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(missing.getAttribute("aria-describedby")!)?.textContent).toBe("Time required");
    expect(screen.getByLabelText("Time for Stadium on 2B").getAttribute("aria-invalid")).toBeNull();
  });

  it("saves the exact payload in selection order with every current stop of each route", async () => {
    mocks.save.mockResolvedValue(undefined);
    render(<PassengerRoutesSettings />); const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /2B/ }));
    await user.click(screen.getByRole("checkbox", { name: /3C/ }));
    await user.click(screen.getByRole("checkbox", { name: /1A/ }));
    expect(within(screen.getByRole("region", { name: "3C" })).getByText("This route has no stops yet.")).toBeTruthy();
    setTime("Time for Stadium on 2B", "07:30");
    setTime("Time for Hospital on 2B", "07:45");
    setTime("Time for Main Gate on 1A", "08:00");
    setTime("Time for Library on 1A", "08:10");
    setTime("Time for Hostel on 1A", "08:20");
    await user.click(screen.getByRole("button", { name: "Save routes" }));
    expect(await screen.findByText("Passenger routes saved")).toBeTruthy();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledWith({
      routes: [
        { routeId: "route_b", stopTimes: { b1: "07:30", b2: "07:45" } },
        { routeId: "route_c", stopTimes: {} },
        { routeId: "route_a", stopTimes: { a1: "08:00", a2: "08:10", a3: "08:20" } },
      ],
    });
    // Until the listener echoes the write, the saved selection stays on screen.
    expect((screen.getByRole("checkbox", { name: /2B/ }) as HTMLInputElement).checked).toBe(true);
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("drops a deselected published route from the payload and preserves the others' saved times", async () => {
    mocks.save.mockResolvedValue(undefined);
    mocks.config = { routes: [
      { routeId: "route_a", stopTimes: { a1: "08:00", a2: "08:10", a3: "08:20" } },
      { routeId: "route_b", stopTimes: { b1: "07:30", b2: "07:45" } },
    ] };
    render(<PassengerRoutesSettings />); const user = userEvent.setup();
    expect((screen.getByRole("checkbox", { name: /1A/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Time for Library on 1A") as HTMLInputElement).value).toBe("08:10");
    expect((screen.getByRole("button", { name: "No route changes" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: /1A/ }));
    expect(screen.queryByRole("region", { name: "1A" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save routes" }));
    await screen.findByText("Passenger routes saved");
    expect(mocks.save).toHaveBeenCalledWith({ routes: [{ routeId: "route_b", stopTimes: { b1: "07:30", b2: "07:45" } }] });
  });

  it("restores stored times when a published route is deselected and selected again", async () => {
    mocks.config = { routes: [{ routeId: "route_b", stopTimes: { b1: "07:30", b2: "07:45" } }] };
    render(<PassengerRoutesSettings />); const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /2B/ }));
    await user.click(screen.getByRole("checkbox", { name: /2B/ }));
    expect((screen.getByLabelText("Time for Hospital on 2B") as HTMLInputElement).value).toBe("07:45");
    expect((screen.getByRole("button", { name: "No route changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("drops approvals for deleted routes and times for deleted stops, with a notice", async () => {
    mocks.save.mockResolvedValue(undefined);
    mocks.config = { routes: [
      { routeId: "deleted_route", stopTimes: { x: "06:00" } },
      { routeId: "route_b", stopTimes: { b1: "07:30", b2: "07:45", removed_stop: "07:50" } },
    ] };
    render(<PassengerRoutesSettings />); const user = userEvent.setup();
    expect(screen.getByText("1 previously published route was deleted and will be removed when you save.")).toBeTruthy();
    expect(screen.getAllByRole("region").map(region => region.querySelector("h3")?.textContent)).toEqual(["2B"]);
    await user.click(screen.getByRole("button", { name: "Save routes" }));
    await screen.findByText("Passenger routes saved");
    expect(mocks.save).toHaveBeenCalledWith({ routes: [{ routeId: "route_b", stopTimes: { b1: "07:30", b2: "07:45" } }] });
  });

  it("reports a failed save and keeps the draft for retry", async () => {
    mocks.save.mockRejectedValueOnce(new Error("backend unavailable")).mockResolvedValueOnce(undefined);
    render(<PassengerRoutesSettings />); const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /3C/ }));
    await user.click(screen.getByRole("button", { name: "Save routes" }));
    expect((await screen.findByRole("dialog")).textContent).toContain("Failed to save passenger routes: backend unavailable");
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect((screen.getByRole("checkbox", { name: /3C/ }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole("button", { name: "Save routes" }));
    await screen.findByText("Passenger routes saved");
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });

  it("shows a loading state while routes or the stored schedule load", () => {
    mocks.configLoading = true;
    render(<PassengerRoutesSettings />);
    expect(screen.getByText("Loading passenger routes…")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("does not allow editing when the stored schedule failed to load", () => {
    mocks.configError = "Route schedules could not be loaded.";
    render(<PassengerRoutesSettings />);
    expect(screen.getByRole("alert").textContent).toContain("Route schedules could not be loaded.");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Save routes|No route changes/ })).toBeNull();
  });

  it("offers a retry when routes failed to load", async () => {
    mocks.routesError = "Failed to load routes.";
    render(<PassengerRoutesSettings />); const user = userEvent.setup();
    expect(screen.getByRole("alert").textContent).toContain("Failed to load routes.");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.retry).toHaveBeenCalledOnce();
  });
});
