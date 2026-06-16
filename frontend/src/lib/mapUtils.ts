export function getBearing(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function getDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371e3; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const a_val =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a_val), Math.sqrt(1 - a_val));

  return R * c;
}

export function getDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return getDistanceMeters(a, b) / 1000;
}

export function interpolatePosition(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  t: number // 0 to 1
): { lat: number; lng: number } {
  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lng: from.lng + (to.lng - from.lng) * t,
  };
}

// Projection-based distance from a line segment
function distanceToSegmentMeters(
  p: { lat: number; lng: number },
  v: { lat: number; lng: number },
  w: { lat: number; lng: number }
): number {
  // Approximate flat earth math for small scale distances
  const l2 = Math.pow(w.lat - v.lat, 2) + Math.pow(w.lng - v.lng, 2);
  if (l2 === 0) return getDistanceMeters(p, v);

  // t parameterized projection
  let t = ((p.lat - v.lat) * (w.lat - v.lat) + (p.lng - v.lng) * (w.lng - v.lng)) / l2;
  t = Math.max(0, Math.min(1, t));

  const projection = {
    lat: v.lat + t * (w.lat - v.lat),
    lng: v.lng + t * (w.lng - v.lng),
  };

  return getDistanceMeters(p, projection);
}

export function distanceFromPolyline(
  position: { lat: number; lng: number },
  polyline: { lat: number; lng: number }[]
): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) return getDistanceMeters(position, polyline[0]);

  let minDistance = Infinity;

  for (let i = 0; i < polyline.length - 1; i++) {
    const d = distanceToSegmentMeters(position, polyline[i], polyline[i + 1]);
    if (d < minDistance) minDistance = d;
  }

  return minDistance;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatETA(minutes: number): string {
  const m = Math.max(0, Math.ceil(minutes));
  if (m < 60) return `~${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `~${h} hr ${r > 0 ? `${r} min` : ""}`.trim();
}
