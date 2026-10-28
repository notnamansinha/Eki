"use client";

import { catchError, type ErrorInfo } from "next/error";
import { AlertCircle } from "lucide-react";

/**
 * Keeps a render crash (for example a malformed Firestore document) inside the
 * admin section that hit it, so the tab bar and other sections keep working.
 * Admin data is read client-side, so `reset()` re-renders with the latest
 * snapshot; `retry()` would refetch the static-export page payload needlessly.
 */
function AdminPanelErrorFallback(_props: object, { reset }: ErrorInfo) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div role="alert" className="space-y-2 text-sm text-red-400/80">
        <AlertCircle className="mx-auto size-8 opacity-70" aria-hidden="true" />
        <p>This section could not be displayed.</p>
        <p className="text-xs text-white/40">
          A stored record may be malformed. Other sections are still available.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export default catchError(AdminPanelErrorFallback);
