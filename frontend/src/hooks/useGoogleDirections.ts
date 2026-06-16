"use client";

import { useState } from "react";

export interface RouteSummary {
  duration: number;
  durationText: string;
  distanceMeters: number;
  distanceText: string;
  summary: string;
  overview_polyline: string;
  overview_path?: { lat: () => number; lng: () => number }[];
}

export function useGoogleDirections(options: any) {
  // Mocked out since Google Maps API is removed
  const [allRoutes] = useState<any[]>([]);
  const [routeSummaries] = useState<RouteSummary[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [isLoading] = useState(false);
  const [error] = useState<string | null>(null);

  const selectRoute = (index: number) => {
    setSelectedRouteIndex(index);
  };

  return {
    allRoutes,
    routeSummaries,
    selectedRouteIndex,
    selectRoute,
    isLoading,
    error,
  };
}
