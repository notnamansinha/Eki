"use client";

import { useEffect, useRef, useState } from "react";
import type { LatLng } from "@/lib/polyline";
import { getDistanceMeters, interpolatePosition } from "@/lib/mapUtils";

// Both movement thresholds stay sub-pixel at the app's supported map zooms.
const MIN_TARGET_CHANGE_METERS = 1;
const MIN_RENDER_CHANGE_METERS = 0.5;
const MAX_RENDER_INTERVAL_MS = 50;

export function useSmoothPosition(target: LatLng | null, durationMs = 250) {
  const [position, setPosition] = useState<LatLng | null>(target);
  const currentRef = useRef<LatLng | null>(target);
  const renderedRef = useRef<LatLng | null>(target);

  useEffect(() => {
    if (!target) {
      currentRef.current = null;
      renderedRef.current = null;
      return;
    }
    if (
      currentRef.current &&
      getDistanceMeters(currentRef.current, target) < MIN_TARGET_CHANGE_METERS
    ) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      currentRef.current = target;
      renderedRef.current = target;
      const frame = requestAnimationFrame(() => setPosition(target));
      return () => cancelAnimationFrame(frame);
    }
    const from = currentRef.current ?? target;
    const startedAt = performance.now();
    const renderIntervalMs = Math.min(MAX_RENDER_INTERVAL_MS, Math.max(1, durationMs / 2));
    let lastRenderedAt = startedAt;
    let frame = 0;
    let cancelled = false;
    const animate = (now: number) => {
      if (cancelled) return;
      const progress = Math.min(1, (now - startedAt) / Math.max(1, durationMs));
      const next = interpolatePosition(from, target, 1 - Math.pow(1 - progress, 3));
      currentRef.current = next;
      const renderDue = now - lastRenderedAt >= renderIntervalMs || progress === 1;
      const movedEnough = !renderedRef.current ||
        getDistanceMeters(renderedRef.current, next) >= MIN_RENDER_CHANGE_METERS;
      if (renderDue && (movedEnough || progress === 1)) {
        lastRenderedAt = now;
        renderedRef.current = next;
        setPosition(next);
      }
      if (progress < 1 && !cancelled) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [durationMs, target]);

  return target ? position : null;
}
