export interface LatLng {
  lat: number;
  lng: number;
}

export function decodePolyline(encoded: string): LatLng[] {
  const coords: LatLng[] = [];
  let index = 0, lat = 0, lng = 0;

  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    coords.push({ lat: lat / 1e5, lng: lng / 1e5 });
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
