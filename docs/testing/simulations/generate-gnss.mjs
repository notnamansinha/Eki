/** Future QA planning helper. No network calls unless --send is explicit. */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const profiles = new Set(['moving', 'reverse', 'stationary', 'jitter', 'stop-start',
  'duplicate', 'reorder', 'burst', 'outage45', 'outage120', 'outage301', 'teleport',
  'poor-hdop', 'uncertain', 'missing-hdop', 'invalid-speed', 'invalid-heading',
  'stale', 'future', 'wrong-fields']);
const args = Object.create(null);
const booleanFlags = new Set(['send', 'confirm-disposable', 'help']);
const valueFlags = new Set(['profile', 'count', 'seed', 'out', 'base', 'device', 'path']);
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  if (!process.argv[i].startsWith('--') || (!booleanFlags.has(key) && !valueFlags.has(key))) {
    throw new Error(`Unknown argument: ${process.argv[i]}`);
  }
  if (booleanFlags.has(key)) args[key] = true;
  else {
    const value = process.argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    args[key] = value;
  }
}
if (args.help) {
  console.log('Offline: --profile NAME --count N --seed N --path coordinates.json --out plan.jsonl');
  console.log('Opt-in local replay: --send --base http://127.0.0.1:3001 --device ID --confirm-disposable');
  console.log('Replay secret comes only from EKI_QA_DEVICE_SECRET. Profiles:', [...profiles].join(', '));
  process.exit(0);
}
const profile = args.profile || 'moving';
const count = Number(args.count || 240);
let rng = Number(args.seed || 42);
if (!profiles.has(profile)) throw new Error(`Unknown profile: ${profile}`);
if (!Number.isSafeInteger(count) || count < 3 || count > 3600) throw new Error('count must be 3..3600');
if (!Number.isSafeInteger(rng) || rng < 0 || rng > 0xffffffff) throw new Error('seed must be uint32');
if (profile.startsWith('outage') && count < 24 + Number(profile.slice(6))) {
  throw new Error('Outage profile needs enough samples for the gap plus at least three recovery candidates');
}
if (['teleport', 'invalid-speed', 'invalid-heading', 'wrong-fields'].includes(profile) && count < 12) {
  throw new Error('This profile requires at least 12 samples to include its disturbance');
}
const random = () => { rng = (1664525 * rng + 1013904223) >>> 0; return rng / 4294967296; };
const radians = n => n * Math.PI / 180;
const distance = (a, b) => {
  const dl = radians(b.lat - a.lat), dn = radians(b.lng - a.lng);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dn / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(Math.max(0, h)), Math.sqrt(Math.max(0, 1 - h)));
};
const bearing = (a, b) => {
  const dn = radians(b.lng - a.lng);
  return (Math.atan2(Math.sin(dn) * Math.cos(radians(b.lat)),
    Math.cos(radians(a.lat)) * Math.sin(radians(b.lat)) -
    Math.sin(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.cos(dn)) * 180 / Math.PI + 360) % 360;
};
let points = args.path ? JSON.parse(fs.readFileSync(args.path, 'utf8')) : [{ lat: 23, lng: 72 }, { lat: 23.05, lng: 72.05 }];
if (!Array.isArray(points) || points.length < 2 || points.length > 100000 || points.some(p =>
  !p || !Number.isFinite(p.lat) || Math.abs(p.lat) > 90 || !Number.isFinite(p.lng) || Math.abs(p.lng) > 180)) {
  throw new Error('path must contain 2..100000 finite lat/lng coordinate objects');
}
if (profile === 'reverse') {
  if (args.path) throw new Error('For real reverse roads, supply reverse geometry with --profile moving. Do not reverse a real path.');
  points = [...points].reverse();
}
const segments = points.slice(1).map((p, i) => distance(points[i], p));
const total = segments.reduce((n, d) => n + d, 0);
if (!Number.isFinite(total) || total <= 0) throw new Error('path must have positive length');
function at(meters) {
  let remaining = Math.min(total, Math.max(0, meters));
  for (let i = 0; i < segments.length; i++) {
    if (remaining <= segments[i] && segments[i] > 0) {
      const fraction = remaining / segments[i];
      // Linear segment interpolation is appropriate for these local test paths.
      return { lat: points[i].lat + (points[i + 1].lat - points[i].lat) * fraction,
        lng: points[i].lng + (points[i + 1].lng - points[i].lng) * fraction,
        heading: bearing(points[i], points[i + 1]) };
    }
    remaining -= segments[i];
  }
  return { ...points.at(-1), heading: bearing(points.at(-2), points.at(-1)) };
}
const plan = [];
let traveled = 0;
for (let i = 0; i < count; i++) {
  const stopped = ['stationary', 'jitter'].includes(profile) || (profile === 'stop-start' && Math.floor(i / 20) % 2 === 1);
  if (i > 0 && !stopped) traveled += 30 / 3.6;
  const position = at(traveled);
  const speed = stopped || traveled >= total ? 0 : 30;
  let sampleOffsetMs = i * 1000;
  let scheduleOffsetMs = i * 1000;
  if (profile === 'burst') scheduleOffsetMs = (count - 1) * 1000 + i * 80;
  if (profile === 'reorder' && i % 10 === 5) scheduleOffsetMs += 2500;
  if (profile.startsWith('outage')) {
    const gap = Number(profile.slice(6));
    if (i >= 20 && i < 20 + gap) continue; // fresh samples resume after outage
  }
  if (profile === 'stale') sampleOffsetMs -= 61000;
  if (profile === 'future') sampleOffsetMs += 11000;
  const body = { lat: position.lat, lng: position.lng, speed, heading: position.heading,
    gpsHdop: 0.9, motionState: speed > 0 ? 'moving' : 'stopped', seq: i + 1 };
  if (profile === 'jitter') {
    body.lat += (random() - 0.5) * 12 / 111320;
    body.lng += (random() - 0.5) * 12 / (111320 * Math.cos(radians(body.lat)));
  }
  if (profile === 'teleport' && i === 10) { body.lat += 0.1; body.lng += 0.1; }
  if (profile === 'poor-hdop' && i >= 20 && i < 40) body.gpsHdop = 8;
  if (profile === 'uncertain' && i >= 20 && i < 40) body.motionState = 'uncertain';
  if (profile === 'missing-hdop') delete body.gpsHdop;
  if (profile === 'invalid-speed' && i === 10) body.speed = 201;
  if (profile === 'invalid-heading' && i === 10) body.heading = 360;
  if (profile === 'wrong-fields' && i === 10) body.busId = 'forged-bus';
  const event = { profile, seed: Number(args.seed || 42), scheduleOffsetMs, sampleOffsetMs,
    sentOffsetMs: Math.max(sampleOffsetMs, scheduleOffsetMs), body };
  plan.push(event);
  if (profile === 'duplicate' && i % 10 === 5) plan.push({ ...event, scheduleOffsetMs: scheduleOffsetMs + 250, body: { ...body } });
}
plan.sort((a, b) => a.scheduleOffsetMs - b.scheduleOffsetMs);
if (!args.send) {
  const text = plan.map(event => JSON.stringify(event)).join('\n') + '\n';
  if (args.out) { fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true }); fs.writeFileSync(args.out, text); }
  else process.stdout.write(text);
  process.exit(0);
}
if (!args['confirm-disposable']) throw new Error('Local replay requires --confirm-disposable');
if (args.out) throw new Error('--out is for offline plans; redirect redacted replay stdout separately');
const base = new URL(args.base || 'http://127.0.0.1:3001');
if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
  || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
  throw new Error('Replay base must be a loopback HTTP(S) origin with no credentials/path/query');
}
if (!/^[A-Za-z0-9_-]{1,128}$/.test(args.device || '')) throw new Error('Supply --device with a safe isolated registry ID');
const secret = process.env.EKI_QA_DEVICE_SECRET;
if (!secret || /[\r\n]/.test(secret)) throw new Error('Set EKI_QA_DEVICE_SECRET privately in this terminal');
const endpoint = new URL(`/api/devices/${encodeURIComponent(args.device)}/telemetry`, base);
const epochStart = Date.now();
const monotonicStart = performance.now();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const materialized = new Map();
for (const event of plan) {
  const wait = event.scheduleOffsetMs - (performance.now() - monotonicStart);
  if (wait > 0) await sleep(wait);
  // Cache each sequence so the intentional duplicate profile replays an exact
  // request, including original timestamps. Fresh attempts use actual send time.
  let payload = materialized.get(event.body.seq);
  if (!payload) {
    payload = { ...event.body, timestamp: epochStart + event.sampleOffsetMs,
      deviceSentAt: Math.max(epochStart + event.sampleOffsetMs, Date.now()) };
    materialized.set(event.body.seq, payload);
  }
  const serialized = JSON.stringify(payload);
  const started = performance.now();
  try {
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Device ${secret}` },
      body: serialized, signal: AbortSignal.timeout(5000) });
    // Never print arbitrary server bodies: a reflected credential must not leak.
    const text = await response.text();
    let ack = null;
    try {
      const parsed = JSON.parse(text);
      ack = { accepted: parsed.accepted === true, duplicate: parsed.duplicate === true };
    } catch { /* malformed acknowledgement remains null */ }
    console.log(JSON.stringify({ seq: payload.seq, sampleOffsetMs: event.sampleOffsetMs,
      status: response.status, ack, elapsedMs: performance.now() - started,
      scheduleLagMs: started - monotonicStart - event.scheduleOffsetMs,
      bytes: Buffer.byteLength(serialized), serverReceivedAt: response.headers.get('x-eki-server-received-at'),
      serverRespondedAt: response.headers.get('x-eki-server-responded-at') }));
  } catch (error) {
    console.log(JSON.stringify({ seq: payload.seq, error: error.name,
      elapsedMs: performance.now() - started, outcome: 'unknown-no-auto-retry' }));
  }
}
