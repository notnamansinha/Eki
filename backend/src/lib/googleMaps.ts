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
}

/**
 * Computes route geometry using Google Maps Routes API v2
 */
export async function computeRouteGeometry(
  origin: LatLng,
  destination: LatLng,
  intermediates: LatLng[] = []
): Promise<RouteGeometry> {
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
    routingPreference: "TRAFFIC_AWARE_OPTIMAL",
    computeAlternativeRoutes: false,
    languageCode: "en-US",
    units: "METRIC",
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = (await response.json()) as any;
    throw new Error(errorData.error?.message || "Failed to compute route via Routes API v2");
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
  };
}
