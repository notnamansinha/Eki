import { computeOrderedRouteGeometry } from "./orderedRouteGeometry";
import * as dotenv from "dotenv";
import { resolve } from "path";

// Load environment variables if not already loaded
dotenv.config({ path: resolve(__dirname, "../../.env") });

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteGeometry {
  encodedPolyline: string;
  distanceMeters: number;
  duration: string;
  polylineQuality: "HIGH_QUALITY";
  trafficFallback?: boolean;
}

// Matches the runtime callers (polyline.ts 10s, places.ts 5s) so a hung
// upstream cannot hang `npm run seed` indefinitely (issue #76).
export const ROUTE_GEOMETRY_TIMEOUT_MS = 10_000;
export const LIVE_REROUTE_TIMEOUT_MS = 3_500;

export interface RouteGeometryOptions {
  routingPreference?: "TRAFFIC_AWARE" | "TRAFFIC_AWARE_OPTIMAL";
  timeoutMs?: number;
}

/**
 * Computes route geometry using Google Maps Routes API v2
 */
export async function computeRouteGeometry(
  origin: LatLng,
  destination: LatLng,
  intermediates: LatLng[] = [],
  options: RouteGeometryOptions = {},
): Promise<RouteGeometry> {
  const validPoint = (point: LatLng) =>
    point !== null && typeof point === "object" &&
    Number.isFinite(point.lat) && point.lat >= -90 && point.lat <= 90 &&
    Number.isFinite(point.lng) && point.lng >= -180 && point.lng <= 180;
  if (!validPoint(origin) || !validPoint(destination) ||
      !Array.isArray(intermediates) || !intermediates.every(validPoint)) {
    throw new RangeError("Route waypoints must have valid latitude and longitude.");
  }
  if (intermediates.length > 25) {
    let trafficFallback = false;
    const geometry = await computeOrderedRouteGeometry([origin, ...intermediates, destination], async (chunk) => {
      const result = await computeRouteGeometry(chunk[0], chunk[chunk.length - 1], chunk.slice(1, -1), options);
      trafficFallback ||= result.trafficFallback === true;
      return { polyline: result.encodedPolyline, distanceMeters: result.distanceMeters, duration: result.duration };
    });
    return { encodedPolyline: geometry.polyline, distanceMeters: geometry.distanceMeters, duration: geometry.duration, polylineQuality: "HIGH_QUALITY",
      ...(trafficFallback ? { trafficFallback: true } : {}) };
  }
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY is not set in backend/.env");
  }

  const url = "https://routes.googleapis.com/directions/v2:computeRoutes";

  const body = {
    origin: {
      location: {
        latLng: {
          latitude: origin.lat,
          longitude: origin.lng,
        },
      },
    },
    destination: {
      location: {
        latLng: {
          latitude: destination.lat,
          longitude: destination.lng,
        },
      },
    },
    intermediates: intermediates.map((wp) => ({
      location: {
        latLng: {
          latitude: wp.lat,
          longitude: wp.lng,
        },
      },
    })),
    travelMode: "DRIVE",
    routingPreference: options.routingPreference ?? "TRAFFIC_AWARE_OPTIMAL",
    polylineQuality: "HIGH_QUALITY",
    polylineEncoding: "ENCODED_POLYLINE",
    computeAlternativeRoutes: false,
    languageCode: "en-US",
    units: "METRIC",
  };

  const timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : ROUTE_GEOMETRY_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,fallbackInfo",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Upstream error bodies are not guaranteed to be JSON. Keep the status
      // visible without letting a parse error hide the actual HTTP failure.
      throw new Error(`Google Routes request failed (HTTP ${response.status}).`);
    }

    const data = (await response.json()) as any;
    if (!data.routes || data.routes.length === 0) {
      throw new Error("No routes found for the given waypoints");
    }

    const route = data.routes[0];
    return {
      encodedPolyline: route.polyline.encodedPolyline,
      distanceMeters: route.distanceMeters,
      duration: route.duration,
      polylineQuality: "HIGH_QUALITY",
      ...(data.fallbackInfo ? { trafficFallback: true } : {}),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
