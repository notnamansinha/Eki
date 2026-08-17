export interface RouteStopPayloadInput {
  id: string;
  name: string;
  lat: unknown;
  lng: unknown;
}

export interface RouteStopPayload {
  id: string;
  name: string;
  shortName: string;
  lat: number;
  lng: number;
}

export function stopShortName(name: string): string {
  return name.split(",", 1)[0].trim().slice(0, 32);
}

export function routeIdFromName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return slug ? `route-${slug}` : `route-${Date.now()}`;
}

/** Builds the exact stop shape accepted by PUT /api/routes/:routeId. */
export function normalizeRouteStopPayload(stop: RouteStopPayloadInput): RouteStopPayload {
  // An editor opened before a place-search update can still contain the old
  // verbose "name + address" label. The API contract allows 100 characters.
  const name = stop.name.trim().slice(0, 100);
  return {
    id: stop.id.trim(),
    name,
    shortName: stopShortName(name),
    lat: Number(stop.lat),
    lng: Number(stop.lng),
  };
}
