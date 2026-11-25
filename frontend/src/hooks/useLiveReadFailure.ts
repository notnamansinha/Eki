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
  const onReadError = useCallback((error: Error) => setFailure(classifyLiveReadFailure(error)), []);
  const onReadRecovered = useCallback(() => setFailure(null), []);
  return { failure, onReadError, onReadRecovered };
}
