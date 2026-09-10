"use client";

import { useEffect, useRef } from "react";
import type { ActiveBusEntry } from "@/lib/activeBusEntries";
import { recordTelemetryRender } from "@/lib/telemetryTrace";

export function useTelemetryRenderTrace(
  entry: ActiveBusEntry,
  consumer: "admin" | "passenger",
  markerVisible: boolean,
): void {
  const rawSequence = entry.rawLocation?.seq;
  const matchedSequence = entry.matchedLocation?.seq;
  const matchedIsCurrent =
    rawSequence !== undefined &&
    matchedSequence === rawSequence &&
    entry.matchedLocation?.sampledAt === entry.timestamp &&
    entry.matchedLocation?.routeVersion === entry.routeVersion;
  const displayKind = !markerVisible
    ? "none" as const
    : matchedIsCurrent
      ? "matched" as const
      : "raw" as const;
  const traceKey = [
    rawSequence ?? "none",
    matchedSequence ?? "none",
    entry.timestamp ?? "none",
    entry.routeVersion ?? "none",
    displayKind,
  ].join(":");
  const lastTraceKey = useRef<string | null>(null);

  useEffect(() => {
    if (lastTraceKey.current === traceKey) return;
    lastTraceKey.current = traceKey;
    const frame = requestAnimationFrame(() => {
      recordTelemetryRender(entry, consumer, displayKind);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    consumer,
    displayKind,
    entry,
    matchedSequence,
    rawSequence,
    traceKey,
  ]);
}
