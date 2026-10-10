export interface LatLng {
  lat: number;
  lng: number;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  if (![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite) ||
      Math.abs(a.lat) > 90 || Math.abs(b.lat) > 90 ||
      Math.abs(a.lng) > 180 || Math.abs(b.lng) > 180) return Number.POSITIVE_INFINITY;
  const earthRadiusM = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const haversine =
    sinLat * sinLat +
    Math.cos(toRadians(a.lat)) *
      Math.cos(toRadians(b.lat)) *
      sinLng *
      sinLng;
  const boundedHaversine = Math.min(1, Math.max(0, haversine));
  return (
    earthRadiusM *
    2 *
    Math.atan2(Math.sqrt(boundedHaversine), Math.sqrt(1 - boundedHaversine))
  );
}
