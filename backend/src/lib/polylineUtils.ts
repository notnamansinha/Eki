// ── Pure-JS Google Polyline Utils (no API cost) ────────────────────────────

export interface LatLng {
  lat: number;
  lng: number;
}

// Implements the standard Google Maps Encoded Polyline Algorithm
export function decodePolyline(encoded: string): LatLng[] {
  const coords: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    coords.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return coords;
}

export function encodePolyline(coords: LatLng[]): string {
  let output = "";
  let prevLat = 0;
  let prevLng = 0;

  for (const { lat, lng } of coords) {
    const currLat = Math.round(lat * 1e5);
    const currLng = Math.round(lng * 1e5);
    output += encodeValue(currLat - prevLat);
    output += encodeValue(currLng - prevLng);
    prevLat = currLat;
    prevLng = currLng;
  }

  return output;
}

export function encodeValue(value: number): string {
  let encoded = "";
  let v = value < 0 ? ~(value << 1) : value << 1;
  while (v >= 0x20) {
    encoded += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  encoded += String.fromCharCode(v + 63);
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
