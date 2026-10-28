import { isApiRecord } from "./apiClient";

export interface FeedbackEntry {
  id: string;
  userId: string;
  userName: string;
  type: "ride" | "general";
  busId: string | null;
  driverId: string | null;
  sessionId: string | null;
  rating: number | null;
  comment: string;
  timestamp: { seconds: number; nanoseconds: number } | null;
  status: "new" | "reviewed" | "resolved";
}

export function isFeedbackList(value: unknown): value is { feedbacks: FeedbackEntry[] } {
  if (!isApiRecord(value) || !Array.isArray(value.feedbacks) || value.feedbacks.length > 200) return false;
  const ids = new Set<string>();
  return value.feedbacks.every(entry => {
    if (!isApiRecord(entry) || typeof entry.id !== "string" || !entry.id || ids.has(entry.id)) return false;
    ids.add(entry.id);
    return ["userId", "userName", "comment"].every(key => typeof entry[key] === "string") &&
      ["busId", "driverId", "sessionId"].every(key => entry[key] === null || typeof entry[key] === "string") &&
      (entry.type === "general" || entry.type === "ride") &&
      (entry.status === "new" || entry.status === "reviewed" || entry.status === "resolved") &&
      (entry.rating === null || (typeof entry.rating === "number" && Number.isFinite(entry.rating))) &&
      (entry.timestamp === null || (isApiRecord(entry.timestamp) &&
        Number.isSafeInteger(entry.timestamp.seconds) && Number.isInteger(entry.timestamp.nanoseconds) &&
        (entry.timestamp.nanoseconds as number) >= 0 && (entry.timestamp.nanoseconds as number) < 1e9));
  });
}

const optionalString = (value: unknown) => typeof value === "string" ? value : null;

/**
 * Coerces one stored feedback document field by field, matching the backend list route, so a
 * single legacy or hand-edited document can never blank the whole admin feedback list.
 */
export function normalizeFeedbackEntry(id: string, data: Record<string, unknown>): FeedbackEntry {
  const timestamp = isApiRecord(data.timestamp) ? data.timestamp : null;
  return {
    id,
    userId: typeof data.userId === "string" ? data.userId : "",
    userName: typeof data.userName === "string" ? data.userName : "Passenger",
    type: data.type === "ride" ? "ride" : "general",
    busId: optionalString(data.busId),
    driverId: optionalString(data.driverId),
    sessionId: optionalString(data.sessionId),
    rating: typeof data.rating === "number" && Number.isFinite(data.rating) ? data.rating : null,
    comment: typeof data.comment === "string" ? data.comment : "",
    status: data.status === "reviewed" || data.status === "resolved" ? data.status : "new",
    timestamp: timestamp && Number.isSafeInteger(timestamp.seconds) && Number.isInteger(timestamp.nanoseconds) &&
      (timestamp.nanoseconds as number) >= 0 && (timestamp.nanoseconds as number) < 1e9
      ? { seconds: timestamp.seconds as number, nanoseconds: timestamp.nanoseconds as number }
      : null,
  };
}
