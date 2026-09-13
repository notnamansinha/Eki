/** Shared direction binding for shift, telemetry, and automatic return sessions. */
export function endpointSnapshotVersion(
  stops: readonly { id?: unknown; lat?: unknown; lng?: unknown }[],
): string | null {
  if (stops.length < 2) return null;
  const parts = stops.map((stop) => {
    if (typeof stop.id !== "string" || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return null;
    return `${stop.id}:${Number(stop.lat).toFixed(6)}:${Number(stop.lng).toFixed(6)}`;
  });
  return parts.every((part): part is string => part !== null) ? parts.join("|") : null;
}
