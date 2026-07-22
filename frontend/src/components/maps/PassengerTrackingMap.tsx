"use client";

import MapProviders from "@/components/MapProviders";
import PassengerMap, { type PassengerMapProps } from "@/components/maps/PassengerMap";

// Google Maps is intentionally mounted only while a passenger is tracking a route.
export default function PassengerTrackingMap(props: PassengerMapProps) {
  return (
    <MapProviders>
      <PassengerMap {...props} />
    </MapProviders>
  );
}
