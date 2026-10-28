import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackError, loadFeedback, submitFeedback, updateFeedbackStatus } from "./feedbackStore";

const fixture = vi.hoisted(() => ({
  uid: "passenger", generation: 0, records: new Map<string, Record<string, unknown>>(),
  writes: vi.fn(), read: vi.fn(), update: vi.fn(),
  beforeRead: null as (() => void) | null,
  commitError: null as unknown,
}));
vi.mock("./firebaseAuth", () => ({ auth: { get currentUser() { return { uid: fixture.uid }; } } }));
vi.mock("./authState", () => ({ getAuthVerificationGeneration: () => fixture.generation }));
vi.mock("./firebaseFirestore", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, collection: string, id: string) => `${collection}/${id}`,
  collection: (_db: unknown, name: string) => name,
  query: (...parts: unknown[]) => parts,
  orderBy: (...parts: unknown[]) => parts,
  limit: (count: number) => count,
  serverTimestamp: () => "server-timestamp",
  getDocsFromServer: (...args: unknown[]) => fixture.read(...args),
  updateDoc: (...args: unknown[]) => fixture.update(...args),
  runTransaction: async (_db: unknown, callback: (tx: unknown) => Promise<void>) => {
    const pending = new Map<string, Record<string, unknown>>();
    await callback({
      get: async (path: string) => {
        fixture.beforeRead?.();
        const value = fixture.records.get(path);
        return { exists: () => value !== undefined, data: () => value };
      },
      set: (path: string, data: Record<string, unknown>) => pending.set(path, data),
    });
    if (fixture.commitError) throw fixture.commitError;
    for (const [path, data] of pending) { fixture.writes(path, data); fixture.records.set(path, data); }
  },
}));
const requestId = "feedback-request-0001";
const input = { type: "general" as const, rating: null, comment: "  Please improve the timetable  " };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const path = `feedbacks/${hash(`passenger\0${requestId}`)}`;
beforeEach(() => {
  fixture.uid = "passenger"; fixture.generation = 0; fixture.records.clear();
  fixture.beforeRead = null; fixture.commitError = null; fixture.writes.mockClear(); fixture.read.mockReset(); fixture.update.mockReset();
  fixture.records.set("users/passenger", { displayName: "Passenger Name" });
});
describe("Firestore feedback persistence", () => {
  it("writes feedback and cooldown atomically with API-compatible retry hashes", async () => {
    await submitFeedback("passenger", input, requestId);
    expect(fixture.records.get(path)).toMatchObject({ userId: "passenger", userName: "Passenger Name", type: "general",
      comment: input.comment.trim(), busId: null, rating: null, status: "new", timestamp: "server-timestamp",
      requestHash: hash(JSON.stringify({ kind: "general", sessionId: null, busId: null, driverId: null, rating: null, comment: input.comment.trim() })),
    });
    expect(fixture.records.get("feedbackCooldowns/passenger")).toEqual({ userId: "passenger", feedbackId: path.split("/")[1], lastSubmittedAt: "server-timestamp" });
    expect(fixture.writes).toHaveBeenCalledTimes(2);
  });
  it("replays a committed request without a duplicate even during cooldown", async () => {
    await submitFeedback("passenger", input, requestId);
    fixture.records.set("feedbackCooldowns/passenger", { lastSubmittedAt: { toMillis: () => Date.now() } });
    fixture.writes.mockClear(); await submitFeedback("passenger", input, requestId);
    expect(fixture.writes).not.toHaveBeenCalled();
    await expect(submitFeedback("passenger", { ...input, comment: "Changed feedback" }, requestId)).rejects.toMatchObject({ status: 409 });
  });
  it.each(["timestamp", "legacy-number"])("honors shared cooldowns (%s) without any writes", async format => {
    const stamp = Date.now(); fixture.records.set("feedbackCooldowns/passenger", { lastSubmittedAt: format === "timestamp" ? { toMillis: () => stamp } : stamp });
    await expect(submitFeedback("passenger", input, requestId)).rejects.toMatchObject({ status: 429, retryAfterMs: expect.any(Number) });
    expect(fixture.writes).not.toHaveBeenCalled();
  });
  it("lets the rules decide when the device clock is behind the server cooldown stamp", async () => {
    // Server time is 2026-10-27T12:00Z and the last server stamp is 25h old, so the rules allow a write.
    const serverNow = Date.parse("2026-10-27T12:00:00Z");
    fixture.records.set("feedbackCooldowns/passenger", { lastSubmittedAt: { toMillis: () => serverNow - 25 * 3_600_000 } });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(serverNow - 3 * 86_400_000);
      await expect(submitFeedback("passenger", input, requestId)).resolves.toBeUndefined();
      expect(fixture.writes).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it("reports a rules cooldown denial as a cooldown, not as an access problem", async () => {
    fixture.records.set("feedbackCooldowns/passenger", { lastSubmittedAt: { toMillis: () => Date.now() - 25 * 3_600_000 } });
    fixture.commitError = { code: "permission-denied" };
    const error = await submitFeedback("passenger", input, requestId).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FeedbackError);
    expect(error).toMatchObject({ status: 429, retryAfterMs: undefined });
  });
  it("keeps eligibility denials for users without a recent cooldown stamp", async () => {
    fixture.commitError = { code: "permission-denied" };
    await expect(submitFeedback("passenger", input, requestId)).rejects.toEqual({ code: "permission-denied" });
    fixture.records.set("feedbackCooldowns/passenger", { lastSubmittedAt: { toMillis: () => Date.now() - 3 * 86_400_000 } });
    await expect(submitFeedback("passenger", input, requestId)).rejects.toEqual({ code: "permission-denied" });
  });
  it("rejects deleted profiles and changed accounts before writing", async () => {
    fixture.records.delete("users/passenger");
    await expect(submitFeedback("passenger", input, requestId)).rejects.toMatchObject({ status: 403 });
    fixture.records.set("users/passenger", {});
    fixture.beforeRead = () => { fixture.generation++; };
    await expect(submitFeedback("passenger", input, requestId)).rejects.toMatchObject({ status: 401 });
    expect(fixture.writes).not.toHaveBeenCalled();
  });
  it("validates missing ride context and excessive words before writing", async () => {
    await expect(submitFeedback("passenger", { ...input, type: "ride", rating: 5 }, requestId)).rejects.toThrow(/completed ride/);
    await expect(submitFeedback("passenger", { ...input, comment: "word ".repeat(201) }, requestId)).rejects.toThrow(/limits/);
    expect(fixture.writes).not.toHaveBeenCalled();
  });
  it("loads the latest 200 from the server on every retry and validates stored data", async () => {
    fixture.read.mockResolvedValue({ docs: [{ id: "existing", data: () => ({ userId: "passenger", comment: "A suggestion" }) }] });
    expect(await loadFeedback()).toMatchObject([{ id: "existing", type: "general", status: "new" }]);
    await loadFeedback();
    expect(fixture.read).toHaveBeenCalledTimes(2);
    expect(fixture.read).toHaveBeenCalledWith(["feedbacks", ["timestamp", "desc"], 200]);
  });
  it("normalizes a malformed or legacy document instead of hiding the other 199 entries", async () => {
    const valid = (i: number): { id: string; data: () => Record<string, unknown> } => ({ id: `fb${i}`, data: () => ({ userId: `u${i}`, userName: "P", type: "general", comment: "ok",
      rating: null, status: "new", timestamp: { seconds: 1_700_000_000 - i, nanoseconds: 0 } }) });
    const docs = Array.from({ length: 199 }, (_, i) => valid(i));
    docs.splice(5, 0, { id: "legacy", data: () => ({ userId: 7, userName: 42, type: "ride", comment: ["x"], busId: 3,
      driverId: "driver-1", sessionId: { id: "s" }, rating: "5", status: "pending", timestamp: 1_700_000_000_000 }) });
    fixture.read.mockResolvedValue({ docs });
    const entries = await loadFeedback();
    expect(entries).toHaveLength(200);
    expect(entries[5]).toEqual({ id: "legacy", userId: "", userName: "Passenger", type: "ride", comment: "", busId: null,
      driverId: "driver-1", sessionId: null, rating: null, status: "new", timestamp: null });
    expect(entries[0]).toMatchObject({ id: "fb0", timestamp: { seconds: 1_700_000_000, nanoseconds: 0 } });
  });
  it.each([
    ["non-finite rating", { rating: Number.NaN }, { rating: null }],
    ["out-of-range nanoseconds", { timestamp: { seconds: 1, nanoseconds: 1e9 } }, { timestamp: null }],
    ["string timestamp", { timestamp: "2026-10-27" }, { timestamp: null }],
    ["reviewed status", { status: "reviewed", rating: 4 }, { status: "reviewed", rating: 4 }],
  ])("coerces %s per field", async (_label, patch, expected) => {
    fixture.read.mockResolvedValue({ docs: [{ id: "doc", data: () => ({ userId: "u", comment: "c", ...patch }) }] });
    expect((await loadFeedback())[0]).toMatchObject(expected);
  });
  it("records the authenticated admin and waits for write errors", async () => {
    fixture.uid = "admin";
    fixture.update.mockRejectedValueOnce({ code: "permission-denied" });
    await expect(updateFeedbackStatus("admin", "existing", "reviewed")).rejects.toMatchObject({ code: "permission-denied" });
    expect(fixture.update).toHaveBeenCalledWith("feedbacks/existing", { status: "reviewed", reviewedBy: "admin", reviewedAt: "server-timestamp" });
  });
});
