import { ApiError } from "./apiClient";
import { errorMessage } from "./errors";

const PLACE_SEARCH_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "Place search is unavailable. Sign in again and retry.",
  ADMIN_REQUIRED: "Your account no longer has permission to search for route stops.",
  AUTH_INVALID: "Your session expired. Sign in again and retry.",
  AUTH_BUSY: "Authentication is busy. Wait briefly and retry.",
  PLACES_NOT_CONFIGURED: "Place search is not configured on the backend.",
  PLACES_UPSTREAM_RATE_LIMITED: "Place search is busy. Wait briefly and retry.",
  PLACE_SEARCH_RATE_LIMITED: "Too many searches. Wait a minute and retry.",
  PLACES_TIMEOUT: "Place search took too long. Please retry.",
  BACKEND_UNAVAILABLE: "The route backend could not be reached. Check the connection and retry.",
};

export function placeSearchErrorMessage(error: unknown): string {
  if (error instanceof ApiError && PLACE_SEARCH_MESSAGES[error.code]) {
    return PLACE_SEARCH_MESSAGES[error.code];
  }
  return errorMessage(error);
}
