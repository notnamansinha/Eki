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

  const coords: LatLng[] = [];
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
    coords.push(point);
  }
  return coords;
}

export function encodePolyline(coords: LatLng[]): string {
  let encoded = "";
  let prevLat = 0, prevLng = 0;

  for (const coord of coords) {
    const lat = Math.round(coord.lat * 1e5);
    const lng = Math.round(coord.lng * 1e5);

    let dlat = lat - prevLat;
    let dlng = lng - prevLng;

    prevLat = lat;
    prevLng = lng;

    dlat = (dlat < 0) ? ~(dlat << 1) : (dlat << 1);
    dlng = (dlng < 0) ? ~(dlng << 1) : (dlng << 1);

    while (dlat >= 0x20) {
      encoded += String.fromCharCode((0x20 | (dlat & 0x1f)) + 63);
      dlat >>= 5;
    }
    encoded += String.fromCharCode(dlat + 63);

    while (dlng >= 0x20) {
      encoded += String.fromCharCode((0x20 | (dlng & 0x1f)) + 63);
      dlng >>= 5;
    }
    encoded += String.fromCharCode(dlng + 63);
  }
  return encoded;
}

export function closestPolylineIndex(
  coords: LatLng[],
  target: LatLng
): number {
  let minDist = Infinity;
  let minIdx = 0;
  for (let i = 0; i < coords.length; i++) {
    const dLat = coords[i].lat - target.lat;
    const dLng = coords[i].lng - target.lng;
    const dist = dLat * dLat + dLng * dLng; // squared Euclidean (cheap, no sqrt needed)
    if (dist < minDist) {
      minDist = dist;
      minIdx = i;
    }
  }
  return minIdx;
}
