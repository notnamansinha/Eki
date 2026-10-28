// Synthetic provider boundaries for the real Profile and feedback components.
// Nothing here reaches Firebase or the university API.
import { qaUser } from "./state";

export const auth = {
  get currentUser() { return { uid: qaUser.uid, getIdToken: async () => "qa-token" }; },
};
export const submittedFeedback: unknown[] = [];
export async function submitFeedback(uid: string, input: unknown) {
  submittedFeedback.push({ uid, input });
  (window as unknown as { __qaFeedback?: unknown[] }).__qaFeedback = submittedFeedback;
}
export function feedbackErrorMessage(_error: unknown, fallback: string) { return fallback; }
export async function apiRequest() { return { accepted: true }; }
