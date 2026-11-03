// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RouteData } from "@/hooks/useRoutes";
import type { PassengerRouteConfig } from "@/lib/passengerRouteSchedule";
import RoutesTab from "./RoutesTab";

const state = vi.hoisted(() => ({
  config: { routes: [] } as PassengerRouteConfig,
  configLoading: false,
  configError: null as string | null,
  routes: [] as RouteData[],
  routesLoading: false,
  routesError: null as string | null,
  retry: (() => {}) as () => void,
  subscriptions: 0,
}));

vi.mock("@/hooks/usePassengerRouteConfig", async () => {
  const { useEffect } = await import("react");
  return {
    usePassengerRouteConfig: () => {
      // Count listener (re)opens so Retry can be shown to re-subscribe.
      useEffect(() => { state.subscriptions += 1; }, []);
      return { config: state.config, loading: state.configLoading, error: state.configError, saveConfig: async () => {} };
    },
  };
});
vi.mock("@/hooks/useRoutes", () => ({
  useRoutes: () => ({ routes: state.routes, loading: state.routesLoading, error: state.routesError, retry: state.retry }),
}));

function route(id: string, name: string, stops: [string, string][]): RouteData {
  return {
    id, name, color: "#3B82F6", waypoints: [],
    stops: stops.map(([stopId, stopName], index) => ({ id: stopId, name: stopName, shortName: stopId, lat: 23 + index / 1000, lng: 72 })),
  };
}

const loop = route("loop", "Campus Loop", [["gate", "Main Gate"], ["lib", "Central Library"], ["hostel", "Hostel Block C"], ["sports", "Sports Complex"], ["admin", "Admin Building"]]);
const express = route("express", "Express", [["x1", "North Gate"], ["x2", "South Gate"]]);
const hidden = route("hidden", "Unapproved Route", [["h1", "Secret Stop"]]);

beforeEach(() => {
  state.config = { routes: [
    { routeId: "express", stopTimes: { x1: "12:30" } },
    { routeId: "loop", stopTimes: { gate: "07:05", lib: "07:12", hostel: "07:20", admin: "00:00" } },
  ] };
  state.configLoading = false;
  state.configError = null;
  state.routes = [loop, hidden, express];
  state.routesLoading = false;
  state.routesError = null;
  state.retry = vi.fn();
  state.subscriptions = 0;
});
afterEach(cleanup);

const stopItems = (routeName: string) =>
  within(screen.getByRole("list", { name: `${routeName} stops` })).getAllByRole("listitem");

describe("passenger Routes tab", () => {
  it("renders only approved routes, in approval order", () => {
    render(<RoutesTab />);
    expect(within(screen.getByRole("list", { name: "Published routes" })).getAllByRole("button").map(row => row.getAttribute("aria-label")))
      .toEqual(["View schedule for Express", "View schedule for Campus Loop"]);
    expect(screen.queryByText("Unapproved Route")).toBeNull();
    expect(screen.queryByText("Secret Stop")).toBeNull();
  });

  it("opens the selected route and lists scheduled stops in source order", async () => {
    render(<RoutesTab />);
    const user = userEvent.setup();
    const row = screen.getByRole("button", { name: "View schedule for Campus Loop" });
    await user.click(row);
    expect(stopItems("Campus Loop").map(item => item.textContent)).toEqual([
      "Main GateScheduled 7:05 am",
      "Central LibraryScheduled 7:12 am",
      "Hostel Block CScheduled 7:20 am",
      "Sports ComplexTime not set",
      "Admin BuildingScheduled 12:00 am",
    ]);
    expect(screen.getByText("Scheduled stops · 5 stops")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back to all routes" }));
    expect(document.activeElement).toBe(row);
  });

  it("matches stop names locally and reports an empty search", async () => {
    render(<RoutesTab />);
    const user = userEvent.setup();
    const search = screen.getByRole("searchbox");
    await user.type(search, "library");
    expect(screen.getByRole("button", { name: "View schedule for Campus Loop" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View schedule for Express" })).toBeNull();
    await user.type(search, "xx");
    expect(screen.getByText("No routes match your search.")).toBeTruthy();
  });

  it("keeps Back usable when the selected schedule is unpublished", async () => {
    const { rerender } = render(<RoutesTab />);
    await userEvent.setup().click(screen.getByRole("button", { name: "View schedule for Campus Loop" }));
    state.routes = [express];
    rerender(<RoutesTab />);
    expect(screen.getByText("This route is no longer published. Choose another route.")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back to all routes" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Routes" }));
  });

  it("shows a missing time as not set", () => {
    render(<RoutesTab />);
    const [north, south] = stopItems("Express");
    expect(within(north).getByText("Scheduled 12:30 pm")).toBeTruthy();
    expect(within(south).getByText("Time not set")).toBeTruthy();
  });

  it("explains an approved route without stops", () => {
    state.routes = [{ ...express, stops: [] }];
    state.config = { routes: [{ routeId: "express", stopTimes: {} }] };
    render(<RoutesTab />);
    expect(screen.getByText("No stops listed for this route yet")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Express stops" })).toBeNull();
  });

  it("shows the empty state when nothing is published", () => {
    state.config = { routes: [] };
    render(<RoutesTab />);
    expect(screen.getByText("No routes published yet")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows the empty state when every approved route was deleted", () => {
    state.routes = [hidden];
    render(<RoutesTab />);
    expect(screen.getByText("No routes published yet")).toBeTruthy();
  });

  it("shows a loading state while either source is pending", () => {
    state.configLoading = true;
    const { unmount } = render(<RoutesTab />);
    expect(screen.getByRole("status").textContent).toContain("Loading routes");
    expect(screen.queryByRole("list")).toBeNull();
    unmount();
    state.configLoading = false;
    state.routesLoading = true;
    state.routes = [];
    render(<RoutesTab />);
    expect(screen.getByRole("status").textContent).toContain("Loading routes");
  });

  it("shows an error with a Retry that re-opens both listeners", async () => {
    state.configError = "Route schedules could not be loaded.";
    render(<RoutesTab />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Route schedules could not be loaded.");
    expect(screen.queryByRole("list")).toBeNull();
    expect(state.subscriptions).toBe(1);
    state.configError = null;
    await userEvent.setup().click(within(alert).getByRole("button", { name: "Retry" }));
    expect(state.retry).toHaveBeenCalledTimes(1);
    expect(state.subscriptions).toBe(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(screen.getByRole("list", { name: "Published routes" })).getAllByRole("button")).toHaveLength(2);
  });

  it("reports a routes read failure", () => {
    state.routesError = "Missing or insufficient permissions.";
    render(<RoutesTab />);
    expect(screen.getByRole("alert").textContent).toContain("Missing or insufficient permissions.");
  });
});
