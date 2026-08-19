"use client";

import { useEffect, useRef, useState } from "react";
import {
  selectStableMarkerPosition,
  type MarkerPositionSample,
} from "@/lib/stableMarkerPosition";

export function useStableMarkerPosition(sample: MarkerPositionSample) {
  const { point, sessionId, speedKmh, timestamp, trustworthy } = sample;
  const [position, setPosition] = useState(sample.point);
  const acceptedRef = useRef<MarkerPositionSample | null>(
    sample.trustworthy ? sample : null,
  );

  useEffect(() => {
    const decision = selectStableMarkerPosition(acceptedRef.current, {
      point,
      sessionId,
      speedKmh,
      timestamp,
      trustworthy,
    });
    acceptedRef.current = decision.accepted;
    const frame = requestAnimationFrame(() => setPosition(decision.point));
    return () => cancelAnimationFrame(frame);
  }, [
    point,
    sessionId,
    speedKmh,
    timestamp,
    trustworthy,
  ]);

  return position;
}
