// @vitest-environment jsdom
import { lazy, Suspense, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, act, waitFor } from "@testing-library/react";
import PassengerWorkspace from "./PassengerWorkspace";
import { saveJoinedRidePointer, readJoinedRidePointer } from "@/lib/joinedRidePointer";
import { setScenario } from "../../../../e2e/fixtures/state";
const state = vi.hoisted(() => ({
  user: { uid: "qa-passenger", role: "passenger", displayName: "QA Passenger" },
  status: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/hooks/useLiveRouteCatalog", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useRoutes", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useSettings", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/hooks/useRTDBResume", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/lib/liveBusStore", async () => import("../../../../e2e/fixtures/state"));
vi.mock("@/lib/joinedRideStatus", () => ({ getJoinedRideStatus: state.status }));
vi.mock("@/lib/authState", async () => import("../../../../e2e/fixtures/state"));
vi.mock("next/dynamic", () => ({ default: (loader: () => Promise<{ default: ComponentType<Record<string, unknown>> }>) => {
  const Loaded = lazy(loader);
  return function TestDynamic(props: Record<string, unknown>) { return <Suspense><Loaded {...props} /></Suspense>; };
} }));
vi.mock("@/components/maps/PassengerTrackingMap", () => ({ default: () => <div>QA map</div> }));
vi.mock("@/components/passenger/PassengerBoardingView", () => ({ default: ({ restoredBoarding }: { restoredBoarding?: { boardingStopId: string; alightingStopId: string } }) => <div>{restoredBoarding ? `Verified ${restoredBoarding.boardingStopId} ${restoredBoarding.alightingStopId}` : "Unjoined"}</div> }));
vi.mock("@/components/passenger/AccountTab", () => ({ default: () => null }));
vi.mock("@/components/shared/MessagingPanel", () => ({ default: () => null }));
vi.mock("@/components/shared/FeedbackModal", () => ({ default: () => null }));
const verified = { sessionId: "qa-session", busId: "qa-bus", routeId: "qa-route", status: "active", boarding: { boardingStopId: "a", alightingStopId: "b" } };
beforeEach(() => { localStorage.clear(); state.status.mockReset(); state.user = { uid: "qa-passenger", role: "passenger", displayName: "QA Passenger" }; setScenario("forward"); });
afterEach(() => { cleanup(); localStorage.clear(); });
describe("verified reload boarding recovery", () => {
  it("does not query another account's local ride hint", async () => {
    saveJoinedRidePointer("other", "qa-session"); render(<PassengerWorkspace />);
    await screen.findByRole("button", { name: "Track QA route" }); expect(state.status).not.toHaveBeenCalled();
  });
  it("restores tracking and stops only after membership verification", async () => {
    let resolve!: (value: typeof verified) => void;
    state.status.mockImplementation(() => new Promise(answer => { resolve = answer; }));
    saveJoinedRidePointer(state.user.uid, "qa-session"); render(<PassengerWorkspace />);
    await waitFor(() => expect(state.status).toHaveBeenCalledOnce()); expect(screen.queryByText("Verified a b")).toBeNull();
    await act(async () => resolve(verified)); expect(await screen.findByText("Verified a b")).toBeTruthy();
  });
  it("clears a forged pointer after membership denial", async () => {
    state.status.mockRejectedValue({ status: 403 }); saveJoinedRidePointer(state.user.uid, "qa-session"); render(<PassengerWorkspace />);
    await screen.findByText(/Your boarding could not be restored/);
    expect(readJoinedRidePointer(state.user.uid)).toBeNull(); expect(screen.queryByText("Verified a b")).toBeNull();
  });
  it("ignores a delayed previous-account response", async () => {
    let resolve!: (value: typeof verified) => void;
    state.status.mockImplementation(() => new Promise(answer => { resolve = answer; }));
    saveJoinedRidePointer(state.user.uid, "qa-session"); const { rerender } = render(<PassengerWorkspace />);
    await waitFor(() => expect(state.status).toHaveBeenCalledOnce());
    state.user = { ...state.user, uid: "other" }; rerender(<PassengerWorkspace />);
    expect(state.status.mock.calls[0][1].aborted).toBe(true);
    await act(async () => resolve(verified)); expect(screen.queryByText("Verified a b")).toBeNull();
  });
  it("does not restore an ended ride as on board", async () => {
    state.status.mockResolvedValue({ ...verified, status: "interrupted" }); saveJoinedRidePointer(state.user.uid, "qa-session"); render(<PassengerWorkspace />);
    await screen.findByText("Your joined ride has ended."); expect(readJoinedRidePointer(state.user.uid)).toBeNull();
    expect(screen.queryByText("Verified a b")).toBeNull();
  });
});
