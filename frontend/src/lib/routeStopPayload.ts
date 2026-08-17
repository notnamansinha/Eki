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

export interface RouteSavePayloadInput {
  mode: "create" | "edit";
  routeId: string;
  name: string;
  color: string;
  type: "up" | "down" | "circular";
  stops: RouteStopPayloadInput[];
}

export interface RouteSavePayload {
  routeId: string;
  body: {
    mode: "create" | "edit";
    name: string;
    color: string;
    type: "up" | "down" | "circular";
    stops: RouteStopPayload[];
  };
}

export type RouteSavePreparation =
  | { ok: true; value: RouteSavePayload }
  | { ok: false; error: string };

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_COLOR = /^#[0-9a-fA-F]{6}$/;
const ROUTE_TYPES = new Set(["up", "down", "circular"]);

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

function coordinate(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return Number.NaN;
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
    lat: coordinate(stop.lat),
    lng: coordinate(stop.lng),
  };
}

/** Validates and builds the exact request consumed by PUT /api/routes/:routeId. */
export function prepareRouteSavePayload(input: RouteSavePayloadInput): RouteSavePreparation {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Enter a display name for the route." };
  if (input.stops.length < 2) return { ok: false, error: "Add at least 2 stops before saving the route." };

  const routeId = input.routeId.trim() || routeIdFromName(name);
  if (!SAFE_ID.test(routeId)) {
    return { ok: false, error: "Route ID may contain only letters, numbers, hyphens, and underscores (max 128 characters)." };
  }
  if (name.length > 100) return { ok: false, error: "Route name must be 100 characters or fewer." };
  if (!SAFE_COLOR.test(input.color) || !ROUTE_TYPES.has(input.type)) {
    return { ok: false, error: "Choose a valid route colour and type." };
  }
  if (input.stops.length > 27) return { ok: false, error: "A route can have at most 27 stops." };

  const stops = input.stops.map(normalizeRouteStopPayload);
  const stopIds = new Set(stops.map((stop) => stop.id));
  if (stopIds.size !== stops.length) return { ok: false, error: "Each stop must be added only once." };

  const invalidStop = stops.some((stop) =>
    !SAFE_ID.test(stop.id) ||
    !stop.name ||
    stop.name.length > 100 ||
    !stop.shortName ||
    !Number.isFinite(stop.lat) || stop.lat < -90 || stop.lat > 90 ||
    !Number.isFinite(stop.lng) || stop.lng < -180 || stop.lng > 180
  );
  if (invalidStop) return { ok: false, error: "Each stop needs a name and valid map coordinates." };

  return {
    ok: true,
    value: {
      routeId,
      body: { mode: input.mode, name, color: input.color, type: input.type, stops },
    },
  };
}
