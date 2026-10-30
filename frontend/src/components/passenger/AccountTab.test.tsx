// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AccountTab from "./AccountTab";
const mocks = vi.hoisted(() => ({ logout: vi.fn(),
  user: { uid: "qa-passenger", displayName: "QA Passenger", role: "passenger", photoURL: "" } as { uid: string; displayName: string; role: string; photoURL: string } | null,
  auth: { currentUser: { uid: "qa-passenger", getIdToken: vi.fn(async () => "test-token") } },
}));
vi.mock("@/lib/firebaseAuth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/feedbackStore", () => ({ submitFeedback: vi.fn(async () => undefined), feedbackErrorMessage: (_e: unknown, fallback: string) => fallback }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user, logout: mocks.logout }) }));
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://qa.ngrok-free.dev"); mocks.logout.mockClear();
  mocks.user = { uid: "qa-passenger", displayName: "QA Passenger", role: "passenger", photoURL: "" };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("account confirmations", () => {
  it("flips the profile photo into a golden coin after two taps, then restores it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
    try {
      render(<AccountTab />);
      const photo = screen.getByRole("button", { name: "Profile photo, double tap for a surprise" });
      fireEvent.click(photo);
      expect(screen.queryByRole("img", { name: "Golden coin: 19" })).toBeNull();
      fireEvent.click(photo);
      expect(screen.getByRole("img", { name: "Golden coin: 19" })).toBeTruthy();
      expect(screen.getAllByText("19")).toHaveLength(1);
      act(() => vi.advanceTimersByTime(4_000));
      expect(screen.queryByRole("img", { name: "Golden coin: 19" })).toBeNull();
      expect(screen.getByRole("img", { name: "Default profile" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
  it("shows the admin panel link only while the current user has the admin role", () => {
    mocks.user = { uid: "qa-admin", displayName: "QA Admin", role: "admin", photoURL: "" };
    const view = render(<AccountTab />);
    expect(screen.getByRole("link", { name: "Admin Panel" }).getAttribute("href")).toBe("/admin");

    for (const role of ["passenger", "driver", ""]) {
      mocks.user = { uid: "qa-user", displayName: "QA User", role, photoURL: "" };
      view.rerender(<AccountTab />);
      expect(screen.queryByRole("link", { name: "Admin Panel" })).toBeNull();
    }

    mocks.user = null;
    view.rerender(<AccountTab />);
    expect(screen.queryByRole("link", { name: "Admin Panel" })).toBeNull();
  });
  it("falls back after a photo failure and retries for a changed URL or account", () => {
    const account = { uid: "qa-passenger", displayName: "QA Passenger", role: "passenger", photoURL: "https://example.test/photo.png" };
    mocks.user = account;
    const view = render(<AccountTab />);
    fireEvent.error(screen.getByRole("img", { name: "Profile" }));
    expect(screen.queryByRole("img", { name: "Profile" })).toBeNull();
    expect(screen.getByRole("img", { name: "Default profile" })).toBeTruthy();
    account.photoURL = "https://example.test/new-photo.png";
    view.rerender(<AccountTab />);
    expect(screen.getByRole("img", { name: "Profile" }).getAttribute("src")).toBe(account.photoURL);
    fireEvent.error(screen.getByRole("img", { name: "Profile" }));
    account.uid = "another-passenger";
    view.rerender(<AccountTab />);
    expect(screen.getByRole("img", { name: "Profile" })).toBeTruthy();
    account.photoURL = "";
    view.rerender(<AccountTab />);
    expect(screen.getByRole("img", { name: "Default profile" })).toBeTruthy();
  });
  it("offers sign-in to guests without opening an unusable feedback form", () => {
    mocks.user = null;
    render(<AccountTab />);
    expect(screen.queryByRole("button", { name: "Send Feedback" })).toBeNull();
    const signIn = screen.getByRole("button", { name: "Sign in with Google" });
    expect(signIn.innerHTML).toContain("var(--accent)");
    expect(signIn.innerHTML).not.toMatch(/#3B82F6|59, 130, 246/i);
  });
  it("clears the previous deletion failure when opening a new confirmation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{}')));
    render(<AccountTab />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete Account" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete Account" }));
    await screen.findByRole("status");
    await user.click(screen.getByRole("button", { name: "Delete Account" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("group", { name: "Profile photo" })).toBeTruthy();
  });
  it("opens deletion confirmation outside the scrolling, animated profile container", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<div data-testid="profile-container" style={{ transform: "translateY(0)", overflow: "hidden", height: 300 }}><AccountTab /></div>);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete Account" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Account?" });
    expect(document.body.contains(dialog)).toBe(true);
    expect(screen.getByTestId("profile-container").contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("cancel and Escape never queue deletion or sign out", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); render(<AccountTab />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete Account" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Sign Out" }));
    await user.keyboard("{Escape}");
    expect(fetchMock).not.toHaveBeenCalled(); expect(mocks.logout).not.toHaveBeenCalled();
  });
  it.each(["<html>proxy warning</html>", "{}", "null"])("never shows deletion queued for invalid acknowledgement %s", async body => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body))); render(<AccountTab />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete Account" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete Account" }));
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.queryByText("Deletion queued. Your account will be removed shortly.")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Deletion requested" })).toBeNull();
    expect(mocks.logout).not.toHaveBeenCalled();
  });
  it("queues deletion only after explicit confirmation and server acceptance", async () => {
    const fetchMock = vi.fn(async () => new Response('{"accepted":true}', { status: 202 })); vi.stubGlobal("fetch", fetchMock);
    render(<AccountTab />); const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "Delete Account" }));
    expect(within(screen.getByRole("dialog")).getByText(/Your feedback, passenger ride entries, and messages will be retained/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete Account" }));
    const accepted = await screen.findByRole("dialog", { name: "Deletion requested" });
    expect(within(accepted).getByText(/Your account deletion request has been queued/)).toBeTruthy();
    expect(within(accepted).queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(mocks.logout).not.toHaveBeenCalled();
    await user.click(within(accepted).getByRole("button", { name: "OK" }));
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("ngrok-skip-browser-warning")).toBe("1");
  });
  it("signs out when the accepted deletion popup is dismissed with Escape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"accepted":true}', { status: 202 })));
    render(<AccountTab />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete Account" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete Account" }));
    await screen.findByRole("dialog", { name: "Deletion requested" });
    await user.keyboard("{Escape}");
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it.each([
    [500, '{"error":"Synthetic service unavailable"}'],
    [202, '{"accepted":false}'],
    [202, 'invalid-json'],
  ])("surfaces a rejected deletion acknowledgement (%s) without signing out", async (status, body) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));
    render(<AccountTab />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete Account" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete Account" }));
    await screen.findByRole("status");
    // The error must be reachable rather than hidden behind the confirmation.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.logout).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete Account" }));
    expect(screen.getByRole("dialog", { name: "Delete Account?" })).toBeTruthy();
  });
});
describe("profile feedback drafts", () => {
  it("keeps an unsent draft after the dialog is closed and reopened", async () => {
    render(<AccountTab />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Send Feedback" }));
    await user.type(screen.getByRole("textbox"), "Seats were wet");
    await user.click(screen.getByRole("button", { name: "Close feedback" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Send Feedback" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Seats were wet");
  });
  it("never offers one account's draft to another account", async () => {
    const view = render(<AccountTab />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Send Feedback" }));
    await user.type(screen.getByRole("textbox"), "Private note");
    await user.click(screen.getByRole("button", { name: "Close feedback" }));
    mocks.user = { uid: "another-passenger", displayName: "Other", role: "passenger", photoURL: "" };
    view.rerender(<AccountTab />);
    await user.click(screen.getByRole("button", { name: "Send Feedback" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });
});
