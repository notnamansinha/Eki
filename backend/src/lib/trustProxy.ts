/**
 * Express `trust proxy` configuration for pre-auth IP rate-limit keys.
 *
 * Without a trusted proxy, `req.ip` is the socket peer. Behind the local ngrok
 * agent used for bench/demo testing that peer is always loopback, so every
 * internet client would share one telemetry/browser bucket. `TRUST_PROXY`
 * names which hop may supply `X-Forwarded-For`:
 *
 * - unset: one hop in production (managed load balancer), off elsewhere
 * - `false`: never trust forwarding headers
 * - `loopback`: trust only a proxy on this machine (the ngrok agent); a
 *   remote caller's forged leading X-Forwarded-For entries are ignored
 * - `0`..`10`: trust exactly that many reverse-proxy hops
 *
 * `true`/`all` is deliberately unsupported: it would let any caller choose
 * its own rate-limit key.
 */
export type TrustProxySetting = false | "loopback" | number;

const MAX_TRUSTED_HOPS = 10;

export function readTrustProxySetting(env: NodeJS.ProcessEnv = process.env): TrustProxySetting {
  const raw = env.TRUST_PROXY?.trim();
  if (!raw) return env.NODE_ENV === "production" ? 1 : false;
  const normalized = raw.toLowerCase();
  if (normalized === "false") return false;
  if (normalized === "loopback") return "loopback";
  if (/^\d{1,2}$/.test(normalized) && Number(normalized) <= MAX_TRUSTED_HOPS) return Number(normalized);
  throw new RangeError(`TRUST_PROXY must be unset, false, loopback, or a hop count from 0 to ${MAX_TRUSTED_HOPS}.`);
}
