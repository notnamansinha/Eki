"use client";

import { useState, useEffect, useRef } from "react";
import { Map as GoogleMap, AdvancedMarker, useMap } from "@vis.gl/react-google-maps";
import { MAP_OPTIONS, MAPS_MAP_ID, DEFAULT_CENTER } from "@/config/maps";

interface Props {
  driverLocation: { lat: number; lng: number } | null;
  destination: { lat: number; lng: number } | null;
  onMapClick?: (lat: number, lng: number) => void;
}

function StraightLine({ from, to }: { from: { lat: number; lng: number }, to: { lat: number; lng: number } }) {
  const map = useMap();
  const lineRef = useRef<google.maps.Polyline | null>(null);
  useEffect(() => {
    if (!map) return;
    lineRef.current = new google.maps.Polyline({
      path: [from, to],
      strokeColor: "#2563EB",
      strokeWeight: 6,
      strokeOpacity: 0.8,
      map,
    });
    return () => { lineRef.current?.setMap(null); };
  }, [map, from.lat, from.lng, to.lat, to.lng]);
  return null;
}

export default function GoogleLiveMap({ driverLocation, destination, onMapClick }: Props) {
  const [etaInfo, setEtaInfo] = useState<{ duration_in_traffic: string; distance: string } | null>(null);
  const center = driverLocation || DEFAULT_CENTER;

  useEffect(() => {
    if (driverLocation && destination) {
      // ETA displayed from backend socket data — no Directions API call
      setEtaInfo({ duration_in_traffic: "ETA N/A", distance: "Distance N/A" });
    } else {
      setEtaInfo(null);
    }
  }, [driverLocation, destination]);

  return (
    <div className="relative h-full w-full rounded-xl overflow-hidden shadow-lg border border-white/10" style={{ minHeight: "400px" }}>
      <GoogleMap
        mapId={MAPS_MAP_ID}
        defaultCenter={center}
        defaultZoom={14}
        style={{ height: "100%", width: "100%", position: "absolute", inset: 0 }}
        onClick={(e) => {
          if (onMapClick && e.detail.latLng) {
            onMapClick(e.detail.latLng.lat, e.detail.latLng.lng);
          }
        }}
        {...MAP_OPTIONS}
      >
        {driverLocation && (
          <AdvancedMarker position={driverLocation}>
            <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#4285F4", border: "3px solid white", boxShadow: "0 2px 8px rgba(0,0,0,0.5)" }} />
          </AdvancedMarker>
        )}
        {destination && (
          <AdvancedMarker position={destination}>
            <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#ef4444", border: "3px solid white", boxShadow: "0 2px 8px rgba(0,0,0,0.5)" }} />
          </AdvancedMarker>
        )}
        {driverLocation && destination && (
          <StraightLine from={driverLocation} to={destination} />
        )}
      </GoogleMap>

      {etaInfo && (
        <div className="absolute bottom-6 left-6 bg-white/90 backdrop-blur-md p-4 rounded-xl shadow-xl border border-gray-100 flex flex-col pointer-events-none z-[1000]">
          <span className="text-xs font-bold tracking-wider text-gray-500 uppercase mb-1">Live Status</span>
          <div className="flex items-end gap-3">
            <span className="text-3xl font-extrabold text-blue-600">{etaInfo.duration_in_traffic || "--"}</span>
            <span className="text-sm text-gray-600 mb-1">{etaInfo.distance} remaining</span>
          </div>
        </div>
      )}
    </div>
  );
}
