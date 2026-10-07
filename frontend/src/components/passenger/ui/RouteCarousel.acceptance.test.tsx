// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RouteCarousel from "./RouteCarousel";
import type { RouteData } from "@/hooks/useRoutes";

const route: RouteData = {
  id: "B", name: "B route", color: "#3B82F6", duration: "600s", waypoints: [],
  stops: [{ id: "a", name: "Alpha", shortName: "A", lat: 23, lng: 72 }, { id: "b", name: "Beta", shortName: "B", lat: 23.01, lng: 72.01 }],
};
afterEach(cleanup);

describe("scoped route-card direction acceptance", () => {
  it.each([
    ["unknown", "Open for live status", "VIEW STATUS"],
    ["pending", "Direction pending", "VIEW STATUS"],
    ["forward", "Alpha → Beta", "TRACK ROUTE"],
    ["reverse", "Beta → Alpha", "TRACK ROUTE"],
  ] as const)("labels %s direction accurately and opens the selected route", async (direction, label, action) => {
    const select = vi.fn();
    render(<RouteCarousel routes={[route]} selectedRouteId="" onClick={select} getActiveBusesCount={() => 1} getAvailableBusesCount={() => 0} getDirectionState={() => direction} />);
    const card = screen.getByRole("button", { name: "Track B route" });
    expect(card.textContent?.replace(/\s+/g, " ")).toContain(label);
    expect(card.textContent).toContain(action);
    if (direction !== "pending") expect(screen.queryByText("Direction pending")).toBeNull();
    await userEvent.setup().click(card);
    expect(select).toHaveBeenCalledExactlyOnceWith("B");
  });

  it("updates an unfetched card to the authoritative reverse direction after selection", async () => {
    const select = vi.fn();
    const props = { routes: [route], selectedRouteId: "", onClick: select, getActiveBusesCount: () => 1, getAvailableBusesCount: () => 0 };
    const view = render(<RouteCarousel {...props} getDirectionState={() => "unknown"} />);
    expect(screen.getByText("Open for live status")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Track B route" }));
    expect(select).toHaveBeenCalledExactlyOnceWith("B");
    view.rerender(<RouteCarousel {...props} selectedRouteId="B" getDirectionState={() => "reverse"} />);
    expect(screen.getByRole("button", { name: "Track B route" }).textContent?.replace(/\s+/g, " ")).toContain("Beta → Alpha");
    expect(screen.queryByText("Open for live status")).toBeNull();
    expect(screen.queryByText("Direction pending")).toBeNull();
  });

  it("keeps a catalog-only stationary preview visible and navigable without an armed service", async () => {
    const select = vi.fn();
    render(<RouteCarousel routes={[route]} selectedRouteId="" onClick={select} getActiveBusesCount={() => 0} getAvailableBusesCount={() => 1} getDirectionState={() => "unknown"} />);
    expect(screen.getByText("Vehicle available — service not started")).toBeTruthy();
    expect(screen.queryByText("Direction pending")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Track B route" }));
    expect(select).toHaveBeenCalledExactlyOnceWith("B");
  });
});
