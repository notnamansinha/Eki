import { RouteStop } from "@/hooks/useRoutes";
import { getDistanceMeters } from "@/lib/mapUtils";

const BUS_SPEED_FLOOR_KMH = 15;
const ROUTE_DISTANCE_MULTIPLIER = 1.3;
const STOP_DWELL_BUFFER_METERS = 125;

export interface RouteEtaBus {
  lat: number;
  lng: number;
  speed?: number;
  currentStopIndex?: number;
  delayMinutes?: number;
}

export function calculateStopEtas(
  stops: RouteStop[],
  bus: RouteEtaBus,
  lastKnownStopIndex = 0
): { stopEtas: Record<string, number>; closestStopIndex: number } {
  if (stops.length === 0) {
    return { stopEtas: {}, closestStopIndex: 0 };
  }

  let closestStopIndex: number;

  if (bus.currentStopIndex !== undefined) {
    closestStopIndex = Math.max(0, Math.min(stops.length - 1, bus.currentStopIndex));
  } else {
    const safeLastKnown = Math.max(0, Math.min(stops.length - 1, lastKnownStopIndex));
    const searchStart = Math.max(0, safeLastKnown - 1);
    const searchEnd = Math.min(stops.length - 1, safeLastKnown + 3);
    let minDistance = Infinity;
    closestStopIndex = safeLastKnown;

    for (let i = searchStart; i <= searchEnd; i++) {
      const distance = getDistanceMeters({ lat: bus.lat, lng: bus.lng }, stops[i]);
      if (distance < minDistance) {
        minDistance = distance;
        closestStopIndex = i;
      }
    }

    if (minDistance > 500) {
      stops.forEach((stop, index) => {
        const distance = getDistanceMeters({ lat: bus.lat, lng: bus.lng }, stop);
        if (distance < minDistance) {
          minDistance = distance;
          closestStopIndex = index;
        }
      });
    }
  }

  const busSpeedKmh = bus.speed && bus.speed > 0 ? bus.speed : BUS_SPEED_FLOOR_KMH;
  const metersPerMinute = (busSpeedKmh * 1000) / 60;
  const busDelay = bus.delayMinutes || 0;
  const stopEtas: Record<string, number> = {};
  let accumulatedDistance =
    getDistanceMeters({ lat: bus.lat, lng: bus.lng }, stops[closestStopIndex]) *
    ROUTE_DISTANCE_MULTIPLIER;

  stopEtas[stops[closestStopIndex].id] = Math.ceil(accumulatedDistance / metersPerMinute) + busDelay;

  for (let i = closestStopIndex + 1; i < stops.length; i++) {
    const segmentDistance =
      getDistanceMeters(stops[i - 1], stops[i]) * ROUTE_DISTANCE_MULTIPLIER +
      STOP_DWELL_BUFFER_METERS;
    accumulatedDistance += segmentDistance;
    stopEtas[stops[i].id] = Math.ceil(accumulatedDistance / metersPerMinute) + busDelay;
  }

  return { stopEtas, closestStopIndex };
}
