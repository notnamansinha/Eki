import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { requireAdmin } from "../middleware/requireAdmin";

const router = Router();
const CACHE_TTL_MS = 5 * 60 * 1000;
const PLACES_TIMEOUT_MS = 5_000;
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
  message: {
    error: "Place search rate limit exceeded. Wait a minute and retry.",
    code: "PLACE_SEARCH_RATE_LIMITED",
    phase: "validation",
  },
});

function placesError(
  res: Response,
  status: number,
  code: string,
  error: string,
): void {
  res.status(status).json({ error, code, phase: "places" });
}

router.get("/search", requireAdmin, placeSearchLimiter, async (req: Request, res: Response) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (query.length < 3 || query.length > 200) {
    res.status(400).json({
      error: "Search text must be between 3 and 200 characters.",
      code: "INVALID_PLACE_QUERY",
      phase: "validation",
    });
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
    placesError(
      res,
      503,
      "PLACES_NOT_CONFIGURED",
      "Place search is not configured on the server.",
    );
    return;
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), PLACES_TIMEOUT_MS);
  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 5 }),
      signal: timeoutController.signal,
    });
    if (!response.ok) {
      const upstreamBody = (await response.text()).slice(0, 1_000);
      console.warn(
        `[Places] Upstream request failed with HTTP ${response.status}: ${upstreamBody}`,
      );
      if (response.status === 429) {
        placesError(
          res,
          503,
          "PLACES_UPSTREAM_RATE_LIMITED",
          "Place search is busy. Wait briefly and retry.",
        );
      } else {
        placesError(
          res,
          502,
          "PLACES_UPSTREAM_FAILURE",
          "Place search service is unavailable.",
        );
      }
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
    if (timeoutController.signal.aborted) {
      placesError(
        res,
        504,
        "PLACES_TIMEOUT",
        "Place search took too long. Please retry.",
      );
    } else {
      placesError(
        res,
        502,
        "PLACES_UPSTREAM_FAILURE",
        "Place search service is unavailable.",
      );
    }
  } finally {
    // The deadline covers headers and response-body parsing.
    clearTimeout(timeoutId);
  }
});

export default router;
