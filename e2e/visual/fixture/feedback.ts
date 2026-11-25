// Synthetic feedback store for the admin Feedback panel. Fixed timestamps keep
// the rendered list identical from run to run.
import type { FeedbackEntry } from "../../../frontend/src/lib/feedback";

const at = (iso: string) => ({ seconds: Math.floor(Date.parse(iso) / 1000), nanoseconds: 0 });

const entries: FeedbackEntry[] = [
  { id: "visual-feedback-1", userId: "qa-passenger", userName: "QA Passenger", type: "ride", busId: "qa-bus", driverId: "qa-driver", sessionId: "qa-session", rating: 4, comment: "The bus reached Beta on time and the live position matched.", timestamp: at("2026-11-20T08:15:00+05:30"), status: "new" },
  { id: "visual-feedback-2", userId: "qa-passenger-2", userName: "Second Passenger", type: "general", busId: null, driverId: null, sessionId: null, rating: null, comment: "Please add the library stop to the evening route.", timestamp: at("2026-11-19T18:40:00+05:30"), status: "reviewed" },
  { id: "visual-feedback-3", userId: "qa-passenger-3", userName: "Third Passenger", type: "ride", busId: "qa-bus", driverId: "qa-driver", sessionId: "qa-session-2", rating: 2, comment: "The arrival estimate jumped twice near the main gate.", timestamp: at("2026-11-18T09:05:00+05:30"), status: "resolved" },
];

export function feedbackErrorMessage(_error: unknown, fallback: string) { return fallback; }
export async function loadFeedback() { return entries.map(entry => ({ ...entry })); }
export async function updateFeedbackStatus() {}
export async function submitFeedback() {}
