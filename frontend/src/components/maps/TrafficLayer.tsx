"use client";

import { useEffect } from "react";
import { useMap } from "@vis.gl/react-google-maps";

/** Keep the Google Maps layer mounted across parent telemetry renders. */
export default function TrafficLayer() {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    const layer = new google.maps.TrafficLayer();
    layer.setMap(map);
    return () => { layer.setMap(null); };
  }, [map]);

  return null;
}
