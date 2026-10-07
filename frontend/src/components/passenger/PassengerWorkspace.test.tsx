// @vitest-environment jsdom
import { lazy, Suspense, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, configure, render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PassengerWorkspace from "./PassengerWorkspace";
import { BUS_EXPIRY_MS } from "@/lib/liveBusFreshness";
import { setScenario } from "../../../../e2e/fixtures/state";
configure({ asyncUtilTimeout: 5_000 });
vi.mock("@/hooks/useAuth", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useLiveRouteCatalog", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useRoutes", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useSettings", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useRTDBResume", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/lib/liveBusStore", async () => import("../../../../e2e/fixtures/state"));
vi.mock("next/dynamic", () => ({ default: (loader: () => Promise<{ default: ComponentType<Record<string, unknown>> }>) => {
  const Loaded = lazy(loader);
  return function TestDynamic(props: Record<string, unknown>) { return <Suspense><Loaded {...props} /></Suspense>; };
} }));
vi.mock("@/components/maps/PassengerTrackingMap", () => ({ default: () => <div>QA map</div> }));
vi.mock("@/components/passenger/PassengerBoardingView", () => ({ default: ({ sessionId }: { sessionId: string }) => <div>Boarding {sessionId}</div> }));
vi.mock("@/components/passenger/AccountTab", () => ({ default: () => <button>QA account control</button> }));
vi.mock("@/components/shared/MessagingPanel", () => ({ default: () => <div>QA chat</div> }));
vi.mock("@/components/shared/FeedbackModal", () => ({ default: () => <div>QA feedback</div> }));
beforeEach(() => setScenario("pending"));
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("passenger workspace navigation", () => {
  it("unmounts the chat dialog when leaving tracking so hidden dialog focus handlers cannot remain active", async () => {
    setScenario("forward"); render(<PassengerWorkspace />); const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Track QA route" }));
    await user.click(await screen.findByRole("button", { name: "Open live chat" }));
    expect(await screen.findByText("QA chat")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Profile" }));
    expect(screen.queryByText("QA chat")).toBeNull();
  });
  it("only exposes controls in the active panel and opens pending service", async () => {
    const { container } = render(<PassengerWorkspace />); const user = userEvent.setup();
    await screen.findByRole("button", { name: "Track QA route" });
    expect(screen.queryByRole("button", { name: "Back to home" })).toBeNull();
    expect(screen.queryByRole("button", { name: "QA account control" })).toBeNull();
    const back = Array.from(container.querySelectorAll("button")).find(button => button.getAttribute("aria-label") === "Back to home");
    expect(back?.closest("[inert][aria-hidden='true']")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Track QA route" }));
    expect(await screen.findByRole("button", { name: "Back to home" })).toBeTruthy();
    expect(screen.getAllByText("Direction pending").some(element => !element.closest('[aria-hidden="true"]'))).toBe(true);
    expect(screen.queryByRole("button", { name: "Track QA route" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back to home" }));
    expect(await screen.findByRole("button", { name: "Track QA route" })).toBeTruthy();
  });
  it("switches buses without retaining the first bus's boarding session", async () => {
    setScenario("multiple"); render(<PassengerWorkspace />); const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Track QA route" }));
    expect(await screen.findByText("Boarding qa-session")).toBeTruthy();
    await user.click(screen.getByRole("combobox", { name: "Live bus" }));
    await user.click(screen.getByRole("option", { name: "Bus qa-bus-2 · B → A" }));
    expect(await screen.findByText("Boarding qa-session-2")).toBeTruthy();
    expect(screen.queryByText("Boarding qa-session")).toBeNull();
  });
  it("exposes profile only after navigation and returns to routes", async () => {
    render(<PassengerWorkspace />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Profile" }));
    expect(await screen.findByRole("button", { name: "QA account control" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Routes" }));
    expect(await screen.findByRole("button", { name: "Track QA route" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "QA account control" })).toBeNull();
  });
  it("does not ask an unjoined passenger for post-ride feedback", async () => {
    render(<PassengerWorkspace />); const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Track QA route" }));
    vi.useFakeTimers();
    act(() => setScenario("completed"));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(screen.queryByText("QA feedback")).toBeNull();
  });
});

describe("device preview lifecycle", () => {
  it("opens the unarmed stationary bus map and never exposes boarding or live chat", async () => {
    setScenario("device"); render(<PassengerWorkspace />); const user=userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Track QA route" }));
    expect(await screen.findByText("QA map")).toBeTruthy();
    expect(screen.getByText("Bus online · service not started")).toBeTruthy();
    expect(screen.queryByText(/Boarding qa-session/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Open live chat" })).toBeNull();
    await user.click(screen.getByRole("combobox", { name: "Destination station" }));
    expect(screen.getByRole("listbox", { name: "Destination station" })).toBeTruthy();
    await user.click(screen.getByRole("option", { name: "Beta" }));
    expect(screen.getByRole("combobox", { name: "Destination station" }).textContent).toContain("Beta");
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back to home" }));
    expect(await screen.findByRole("button", { name: "Track QA route" })).toBeTruthy();
  });
  it("shows the map while direction is pending and transitions to armed boarding when direction resolves", async () => {
    render(<PassengerWorkspace />); const user=userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Track QA route" }));
    expect(await screen.findByText("QA map")).toBeTruthy();
    expect(screen.queryByText("Boarding qa-session")).toBeNull();
    act(() => setScenario("forward"));
    expect(await screen.findByText("Boarding qa-session")).toBeTruthy();
  });
  it("expires silent sessionless hardware without requiring another RTDB event", async () => {
    vi.useFakeTimers();
    setScenario("device");
    await act(async () => { render(<PassengerWorkspace />); });
    expect(screen.getByRole("button", { name: "Track QA route" })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(BUS_EXPIRY_MS + 2_001); });
    expect(screen.queryByRole("button", { name: "Track QA route" })).toBeNull();
    expect(screen.getByText("No buses running")).toBeTruthy();
  });
});

describe("selected bus identity during service start", () => {
  it("keeps the selected device when it acquires a new session alongside another bus", async () => {
    setScenario("mixed"); render(<PassengerWorkspace />); const user=userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Track QA route" }));
    await user.click(screen.getByRole("combobox", { name: "Live bus" }));
    await user.click(screen.getByRole("option", { name: "Bus qa-bus-2 · Service not started" }));
    expect(screen.getByText("Bus online · service not started")).toBeTruthy();
    act(() => setScenario("multiple"));
    expect(await screen.findByText("Boarding qa-session-2")).toBeTruthy();
    expect(screen.queryByText("Boarding qa-session")).toBeNull();
  });
});
