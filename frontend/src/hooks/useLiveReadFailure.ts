"use client";

import { useCallback, useState } from "react";
import { classifyLiveReadFailure, type LiveReadFailure } from "@/lib/liveDataErrors";

/**
 * The live-fleet read failure an admin panel reports, classified so a
 * permission denial is not presented as a connection problem. Pass
 * `onReadError` and `onReadRecovered` to `useActiveBuses`.
 */
export function useLiveReadFailure() {
  const [failure, setFailure] = useState<LiveReadFailure | null>(null);
  // A denial stays until a live delivery recovers the read: the store retries after
  // every listener error, and a later network error must not turn it back into
  // "check your connection".
  const onReadError = useCallback((error: Error) => setFailure((current) => (current === "permission_denied" ? current : classifyLiveReadFailure(error))), []);
  const onReadRecovered = useCallback(() => setFailure(null), []);
  return { failure, onReadError, onReadRecovered };
}
