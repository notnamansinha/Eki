"use client";

import { useState, useEffect } from "react";
import { distanceFromPolyline } from "@/lib/mapUtils";
import { REROUTE_DEVIATION_METERS } from "@/config/brtsRoutes";

export function useRerouting({
  currentPosition,
  routePolyline,
  onReroute,
}: {
  currentPosition: { lat: number; lng: number } | null;
  routePolyline: { lat: number; lng: number }[];
  onReroute: () => void;
}) {
  const [isRerouting, setIsRerouting] = useState(false);

  useEffect(() => {
    if (!currentPosition || routePolyline.length === 0 || isRerouting) return;

    const d = distanceFromPolyline(currentPosition, routePolyline);

    if (d > REROUTE_DEVIATION_METERS) {
      setIsRerouting(true);
      onReroute();

      setTimeout(() => {
        setIsRerouting(false);
      }, 3000);
    }
  }, [currentPosition, routePolyline, isRerouting, onReroute]);

  return { isRerouting };
}
