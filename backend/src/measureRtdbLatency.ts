import { deleteApp } from "firebase-admin/app";
import { firebaseAdminApp, rtdb } from "./lib/firebaseAdmin";

function sampleCount(value: string | undefined): number {
  const parsed = Number(value ?? 30);
  if (!Number.isSafeInteger(parsed) || parsed < 10 || parsed > 500) {
    throw new Error("RTDB_LATENCY_SAMPLES must be an integer from 10 to 500.");
  }
  return parsed;
}

function percentile(ordered: readonly number[], quantile: number): number {
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * quantile) - 1)];
}

async function main(): Promise<void> {
  const count = sampleCount(process.env.RTDB_LATENCY_SAMPLES);
  const samples: number[] = [];

  // The first read establishes credentials/connection and is intentionally
  // excluded. Reads are bounded to one child and no database values are logged.
  await rtdb.ref("activeBuses").limitToFirst(1).get();
  for (let index = 0; index < count; index += 1) {
    const startedAt = performance.now();
    await rtdb.ref("activeBuses").limitToFirst(1).get();
    samples.push(performance.now() - startedAt);
  }
  samples.sort((left, right) => left - right);
  const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  console.log(JSON.stringify({
    samples: samples.length,
    averageMs: Number(average.toFixed(1)),
    p50Ms: Number(percentile(samples, 0.5).toFixed(1)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(1)),
    p99Ms: Number(percentile(samples, 0.99).toFixed(1)),
    minMs: Number(samples[0].toFixed(1)),
    maxMs: Number(samples[samples.length - 1].toFixed(1)),
  }));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "RTDB latency probe failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await deleteApp(firebaseAdminApp);
  });
