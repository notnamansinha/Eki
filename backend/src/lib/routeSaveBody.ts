import express, { type RequestHandler } from "express";

/**
 * JSON body cap for `PUT /api/routes/:routeId` and its v2 alias.
 *
 * The save contract accepts 100 stops, each with a 128-character ID, a
 * 100-character name and a 32-character short name, plus route metadata.
 * With full-precision coordinates and multi-byte UTF-8 stop names (for
 * example Devanagari) that is roughly 62 KB, well beyond the general 16 KiB
 * API cap that rejected valid saves with 413 before authentication.
 */
export const ROUTE_SAVE_BODY_LIMIT_BYTES = 64 * 1024;

/**
 * Mount at `/api/routes/:routeId` (and the v2 alias) before the global JSON
 * parser. Only an exact PUT save gets the larger limit; body-parser skips the
 * later global parser once this one has consumed the request.
 */
export function createRouteSaveBodyParser(): RequestHandler {
  const parser = express.json({ limit: ROUTE_SAVE_BODY_LIMIT_BYTES, strict: true });
  return (req, res, next) => req.method === "PUT" && req.path === "/" ? parser(req, res, next) : next();
}
