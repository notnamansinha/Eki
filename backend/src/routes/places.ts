import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { requireAdmin } from "../middleware/requireAdmin";

const router = Router();
const CACHE_TTL_MS = 5 * 60 * 1000;
const searchCache = new Map<string, { expiresAt: number; results: PlaceResult[] }>();

interface PlaceResult {
  name: string;
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

  const cacheKey = query.toLocaleLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.json({ results: cached.results });
    return;
  }

  const userAgent = process.env.NOMINATIM_USER_AGENT;
  if (!userAgent) {
    res.status(503).json({ error: "Place search is not configured on the server." });
    return;
  }

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "5");

    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": userAgent },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      res.status(502).json({ error: "Place search service is unavailable." });
      return;
    }

    const payload = await response.json() as unknown;
    const results = Array.isArray(payload)
      ? payload.flatMap((entry): PlaceResult[] => {
          if (!entry || typeof entry !== "object") return [];
          const value = entry as Record<string, unknown>;
          const name = typeof value.display_name === "string" ? value.display_name : "";
          const lat = Number(value.lat);
          const lng = Number(value.lon);
          return name && Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180
            ? [{ name, lat, lng }]
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
