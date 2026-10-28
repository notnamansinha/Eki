// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FeedbackModal from "./FeedbackModal";
import { FeedbackError } from "@/lib/feedbackStore";

const session = vi.hoisted(() => ({ currentUser: { uid: "qa-passenger" } }));
const store = vi.hoisted(() => ({ submitFeedback: vi.fn() }));
vi.mock("@/lib/firebaseAuth", () => ({ auth: session }));
vi.mock("@/lib/feedbackStore", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/feedbackStore")>(), ...store,
}));
vi.mock("@/lib/firebaseFirestore", () => ({ db: {} }));
beforeEach(() => {
  localStorage.clear(); store.submitFeedback.mockReset().mockResolvedValue(undefined);
  session.currentUser.uid = "qa-passenger";
  vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Tunnel is offline"); }));
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(fn, 0));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function submitGeneral() {
  const user = userEvent.setup();
  render(<FeedbackModal userId="qa-passenger" onClose={vi.fn()} />);
  await user.type(screen.getByRole("textbox"), "The route card should open reliably.");
  await user.click(screen.getByRole("button", { name: "Submit Feedback" }));
  return user;
}
describe("passenger feedback workflow", () => {
  it("explains empty ride feedback without making a request", async () => {
    render(<FeedbackModal userId="qa-passenger" busId="bus" sessionId="ride" onClose={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Submit Feedback" }));
    expect(screen.getByRole("status").textContent).toContain("Please add a rating or comment before submitting.");
    expect(store.submitFeedback).not.toHaveBeenCalled();
  });
  it("submits to Firestore with the tunnel offline and no backend URL", async () => {
    await submitGeneral();
    expect(await screen.findByText("Thank you!")).toBeTruthy();
    expect(store.submitFeedback).toHaveBeenCalledWith("qa-passenger", expect.objectContaining({ type: "general", comment: "The route card should open reliably." }), expect.any(String));
    expect(localStorage.getItem("feedbackCooldown:qa-passenger")).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("shows a connection error without success or a local cooldown", async () => {
    store.submitFeedback.mockRejectedValue({ code: "unavailable" });
    await submitGeneral();
    expect(await screen.findByText(/Could not connect to Firestore/)).toBeTruthy();
    expect(screen.queryByText("Thank you!")).toBeNull();
    expect(localStorage.getItem("feedbackCooldown:qa-passenger")).toBeNull();
  });
  it("reuses the request ID after an ambiguous failure and retries the same feedback", async () => {
    store.submitFeedback.mockRejectedValueOnce({ code: "unavailable" });
    const user = await submitGeneral();
    await screen.findByText(/Could not connect to Firestore/);
    await user.click(screen.getByRole("button", { name: "Submit Feedback" }));
    expect(await screen.findByText("Thank you!")).toBeTruthy();
    expect(store.submitFeedback.mock.calls[0][2]).toBe(store.submitFeedback.mock.calls[1][2]);
  });
  it("honors the server cooldown without claiming the feedback was stored", async () => {
    store.submitFeedback.mockRejectedValue(Object.assign(new Error("limit"), { retryAfterMs: 3_600_000 }));
    await submitGeneral();
    expect(await screen.findByText(/Limit reached. Please try again in/)).toBeTruthy();
    expect(screen.queryByText("Thank you!")).toBeNull();
  });
  it("keeps the server cooldown after the minute refresh and on reopen", async () => {
    store.submitFeedback.mockRejectedValue(Object.assign(new Error("limit"), { status: 429, retryAfterMs: 3_600_000 }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { unmount } = render(<FeedbackModal userId="qa-passenger" onClose={vi.fn()} />);
      await user.type(screen.getByRole("textbox"), "The route card should open reliably.");
      await user.click(screen.getByRole("button", { name: "Submit Feedback" }));
      await screen.findByText(/Limit reached/);
      await act(async () => { vi.advanceTimersByTime(61_000); });
      expect((screen.getByRole("button", { name: /^Wait/ }) as HTMLButtonElement).disabled).toBe(true);
      unmount();
      render(<FeedbackModal userId="qa-passenger" onClose={vi.fn()} />);
      expect((screen.getByRole("button", { name: /^Wait/ }) as HTMLButtonElement).disabled).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it("rounds a sub-minute server cooldown up and re-enables submit when it ends", async () => {
    store.submitFeedback.mockRejectedValueOnce(new FeedbackError("Feedback limit reached.", 429, 30_000));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<FeedbackModal userId="qa-passenger" onClose={vi.fn()} />);
      await user.type(screen.getByRole("textbox"), "The route card should open reliably.");
      await user.click(screen.getByRole("button", { name: "Submit Feedback" }));
      await screen.findByText("Limit reached. Please try again in 1m.");
      const wait = screen.getByRole("button", { name: /^Wait/ }) as HTMLButtonElement;
      expect(wait.disabled).toBe(true);
      expect(wait.textContent).toBe("Wait 1m");
      await act(async () => { vi.advanceTimersByTime(30_100); });
      expect((screen.getByRole("button", { name: "Submit Feedback" }) as HTMLButtonElement).disabled).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it("shows the last minute of a local cooldown as 1m, never 0m", () => {
    localStorage.setItem("feedbackCooldown:qa-passenger", String(Date.now() - 86_400_000 + 20_000));
    render(<FeedbackModal userId="qa-passenger" onClose={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toBe("Wait 1m");
  });
  it("explains a rules cooldown denial without storing a client-computed cooldown", async () => {
    store.submitFeedback.mockRejectedValue(new FeedbackError("Feedback limit reached.", 429));
    await submitGeneral();
    expect(await screen.findByText(/You can send feedback once every 24 hours/)).toBeTruthy();
    expect(localStorage.getItem("feedbackCooldown:qa-passenger")).toBeNull();
  });
  it("never locks feedback for longer than one day after a device clock jump", () => {
    localStorage.setItem("feedbackCooldown:qa-passenger", String(Date.now() + 365 * 86_400_000));
    render(<FeedbackModal userId="qa-passenger" onClose={vi.fn()} />);
    const label = screen.getByRole("status").textContent ?? "";
    expect(Number(/Wait (\d+)h/.exec(label)?.[1] ?? 0)).toBeLessThanOrEqual(24);
  });
  it("keeps line breaks when a pasted comment is trimmed to the word limit", () => {
    render(<FeedbackModal userId="qa-passenger" onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "line\n".repeat(205) } });
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(Array(200).fill("line").join("\n"));
  });
  it("supports close and Escape without submitting an empty form", async () => {
    const user = userEvent.setup(); const close = vi.fn();
    render(<FeedbackModal userId="qa-passenger" onClose={close} />);
    expect((screen.getByRole("button", { name: "Submit Feedback" }) as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard("{Escape}"); await user.click(screen.getByRole("button", { name: "Close feedback" }));
    expect(close).toHaveBeenCalledTimes(2); expect(store.submitFeedback).not.toHaveBeenCalled();
  });
});
describe("feedback dialog layering and drafts", () => {
  it("portals the form and its confirmation above every workspace layer", async () => {
    const host = document.body.appendChild(Object.assign(document.createElement("div"), { style: "position: relative; z-index: 30" }));
    try {
      const user = userEvent.setup();
      render(<FeedbackModal userId="qa-passenger" onClose={vi.fn()} />, { container: host });
      expect(host.contains(screen.getByRole("dialog"))).toBe(false);
      expect(screen.getByRole("dialog").parentElement?.parentElement).toBe(document.body);
      await user.type(screen.getByRole("textbox"), "Layering check");
      await user.click(screen.getByRole("button", { name: "Submit Feedback" }));
      expect(await screen.findByText("Thank you!")).toBeTruthy();
      expect(host.contains(screen.getByRole("dialog"))).toBe(false);
    } finally { host.remove(); }
  });
  it("starts from a saved draft and reports each edit", async () => {
    const onDraftChange = vi.fn();
    render(<FeedbackModal userId="qa-passenger" draft="Half-written" onDraftChange={onDraftChange} onClose={vi.fn()} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Half-written");
    await userEvent.setup().type(screen.getByRole("textbox"), "!");
    expect(onDraftChange).toHaveBeenLastCalledWith("Half-written!");
  });
  it("reports the trimmed text when an edit exceeds the word limit", () => {
    const onDraftChange = vi.fn();
    render(<FeedbackModal userId="qa-passenger" onDraftChange={onDraftChange} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: Array.from({ length: 400 }, (_, i) => `w${i}`).join(" ") } });
    const reported = onDraftChange.mock.lastCall?.[0] as string;
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(reported);
    expect(reported.split(/\s+/).length).toBeLessThan(400);
  });
  it("clears the saved draft after a successful submission only", async () => {
    const onDraftChange = vi.fn();
    store.submitFeedback.mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    render(<FeedbackModal userId="qa-passenger" draft="Keep me" onDraftChange={onDraftChange} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Submit Feedback" }));
    await screen.findByText(/Failed to send|offline/);
    expect(onDraftChange).not.toHaveBeenCalledWith("");
    await user.click(screen.getByRole("button", { name: "Submit Feedback" }));
    expect(await screen.findByText("Thank you!")).toBeTruthy();
    expect(onDraftChange).toHaveBeenLastCalledWith("");
  });
});
