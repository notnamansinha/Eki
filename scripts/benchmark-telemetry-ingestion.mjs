import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function percentileSummary(values) {
  const ordered = values.filter((value) => finite(value) !== null).sort((a, b) => a - b);
  if (ordered.length === 0) {
    return { samples: 0, average: null, p50: null, p95: null, p99: null, maximum: null };
  }
  const percentile = (ratio) =>
    ordered[Math.min(ordered.length - 1, Math.ceil(ratio * ordered.length) - 1)];
  return {
    samples: ordered.length,
    average: Number((ordered.reduce((sum, value) => sum + value, 0) / ordered.length).toFixed(1)),
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    maximum: ordered.at(-1),
  };
}

export function parseArguments(argv) {
  const parsed = { seconds: 60, rate: 1, confirmStaging: false };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--confirm-staging") {
      parsed.confirmStaging = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`Missing value for ${name}.`);
    if (name === "--base-url") parsed.baseUrl = value;
    else if (name === "--devices") parsed.devices = value;
    else if (name === "--seconds") parsed.seconds = Number(value);
    else if (name === "--rate-per-device") parsed.rate = Number(value);
    else if (name === "--out") parsed.out = value;
    else throw new Error(`Unknown argument ${name}.`);
    index += 1;
  }
  if (!parsed.confirmStaging || !parsed.baseUrl || !parsed.devices || !parsed.out) {
    throw new Error(
      "Usage: --confirm-staging --base-url <url> --devices <private.json> " +
      "--out <report.json> [--seconds 60] [--rate-per-device 1]",
    );
  }
  if (!Number.isFinite(parsed.seconds) || parsed.seconds < 1 || parsed.seconds > 600) {
    throw new Error("--seconds must be between 1 and 600.");
  }
  if (!Number.isFinite(parsed.rate) || parsed.rate <= 0 || parsed.rate > 5) {
    throw new Error("--rate-per-device must be greater than 0 and at most 5.");
  }
  const baseUrl = new URL(parsed.baseUrl);
  const local = baseUrl.hostname === "localhost" || baseUrl.hostname === "127.0.0.1";
  if (
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash ||
    (baseUrl.pathname !== "/" && baseUrl.pathname !== "")
  ) {
    throw new Error("The benchmark URL must be an origin without credentials, path, query, or fragment.");
  }
  if (baseUrl.protocol !== "https:" && !(local && baseUrl.protocol === "http:")) {
    throw new Error("The benchmark URL must use HTTPS unless it is localhost.");
  }
  parsed.baseUrl = baseUrl.href.replace(/\/$/, "");
  return parsed;
}

function validateDevices(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) {
    throw new Error("Device input must contain 1-500 staging devices.");
  }
  return value.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error(`Device ${index + 1} is invalid.`);
    }
    const { deviceId, secret, lat, lng } = candidate;
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(deviceId) ||
      typeof secret !== "string" ||
      secret.length < 20 ||
      secret.length > 512
    ) {
      throw new Error(`Device ${index + 1} has invalid credentials.`);
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new Error(`Device ${index + 1} has invalid coordinates.`);
    }
    return { deviceId, secret, lat, lng };
  });
}

async function healthSnapshot(baseUrl) {
  const token = process.env.EKI_BENCHMARK_ADMIN_TOKEN;
  if (!token) return null;
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Health snapshot failed with HTTP ${response.status}.`);
  return response.json();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sendSample(baseUrl, device, seq) {
  const sampledAt = Date.now();
  const payload = {
    deviceSentAt: Date.now(),
    gpsHdop: 1,
    lat: device.lat,
    lng: device.lng,
    speed: 0,
    heading: 0,
    motionState: "stopped",
    seq,
    timestamp: sampledAt,
  };
  const startedAt = performance.now();
  try {
    const response = await fetch(
      `${baseUrl}/api/devices/${encodeURIComponent(device.deviceId)}/telemetry`,
      {
        method: "POST",
        headers: {
          Authorization: `Device ${device.secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      },
    );
    return {
      status: response.status,
      latencyMs: Number((performance.now() - startedAt).toFixed(1)),
    };
  } catch (error) {
    return {
      status: "transport-error",
      latencyMs: Number((performance.now() - startedAt).toFixed(1)),
      error: error instanceof Error ? error.name : "Error",
    };
  }
}

function counterDelta(before, after, name) {
  const first = finite(before?.telemetry?.rateLimit?.[name]);
  const last = finite(after?.telemetry?.rateLimit?.[name]);
  return first === null || last === null || last < first ? null : last - first;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const devices = validateDevices(JSON.parse(await readFile(options.devices, "utf8")));
  const before = await healthSnapshot(options.baseUrl);
  const intervalMs = 1_000 / options.rate;
  const durationMs = options.seconds * 1_000;
  const baseSequence = Math.floor(Date.now() / 1_000) % 4_000_000_000;
  const startedAt = performance.now();
  const responses = await Promise.all(devices.map(async (device, deviceIndex) => {
    const records = [];
    for (let iteration = 0; ; iteration += 1) {
      const target = startedAt + iteration * intervalMs;
      if (target >= startedAt + durationMs) break;
      const delay = target - performance.now();
      if (delay > 0) await sleep(delay);
      records.push(await sendSample(
        options.baseUrl,
        device,
        (baseSequence + deviceIndex * 10_000 + iteration) % 0xffff_ffff || 1,
      ));
    }
    return records;
  }));
  const after = await healthSnapshot(options.baseUrl);
  const flat = responses.flat();
  const statusCounts = {};
  for (const response of flat) {
    statusCounts[response.status] = (statusCounts[response.status] ?? 0) + 1;
  }
  const latencyByStatus = Object.fromEntries(
    Object.keys(statusCounts).map((status) => [
      status,
      percentileSummary(
        flat
          .filter((response) => String(response.status) === status)
          .map((response) => response.latencyMs),
      ),
    ]),
  );
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    target: new URL(options.baseUrl).origin,
    deviceCount: devices.length,
    seconds: options.seconds,
    ratePerDevice: options.rate,
    responseLatencyMs: percentileSummary(flat.map((response) => response.latencyMs)),
    latencyByStatus,
    statusCounts,
    rateLimitCounterDelta: {
      localDecisions: counterDelta(before, after, "localDecisions"),
      leaseHits: counterDelta(before, after, "leaseHits"),
      storeTransactions: counterDelta(before, after, "storeTransactions"),
      storeTransactionRetries: counterDelta(before, after, "storeTransactionRetries"),
    },
    healthBefore: before,
    healthAfter: after,
  };
  await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${options.out}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
