"use client";

import MapProviders from "@/components/MapProviders";
import PassengerMap, { type PassengerMapProps } from "@/components/maps/PassengerMap";

// Google Maps is intentionally mounted only while a passenger is tracking a route; the google.maps.Map instance itself is reused across mounts (reuseMaps, see config/maps.ts).
export default function PassengerTrackingMap(props: PassengerMapProps) {
  return (
    <MapProviders>
      <PassengerMap {...props} />
    </MapProviders>
  );
}
