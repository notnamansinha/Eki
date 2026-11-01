// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BusData } from "@/hooks/useBuses";
import type { RouteData } from "@/hooks/useRoutes";
import type { PassengerRouteConfig, RouteUsage } from "@/lib/passengerRouteSchedule";
import RoutesTab from "./RoutesTab";

const state = vi.hoisted(() => ({
  config: { routes: [] } as PassengerRouteConfig,
  configLoading: false,
  configError: null as string | null,
  routes: [] as RouteData[],
  routesLoading: false,
  routesError: null as string | null,
  retry: (() => {}) as () => void,
  buses: [] as BusData[],
  busesLoading: false,
  busesError: null as string | null,
  retryBuses: (() => {}) as () => void,
  usage: {} as RouteUsage,
  usageLoading: false,
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
vi.mock("@/hooks/useBuses", () => ({
  useBuses: () => ({ buses: state.buses, loading: state.busesLoading, error: state.busesError, retry: state.retryBuses }),
}));
vi.mock("@/hooks/useRouteUsage", () => ({
  useRouteUsage: () => ({ usage: state.usage, loading: state.usageLoading, error: null }),
}));

function route(id: string, name: string, stops: [string, string][]): RouteData {
  return {
    id, name, color: "#3B82F6", waypoints: [],
    stops: stops.map(([stopId, stopName], index) => ({ id: stopId, name: stopName, shortName: stopId, lat: 23 + index / 1000, lng: 72 })),
  };
}

const loop = route("loop", "Campus Loop", [["gate", "Main Gate"], ["lib", "Central Library"], ["hostel", "Hostel Block C"], ["sports", "Sports Complex"], ["admin", "Admin Building"]]);
const express = route("express", "Express", [["x1", "North Gate"], ["x2", "South Gate"]]);
const night = route("night", "Night Shuttle", [["n1", "Hostel Gate"]]);

beforeEach(() => {
  state.config = { routes: [
    { routeId: "express", stopTimes: { x1: "12:30" } },
    { routeId: "loop", stopTimes: { gate: "07:05", lib: "07:12", hostel: "07:20", admin: "00:00" } },
  ] };
  state.configLoading = false;
  state.configError = null;
  state.routes = [loop, night, express];
  state.routesLoading = false;
  state.routesError = null;
  state.retry = vi.fn();
  state.buses = [
    { id: "bus_10", name: "Blue Arrow", assignedRoutes: ["loop"] },
    { id: "bus_02", name: "Red Line Express", assignedRoutes: ["loop", "express"] },
    { id: "bus_07", name: "", assignedRouteId: "night" },
  ];
  state.busesLoading = false;
  state.busesError = null;
  state.retryBuses = vi.fn();
  state.usage = {};
  state.usageLoading = false;
  state.subscriptions = 0;
});
afterEach(cleanup);

const headings = () => screen.getAllByRole("heading", { level: 2 }).map(heading => heading.textContent);
const card = (routeName: string) => screen.getByRole("heading", { name: routeName, level: 2 }).closest("section")!;
const stopItems = (routeName: string) =>
  within(screen.getByRole("list", { name: `${routeName} stops` })).getAllByRole("listitem");
const toggle = (routeName: string) => screen.getByRole("button", { name: `${routeName} schedule` });
const expand = (routeName: string) => userEvent.setup().click(toggle(routeName));

describe("passenger Routes tab", () => {
  it("lists every route, approved ones first while no usage is published", () => {
    render(<RoutesTab />);
    expect(headings()).toEqual(["Express", "Campus Loop", "Night Shuttle"]);
    expect(card("Night Shuttle").textContent).toContain("Times not set");
    expect(document.querySelector("[data-ride-count]")).toBeNull();
  });

  it("puts the most-used route on top with its ride count and no badge", () => {
    state.usage = { loop: 3, express: 0, night: 1284 };
    render(<RoutesTab />);
    expect(headings()).toEqual(["Night Shuttle", "Campus Loop", "Express"]);
    expect(screen.queryByText(/most used/i)).toBeNull();
    expect(card("Night Shuttle").querySelector("[data-ride-count]")?.textContent).toBe("1,284 rides");
    expect(card("Express").querySelector("[data-ride-count]")?.textContent).toBe("0 rides");
  });

  it("shows each assigned bus as \"number - name\", by bus number", async () => {
    render(<RoutesTab />);
    await expand("Campus Loop");
    const buses = within(card("Campus Loop")).getByRole("list", { name: "Campus Loop buses" });
    expect(within(buses).getAllByRole("listitem").map(item => item.textContent)).toEqual([
      "bus_02 - Red Line Express",
      "bus_10 - Blue Arrow",
    ]);
    expect(within(card("Campus Loop")).queryByRole("table")).toBeNull();
    // A bus shared by two routes appears under both.
    await expand("Express");
    expect(within(card("Express")).getByText("bus_02")).toBeTruthy();
  });

  it("includes a legacy single-route assignment and shows only the number of an unnamed bus", async () => {
    render(<RoutesTab />);
    await expand("Night Shuttle");
    const buses = within(card("Night Shuttle")).getByRole("list", { name: "Night Shuttle buses" });
    expect(within(buses).getAllByRole("listitem").map(item => item.textContent)).toEqual(["bus_07"]);
  });

  it("keeps the card border unchanged when a route opens", async () => {
    render(<RoutesTab />);
    const before = card("Campus Loop").style.borderColor;
    await expand("Campus Loop");
    expect(card("Campus Loop").style.borderColor).toBe(before);
    expect(before).toBe("var(--border-subtle)");
  });

  it("says when no bus is assigned, and when bus details cannot be read", async () => {
    state.buses = [];
    const { unmount } = render(<RoutesTab />);
    await expand("Express");
    expect(within(card("Express")).getByText("No bus assigned to this route yet")).toBeTruthy();
    unmount();
    state.busesError = "Missing or insufficient permissions.";
    render(<RoutesTab />);
    // A bus read failure leaves the schedules usable.
    expect(screen.queryByRole("alert")).toBeNull();
    await expand("Express");
    expect(within(card("Express")).getByText("Bus details could not be loaded.")).toBeTruthy();
    expect(stopItems("Express")).toHaveLength(2);
  });

  it("starts collapsed and drops each route's stops down on tap", async () => {
    render(<RoutesTab />);
    expect(screen.queryAllByRole("list")).toHaveLength(0);
    expect(toggle("Campus Loop").getAttribute("aria-expanded")).toBe("false");
    // The collapsed card still summarises the route.
    const section = card("Campus Loop");
    expect(section.textContent).toContain("5 stops");
    expect(section.textContent).toContain("7:05 – 12:00 am");
    expect(section.querySelector("[data-toggle-chevron] svg")?.getAttribute("class")).not.toContain("rotate-180");
    // Only the arrow: no highlight behind it.
    expect((section.querySelector("[data-toggle-chevron]") as HTMLElement).style.background).toBe("");

    await expand("Campus Loop");
    expect(toggle("Campus Loop").getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(toggle("Campus Loop").getAttribute("aria-controls")!);
    expect(panel?.contains(screen.getByRole("list", { name: "Campus Loop stops" }))).toBe(true);
    expect(stopItems("Campus Loop")).toHaveLength(5);
    expect(section.querySelector("[data-toggle-chevron] svg")?.getAttribute("class")).toContain("rotate-180");
    // Opening one route leaves the others as they were.
    expect(screen.queryByRole("list", { name: "Express stops" })).toBeNull();

    await expand("Campus Loop");
    expect(toggle("Campus Loop").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list", { name: "Campus Loop stops" })).toBeNull();
  });

  it("opens a lone route by default", () => {
    state.routes = [loop];
    state.config = { routes: [] };
    render(<RoutesTab />);
    expect(toggle("Campus Loop").getAttribute("aria-expanded")).toBe("true");
    expect(stopItems("Campus Loop")).toHaveLength(5);
    expect(card("Campus Loop").textContent).toContain("Times not set");
  });

  it("lists stops in route order on a single rail with their times", async () => {
    render(<RoutesTab />);
    await expand("Campus Loop");
    const items = stopItems("Campus Loop");
    expect(items.map(item => item.textContent)).toEqual([
      "Main Gate, 7:05 am",
      "Central Library, 7:12 am",
      "Hostel Block C, 7:20 am",
      "Sports Complex, Time not set",
      "Admin Building, 12:00 am",
    ]);
    // The rail starts at the first stop and ends at the last: no segment
    // above the first dot or below the last one.
    const segments = items.map(item => item.querySelector("[data-rail]")!.children.length);
    expect(segments).toEqual([2, 3, 3, 3, 2]);
    const direction = card("Campus Loop").querySelector("[data-route-direction]")!;
    expect(direction.textContent).toMatch(/^Main Gate.*to Admin Building$/);
  });

  it("opens one stop at a time in place with its time and where it sits on the route", async () => {
    const user = userEvent.setup();
    render(<RoutesTab />);
    await expand("Campus Loop");
    const stopButton = (name: RegExp) => within(card("Campus Loop")).getByRole("button", { name });
    expect(document.querySelector("[data-stop-details]")).toBeNull();

    await user.click(stopButton(/^Central Library/));
    expect(stopButton(/^Central Library/).getAttribute("aria-expanded")).toBe("true");
    const library = stopItems("Campus Loop")[1];
    expect(library.hasAttribute("data-stop-selected")).toBe(true);
    expect(within(library).getByText("Scheduled time")).toBeTruthy();
    expect(Array.from(library.querySelectorAll("[data-stop-fact]"), fact => fact.textContent)).toEqual([
      "Stop 2 of 5", "7 min from Main Gate", "Reaches Admin Building at 12:00 am",
    ]);
    expect(library.querySelector("[data-stop-time]")?.getAttribute("data-stop-time")).toBe("pill");
    expect(stopItems("Campus Loop")[0].querySelector("[data-stop-time]")?.getAttribute("data-stop-time")).toBe("");

    // Opening another stop closes the first; tapping it again closes it too.
    await user.click(stopButton(/^Sports Complex/));
    expect(stopButton(/^Central Library/).getAttribute("aria-expanded")).toBe("false");
    // The closed stop slides shut, unreachable, then leaves the page.
    const closing = library.querySelector("[data-stop-details]")!;
    expect(closing.getAttribute("data-stop-details")).toBe("closing");
    expect(closing.hasAttribute("inert")).toBe(true);
    expect(closing.getAttribute("aria-hidden")).toBe("true");
    await vi.waitFor(() => expect(library.querySelector("[data-stop-details]")).toBeNull());
    const sports = stopItems("Campus Loop")[3];
    expect(within(sports).getByText("No time scheduled for this stop yet")).toBeTruthy();
    expect(Array.from(sports.querySelectorAll("[data-stop-fact]"), fact => fact.textContent))
      .toEqual(["Stop 4 of 5", "Reaches Admin Building at 12:00 am"]);
    await user.click(stopButton(/^Sports Complex/));
    expect(document.querySelector('[data-stop-details="open"]')).toBeNull();

    // Through midnight, the duration still counts forward.
    await user.click(stopButton(/^Admin Building/));
    expect(Array.from(stopItems("Campus Loop")[4].querySelectorAll("[data-stop-fact]"), fact => fact.textContent))
      .toEqual(["Last stop", "16 h 55 min from Main Gate"]);
  });

  it("scrolls an opened stop into view once it has slid open", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<RoutesTab />);
      await expand("Campus Loop");
      await userEvent.setup().click(within(card("Campus Loop")).getByRole("button", { name: /^Admin Building/ }));
      expect(scrollIntoView).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" }));
      expect(scrollIntoView.mock.contexts[0]).toBe(stopItems("Campus Loop")[4].querySelector("[data-stop-details]"));
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  describe("closest stop", () => {
    const originalPermissions = Object.getOwnPropertyDescriptor(navigator, "permissions");
    const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, "geolocation");
    function grantLocation(state: PermissionState, lat: number, lng: number) {
      const getCurrentPosition = vi.fn((success: PositionCallback) =>
        success({ coords: { latitude: lat, longitude: lng } } as GeolocationPosition));
      Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: vi.fn(async () => ({ state })) } });
      Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
      return getCurrentPosition;
    }
    afterEach(() => {
      for (const [key, descriptor] of [["permissions", originalPermissions], ["geolocation", originalGeolocation]] as const) {
        if (descriptor) Object.defineProperty(navigator, key, descriptor);
        else delete (navigator as unknown as Record<string, unknown>)[key];
      }
    });

    it("opens the stop nearest the passenger when location is already allowed", async () => {
      // Stops sit 0.001° (about 111 m) apart; this is next to the third.
      grantLocation("granted", 23.0021, 72);
      render(<RoutesTab />);
      await expand("Campus Loop");
      const hostel = await within(card("Campus Loop")).findByText("Closest stop");
      expect(hostel.closest("li")).toBe(stopItems("Campus Loop")[2]);
      expect(stopItems("Campus Loop")[2].hasAttribute("data-stop-selected")).toBe(true);
    });

    it("never asks for location and ignores stops more than 1.5 km away", async () => {
      const prompt = grantLocation("prompt", 23.002, 72);
      const { unmount } = render(<RoutesTab />);
      await expand("Campus Loop");
      await Promise.resolve();
      expect(prompt).not.toHaveBeenCalled();
      expect(document.querySelector("[data-closest-stop]")).toBeNull();
      unmount();

      const far = grantLocation("granted", 23.1, 72);
      render(<RoutesTab />);
      await expand("Campus Loop");
      await vi.waitFor(() => expect(far).toHaveBeenCalled());
      expect(document.querySelector("[data-closest-stop]")).toBeNull();
      expect(document.querySelector("[data-stop-details]")).toBeNull();
    });
  });

  it("shows only the stop name for a single-stop route", () => {
    state.routes = [{ ...express, stops: express.stops.slice(0, 1) }];
    render(<RoutesTab />);
    expect(screen.getByText("1 stop")).toBeTruthy();
    expect(document.querySelector("[data-route-direction]")).toBeNull();
  });

  it("shows a missing time as not set", async () => {
    render(<RoutesTab />);
    await expand("Express");
    const [north, south] = stopItems("Express");
    expect(within(north).getByText("12:30 pm")).toBeTruthy();
    expect(within(south).getByText("Time not set")).toBeTruthy();
  });

  it("explains a route without stops", () => {
    state.routes = [{ ...express, stops: [] }];
    render(<RoutesTab />);
    expect(screen.getByText("No stops listed for this route yet")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Express stops" })).toBeNull();
  });

  it("shows the empty state when there are no routes", () => {
    state.routes = [];
    render(<RoutesTab />);
    expect(screen.getByText("No routes yet")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows a loading state while any source is pending", () => {
    const pending: (() => void)[] = [
      () => { state.configLoading = true; },
      () => { state.routesLoading = true; state.routes = []; },
      () => { state.usageLoading = true; },
      () => { state.busesLoading = true; state.buses = []; },
    ];
    for (const makePending of pending) {
      makePending();
      const { unmount } = render(<RoutesTab />);
      expect(screen.getByRole("status").textContent).toContain("Loading routes");
      expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
      unmount();
      state.configLoading = false; state.routesLoading = false; state.usageLoading = false; state.busesLoading = false;
      state.routes = [loop, night, express];
    }
  });

  it("shows an error with a Retry that re-opens every listener", async () => {
    state.configError = "Route schedules could not be loaded.";
    render(<RoutesTab />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Route schedules could not be loaded.");
    expect(screen.queryByRole("list")).toBeNull();
    expect(state.subscriptions).toBe(1);
    state.configError = null;
    await userEvent.setup().click(within(alert).getByRole("button", { name: "Retry" }));
    expect(state.retry).toHaveBeenCalledTimes(1);
    expect(state.retryBuses).toHaveBeenCalledTimes(1);
    expect(state.subscriptions).toBe(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(3);
  });

  it("reports a routes read failure", () => {
    state.routesError = "Missing or insufficient permissions.";
    render(<RoutesTab />);
    expect(screen.getByRole("alert").textContent).toContain("Missing or insufficient permissions.");
  });
});
