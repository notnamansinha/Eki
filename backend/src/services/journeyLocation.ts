/** Raw, last accepted GNSS fix, never a route-snapped/display coordinate. */
export function journeyLocation(data: Record<string, unknown>) {
  const raw = data.rawLocation && typeof data.rawLocation === "object"
    ? data.rawLocation as Record<string, unknown> : data;
  const sampledAt = raw.sampledAt ?? data.timestamp;
  if (typeof raw.lat !== "number" || !Number.isFinite(raw.lat) || Math.abs(raw.lat) > 90 ||
      typeof raw.lng !== "number" || !Number.isFinite(raw.lng) || Math.abs(raw.lng) > 180 ||
      typeof sampledAt !== "number" || !Number.isFinite(sampledAt) || sampledAt <= 0) return null;
  return { lat: raw.lat, lng: raw.lng, sampledAt,
    seq: Number.isSafeInteger(raw.seq ?? data.seq) ? Number(raw.seq ?? data.seq) : null,
    receivedAt: typeof data.backendReceivedAt === "number" ? data.backendReceivedAt : null };
}

/** Keep a delayed old lifecycle event from rolling the historical fix backward. */
export function newerJourneyLocation(data: Record<string, unknown>, existing: unknown) {
  const location = journeyLocation(data);
  const prior = existing && typeof existing === "object" ? existing as Record<string, unknown> : {};
  if (!location || location.sampledAt < Number(prior.sampledAt ?? 0)) return null;
  if (location.sampledAt === prior.sampledAt && location.seq !== null &&
      typeof prior.seq === "number" && location.seq < prior.seq) return null;
  return location;
}
