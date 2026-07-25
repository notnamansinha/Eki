import { getDistanceMeters } from "./mapUtils";
import { snapToPolyline } from "./snapToPolyline";

export interface LatLng {
  lat: number;
  lng: number;
}

function decodeCoordinate(encoded: string, startIndex: number): {
  value: number;
  nextIndex: number;
} {
  let result = 0;
  let shift = 0;
  let index = startIndex;

  while (index < encoded.length) {
    const byte = encoded.charCodeAt(index++) - 63;
    if (byte < 0 || byte > 63 || shift > 30) {
      throw new Error("Invalid encoded polyline");
    }
    result |= (byte & 0x1f) << shift;
    if (byte < 0x20) {
      return {
        value: result & 1 ? ~(result >> 1) : result >> 1,
        nextIndex: index,
      };
    }
    shift += 5;
  }

  throw new Error("Truncated encoded polyline");
}


export function decodePolyline(encoded: string): LatLng[] {
  if (!encoded) return [];

  const coordinates: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    const latitude = decodeCoordinate(encoded, index);
    const longitude = decodeCoordinate(encoded, latitude.nextIndex);
    index = longitude.nextIndex;
    lat += latitude.value;
    lng += longitude.value;

    const point = { lat: lat / 1e5, lng: lng / 1e5 };
    if (
      !Number.isFinite(point.lat) ||
      !Number.isFinite(point.lng) ||
      Math.abs(point.lat) > 90 ||
      Math.abs(point.lng) > 180
    ) {
      throw new Error("Encoded polyline contains invalid coordinates");
    }
    coordinates.push(point);
  }

  return coordinates;
}

export function getPolylineDistanceMeters(
  from: LatLng,
  to: LatLng,
  polylinePath: readonly LatLng[]
): number {
  if (polylinePath.length < 2) {
    return getDistanceMeters(from, to);
  }

  const snapFrom = snapToPolyline(from, polylinePath);
  const snapTo = snapToPolyline(to, polylinePath);

  if (!snapFrom.snapped || !snapTo.snapped) {
    return getDistanceMeters(from, to);
  }

  const startIdx = snapFrom.segmentIndex;
  const endIdx = snapTo.segmentIndex;

  if (startIdx === endIdx) {
    return getDistanceMeters(snapFrom.point, snapTo.point);
  }

  let totalDist = 0;
  if (startIdx < endIdx) {
    totalDist += getDistanceMeters(snapFrom.point, polylinePath[startIdx + 1]);
    for (let i = startIdx + 1; i < endIdx; i++) {
      totalDist += getDistanceMeters(polylinePath[i], polylinePath[i + 1]);
    }
    totalDist += getDistanceMeters(polylinePath[endIdx], snapTo.point);
  } else {
    totalDist += getDistanceMeters(snapFrom.point, polylinePath[startIdx]);
    for (let i = startIdx - 1; i > endIdx; i--) {
      totalDist += getDistanceMeters(polylinePath[i + 1], polylinePath[i]);
    }
    totalDist += getDistanceMeters(polylinePath[endIdx + 1], snapTo.point);
  }

  return totalDist;
}

