// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import RouteTimelineSheet from "./RouteTimelineSheet";
import { route } from "../../../../e2e/fixtures/state";

afterEach(cleanup);
it.each([undefined, null, "1", -1, 0.5, 2, Number.MAX_SAFE_INTEGER])("does not treat missing ETA as arrival when the published index is %s", async value => {
  render(<RouteTimelineSheet route={route} targetStopId="b" currentStopIndex={value as number | undefined} stopETAs={{ b: 1 }} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Route Timeline" }));
  expect(screen.queryByText("Next Stop")).toBeNull();
  expect(screen.getByText("Alpha").parentElement!.parentElement!.className).toContain("opacity-100");
  expect(screen.getByText("Beta").parentElement!.parentElement!.className).toContain("opacity-100");
});

it("uses the published next stop even when its ETA is unavailable", async () => {
  render(<RouteTimelineSheet route={route} targetStopId="b" currentStopIndex={1} stopETAs={{}} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Route Timeline" }));
  expect(screen.getByText("Next Stop").parentElement!.textContent).toContain("Beta");
  expect(screen.getByText("Alpha").parentElement!.parentElement!.className).toContain("opacity-25");
});

it("does not show live progress in a preview", async () => {
  render(<RouteTimelineSheet route={route} targetStopId="b" currentStopIndex={1} stopETAs={{ b: 1 }} preview />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Configured route" }));
  expect(screen.queryByText("Next Stop")).toBeNull();
  expect(screen.getByText("Alpha").parentElement!.parentElement!.className).toContain("opacity-100");
});

it("does not apply one bus's index to an aggregate fleet timeline", async () => {
  render(<RouteTimelineSheet route={route} targetStopId="b" currentStopIndex={1} stopETAs={{ b: 1 }} aggregateArrivals />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Route Timeline" }));
  expect(screen.queryByText("Next Stop")).toBeNull();
  expect(screen.getByText("Alpha").parentElement!.parentElement!.className).toContain("opacity-100");
});

it("shows the bus at the origin before departure instead of waiting for the next stop (field ride, 29 Oct 2026)", async () => {
  render(<RouteTimelineSheet route={route} targetStopId="b" currentStopIndex={0} atStopIndex={0} stopETAs={{ a: 0, b: 2 }} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Route Timeline" }));
  expect(screen.getByText("Bus is here").parentElement!.textContent).toContain("Alpha");
  expect(screen.getByText("Alpha").parentElement!.parentElement!.className).toContain("opacity-100");
});

it("marks an intermediate stop on arrival and keeps an unobserved pass distinct", async () => {
  const stops = [...route.stops, { ...route.stops[0], id: "c", name: "Gamma", shortName: "C" },
    { ...route.stops[0], id: "d", name: "Delta", shortName: "D" }];
  render(<RouteTimelineSheet route={{ ...route, stops }} targetStopId="d" currentStopIndex={stops.length - 1}
    atStopIndex={stops.length - 2} unobservedStopIndices={[1]} stopETAs={{}} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Route Timeline" }));
  expect(screen.getByText("Bus is here").parentElement!.textContent).toContain(stops.at(-2)!.name);
  expect(screen.getByText("Passed · not confirmed").parentElement!.textContent).toContain(stops[1].name);
  expect(screen.getByText(stops[1].name).parentElement!.parentElement!.className).toContain("opacity-25");
});
