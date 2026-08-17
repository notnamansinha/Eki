import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { requireAdmin } from "../middleware/requireAdmin";

const router = Router();
const CACHE_TTL_MS = 5 * 60 * 1000;
const searchCache = new Map<string, { expiresAt: number; results: PlaceResult[] }>();

interface PlaceResult {
  name: string;
  address?: string;
  lat: number;
  lng: number;
}

const placeSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Place search rate limit exceeded." },
});

router.get("/search", placeSearchLimiter, requireAdmin, async (req: Request, res: Response) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (query.length < 3 || query.length > 200) {
    res.status(400).json({ error: "Search text must be between 3 and 200 characters." });
    return;
  }

  const cacheKey = query.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.json({ results: cached.results });
    return;
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Place search is not configured on the server." });
    return;
  }

  try {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 5_000);
    let response: globalThis.Response;
    try {
      response = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
        },
        body: JSON.stringify({ textQuery: query, maxResultCount: 5 }),
        signal: timeoutController.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) {
      const upstreamBody = (await response.text()).slice(0, 1_000);
      console.warn(
        `[Places] Upstream request failed with HTTP ${response.status}: ${upstreamBody}`,
      );
      res.status(502).json({ error: "Place search service is unavailable." });
      return;
    }

    const payload = await response.json() as { places?: unknown };
    const results = Array.isArray(payload.places)
      ? payload.places.flatMap((entry): PlaceResult[] => {
          if (!entry || typeof entry !== "object") return [];
          const value = entry as Record<string, unknown>;
          const displayName = value.displayName as { text?: unknown } | undefined;
          const location = value.location as { latitude?: unknown; longitude?: unknown } | undefined;
          const title = typeof displayName?.text === "string" ? displayName.text : "";
          const address = typeof value.formattedAddress === "string" ? value.formattedAddress : "";
          // A stop name is persisted with a strict 100-character limit. Keep
          // the concise Google display name as the value saved to the route;
          // return the address separately so admins can still distinguish
          // similarly named search results without creating invalid stops.
          const name = title.trim().slice(0, 100);
          const lat = Number(location?.latitude);
          const lng = Number(location?.longitude);
          return name && Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180
            ? [{ name, ...(address ? { address } : {}), lat, lng }]
            : [];
        })
      : [];

    searchCache.set(cacheKey, { results, expiresAt: Date.now() + CACHE_TTL_MS });
    if (searchCache.size > 100) {
      const oldestKey = searchCache.keys().next().value;
      if (oldestKey) searchCache.delete(oldestKey);
    }
    res.json({ results });
  } catch (error) {
    console.warn("Place search failed:", error);
    res.status(502).json({ error: "Place search service is unavailable." });
  }
});

export default router;
