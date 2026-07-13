"use client";

import { useEffect, useRef, useState } from "react";
import { Map as GoogleMap, AdvancedMarker, useMap } from "@vis.gl/react-google-maps";
import { MAP_OPTIONS, MAPS_MAP_ID } from "@/config/maps";

interface Stop {
  id: string;
  name: string;
  shortName: string;
  lat: number;
  lng: number;
}

interface RoutePlannerMapProps {
  stopsOnSegment: Stop[];
  polyline: string;
  routeColor: string;
  startStopId: string;
  endStopId: string;
  viaStopId?: string | null;
  onStopClick?: (stop: Stop) => void;
}

const DEFAULT_CENTER = { lat: 23.033, lng: 72.545 }; // Ahmedabad

function decodePolyline(str: string, precision: number = 5) {
  let index = 0, lat = 0, lng = 0, coordinates: { lat: number; lng: number }[] = [], shift = 0, result = 0, byte: number | null = null, latitude_change: number, longitude_change: number, factor = Math.pow(10, precision);
  while (index < str.length) {
    byte = null; shift = 0; result = 0;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
    shift = result = 0;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += latitude_change; lng += longitude_change;
    coordinates.push({ lat: lat / factor, lng: lng / factor });
  }
  return coordinates;
}

function RouteLine({ decodedPath, routeColor }: { decodedPath: { lat: number; lng: number }[], routeColor: string }) {
  const map = useMap();
  const lineRef = useRef<google.maps.Polyline | null>(null);

  useEffect(() => {
    if (!map || decodedPath.length === 0) return;

    lineRef.current = new google.maps.Polyline({
      path: decodedPath,
      strokeColor: routeColor,
      strokeWeight: 7,
      strokeOpacity: 0.9,
      map,
    });

    return () => { lineRef.current?.setMap(null); };
  }, [map, decodedPath, routeColor]);

  return null;
}

function BoundsFitter({ decodedPath }: { decodedPath: { lat: number; lng: number }[] }) {
  const map = useMap();
  useEffect(() => {
    if (!map || decodedPath.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    decodedPath.forEach(pt => bounds.extend(pt));
    map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
  }, [map, decodedPath]);
  return null;
}

function RoutePlannerMapInner({
  stopsOnSegment,
  polyline,
  routeColor,
  startStopId,
  endStopId,
  viaStopId,
  onStopClick,
}: RoutePlannerMapProps) {
  const decodedPath = polyline ? decodePolyline(polyline) : [];

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <GoogleMap
        mapId={MAPS_MAP_ID}
        defaultCenter={DEFAULT_CENTER}
        defaultZoom={13}
        style={{ width: "100%", height: "100%" }}
        {...MAP_OPTIONS}
      >
        <BoundsFitter decodedPath={decodedPath} />
        <RouteLine decodedPath={decodedPath} routeColor={routeColor} />

        {stopsOnSegment.map((stop, i) => {
          const isStart   = stop.id === startStopId;
          const isEnd     = stop.id === endStopId;
          const isVia     = stop.id === viaStopId;
          const isTerminal = isStart || isEnd;
          const dotColor  = isStart ? "#22c55e" : isEnd ? "#ef4444" : isVia ? "#f59e0b" : routeColor;
          const dotSize   = isTerminal ? 22 : isVia ? 16 : 12;
          const labelBg   = isStart ? "#22c55e" : isEnd ? "#ef4444" : isVia ? "#f59e0b" : "rgba(26,28,41,0.95)";

          return (
            <AdvancedMarker
              key={`planner-stop-${stop.id}-${i}`}
              position={{ lat: stop.lat, lng: stop.lng }}
              onClick={() => onStopClick?.(stop)}
            >
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", transform: "translateY(-50%)" }}>
                {/* Label */}
                <div style={{
                  background: labelBg,
                  border: "2px solid rgba(255,255,255,0.3)",
                  color: "#ffffff",
                  padding: "3px 10px",
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: "0.1em",
                  whiteSpace: "nowrap",
                  marginBottom: 6,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                  opacity: isTerminal || isVia ? 1 : 0,
                  transition: "opacity 0.2s",
                }}>
                  {stop.shortName}
                </div>

                {/* Dot */}
                {isTerminal ? (
                  <div style={{ position: "relative" }}>
                    <div style={{
                      position: "absolute", inset: -8, borderRadius: "50%",
                      background: isStart ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)",
                      animation: "pulse 2s infinite",
                    }} />
                    <div style={{
                      width: dotSize, height: dotSize, borderRadius: "50%",
                      background: dotColor, border: "4px solid #0f1117",
                      boxShadow: `0 0 0 3px ${isStart ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
                      position: "relative", zIndex: 10,
                    }} />
                  </div>
                ) : (
                  <div style={{
                    width: dotSize, height: dotSize, borderRadius: "50%",
                    background: dotColor, border: "3px solid #0f1117",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
                    transition: "transform 0.2s",
                  }} />
                )}
              </div>
            </AdvancedMarker>
          );
        })}
      </GoogleMap>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
    </div>
  );
}

export default function RoutePlannerMap(props: RoutePlannerMapProps) {
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <RoutePlannerMapInner {...props} />
    </div>
  );
}
