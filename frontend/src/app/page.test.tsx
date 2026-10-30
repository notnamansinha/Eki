// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";

const fixture = vi.hoisted(() => ({
  auth: { user: null as null | { role: string }, loading: true, loginReady: true, restoreSlow: false,
    loginFallbackAvailable: false, loginLoading: false, roleError: null as string | null,
    loginError: null, loginWithGoogle: vi.fn(), loginWithGoogleRedirect: vi.fn(), refreshAccess: vi.fn(), logout: vi.fn() },
  replace: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => fixture.auth }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: fixture.replace }) }));
beforeEach(() => {
  Object.assign(fixture.auth, { user: null, loading: true, loginReady: true, restoreSlow: false, loginFallbackAvailable: false, roleError: null });
  fixture.replace.mockClear(); fixture.auth.logout.mockClear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("landing sign-in and redirect recovery", () => {
  it("qualifies tracking and arrival estimates by live service availability", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { name: /Campus routes.*and bus tracking/ })).toBeTruthy();
    expect(screen.getByText(/Arrival estimates depend on live service data/)).toBeTruthy();
  });
  it("enables sign-in when ready and shows redirect fallback only after a popup failure", () => {
    const { rerender } = render(<HomePage />);
    expect((screen.getByRole("button", { name: "Sign In with Google" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: /Continue with full-page/ })).toBeNull();
    fixture.auth.loginFallbackAvailable = true;
    rerender(<HomePage />);
    expect(screen.getByRole("button", { name: /Continue with full-page/ })).toBeTruthy();
  });
  it("offers reload after ten seconds if opening the workspace stalls", async () => {
    vi.useFakeTimers();
    fixture.auth.user = { role: "passenger" }; fixture.auth.loading = false;
    render(<HomePage />);
    expect(fixture.replace).toHaveBeenCalledWith("/passenger");
    expect(screen.queryByRole("button", { name: "Try reloading" })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByRole("button", { name: "Try reloading" })).toBeTruthy();
  });
  it.each([ ["admin", "/admin"], ["passenger", "/passenger"] ])(
    "waits for verification before routing a returned %s account", (role, workspace) => {
      localStorage.clear();
      fixture.auth.user = { role };
      const { rerender } = render(<HomePage />);
      expect(fixture.replace).not.toHaveBeenCalled();
      fixture.auth.loading = false;
      rerender(<HomePage />);
      expect(fixture.replace).toHaveBeenCalledWith(workspace);
    },
  );
  it("routes to the default workspace when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    fixture.auth.user = { role: "admin" }; fixture.auth.loading = false;
    render(<HomePage />);
    expect(fixture.replace).toHaveBeenCalledWith("/admin");
  });
  it("lets an account with a permanent access error sign out from the landing page", () => {
    fixture.auth.loading = false; fixture.auth.roleError = "Your administrator access is not synchronized.";
    render(<HomePage />);
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(fixture.auth.logout).toHaveBeenCalledOnce();
  });
});
describe("sign-in initialization stall", () => {
  it("explains a disabled sign-in button and offers reload when sign-in never becomes ready", async () => {
    vi.useFakeTimers();
    Object.assign(fixture.auth, { loading: false, loginReady: false, loginError: null, roleError: null });
    render(<HomePage />);
    expect((screen.getByRole("button", { name: "Preparing sign-in…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByRole("status").textContent).toContain("still loading");
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });
  it("does not show the stall notice once sign-in is ready", async () => {
    vi.useFakeTimers();
    Object.assign(fixture.auth, { loading: false, loginReady: true, loginError: null, roleError: null });
    render(<HomePage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });
});

describe("cold open while sign-in restores", () => {
  it("explains a sign-in button that is not ready yet instead of showing a dead button", () => {
    fixture.auth.loginReady = false;
    render(<HomePage />);
    const button = screen.getByRole("button", { name: "Preparing sign-in…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
  it("keeps the landing page and an enabled sign-in while a slow restoration continues", () => {
    fixture.auth.restoreSlow = true; fixture.auth.loading = true;
    render(<HomePage />);
    expect(screen.queryByText("Access could not be verified")).toBeNull();
    expect((screen.getByRole("button", { name: "Sign In with Google" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("status").textContent).toContain("Still checking your sign-in");
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });
  it("offers Reload alongside Try again and Sign out when access verification fails", () => {
    fixture.auth.loading = false; fixture.auth.roleError = "We could not verify your access.";
    render(<HomePage />);
    for (const name of ["Try again", "Sign out", "Reload"]) expect(screen.getByRole("button", { name })).toBeTruthy();
  });
});
