"use client";

import { useEffect, useRef, useState } from "react";
import type { LatLng } from "@/lib/polyline";
import { interpolatePosition } from "@/lib/mapUtils";

export function useSmoothPosition(target: LatLng | null, durationMs = 800) {
  const [position, setPosition] = useState<LatLng | null>(target);
  const currentRef = useRef<LatLng | null>(target);

  useEffect(() => {
    if (!target) {
      currentRef.current = null;
      return;
    }
    const from = currentRef.current ?? target;
    const startedAt = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / Math.max(1, durationMs));
      const next = interpolatePosition(from, target, 1 - Math.pow(1 - progress, 3));
      currentRef.current = next;
      setPosition(next);
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [durationMs, target]);

  return target ? position : null;
}
