import polyline from '@mapbox/polyline';

export interface LatLng {
  lat: number;
  lng: number;
}

export function decodePolyline(encoded: string): LatLng[] {
  return polyline.decode(encoded).map(([lat, lng]) => ({ lat, lng }));
}

export function encodePolyline(coords: LatLng[]): string {
  return polyline.encode(coords.map(c => [c.lat, c.lng]));
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
