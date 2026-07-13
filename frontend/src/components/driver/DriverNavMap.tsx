"use client";

import { useEffect, useRef } from "react";
import { Map as GoogleMap, AdvancedMarker, useMap } from "@vis.gl/react-google-maps";
import { useRoutes } from "@/hooks/useRoutes";
import DirectionsPanel from "@/components/shared/DirectionsPanel";
import { useState } from "react";
import { MAP_OPTIONS, MAPS_MAP_ID } from "@/config/maps";

interface Props {
  driverLocation: { lat: number; lng: number; heading: number } | null;
  selectedRouteId?: string;
}

function RoutePolyline({ path }: { path: { lat: number; lng: number }[] }) {
  const map = useMap();
  const lineRef = useRef<google.maps.Polyline | null>(null);
  useEffect(() => {
    if (!map || path.length === 0) return;
    lineRef.current = new google.maps.Polyline({
      path,
      strokeColor: "#2563EB",
      strokeWeight: 6,
      strokeOpacity: 0.8,
      map,
    });
    return () => { lineRef.current?.setMap(null); };
  }, [map, path]);
  return null;
}

function MapRecenter({ location }: { location: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (map && location) {
      map.panTo(location);
    }
  }, [map, location]);
  return null;
}

function DriverNavMapInner({ driverLocation, selectedRouteId }: Props) {
  const { routes } = useRoutes();
  const [assignedPath, setAssignedPath] = useState<{ lat: number; lng: number }[]>([]);
  const [routeResult, setRouteResult] = useState<any | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  useEffect(() => {
    if (selectedRouteId && routes.length > 0) {
      const route = routes.find((r) => r.id === selectedRouteId);
      if (route && route.waypoints.length >= 2) {
        setAssignedPath(route.waypoints.map(w => ({ lat: w.lat, lng: w.lng })));
      }
    } else {
      setAssignedPath([]);
      setRouteResult(null);
    }
  }, [selectedRouteId, routes]);

  const defaultCenter = driverLocation || { lat: 23.0225, lng: 72.5714 };
  const snappedHeading = driverLocation ? Math.round(driverLocation.heading / 5) * 5 : 0;

  return (
    <div className="relative h-full w-full">
      <GoogleMap
        mapId={MAPS_MAP_ID}
        defaultCenter={defaultCenter}
        defaultZoom={16}
        style={{ height: "100%", width: "100%" }}
        {...MAP_OPTIONS}
      >
        <MapRecenter location={driverLocation} />
        <RoutePolyline path={assignedPath} />

        {driverLocation && (
          <AdvancedMarker position={{ lat: driverLocation.lat, lng: driverLocation.lng }}>
            <div style={{ width: 48, height: 48, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ transform: `rotate(${snappedHeading}deg)`, transition: "transform 600ms" }}>
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L20 20L12 16L4 20L12 2Z" fill="#10b981" stroke="white" strokeWidth="1" strokeLinejoin="round" />
                </svg>
              </div>
              <div style={{ position: "absolute", bottom: -4, right: -4, width: 10, height: 10, borderRadius: "50%", background: "#10b981", border: "1px solid #000" }} />
            </div>
          </AdvancedMarker>
        )}
      </GoogleMap>

      <DirectionsPanel
        result={routeResult}
        isOpen={isPanelOpen}
        onToggle={() => setIsPanelOpen(!isPanelOpen)}
      />
    </div>
  );
}

export default DriverNavMapInner;
