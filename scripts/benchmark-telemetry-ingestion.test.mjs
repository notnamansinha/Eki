import assert from "node:assert/strict";
import test from "node:test";
import {
  parseArguments,
  percentileSummary,
} from "./benchmark-telemetry-ingestion.mjs";

test("summarizes acknowledgement latency with nearest-rank percentiles", () => {
  assert.deepEqual(percentileSummary([100, 10, 30, 20, 40]), {
    samples: 5,
    average: 40,
    p50: 30,
    p95: 100,
    p99: 100,
    maximum: 100,
  });
});

test("requires an explicit staging confirmation and a safe backend origin", () => {
  assert.throws(
    () => parseArguments([
      "--base-url", "https://staging.example.edu",
      "--devices", "private.json",
      "--out", "report.json",
    ]),
    /Usage/,
  );
  assert.throws(
    () => parseArguments([
      "--confirm-staging",
      "--base-url", "https://user:secret@staging.example.edu/api?x=1",
      "--devices", "private.json",
      "--out", "report.json",
    ]),
    /origin without credentials/,
  );
  assert.equal(parseArguments([
    "--confirm-staging",
    "--base-url", "http://127.0.0.1:8080",
    "--devices", "private.json",
    "--out", "report.json",
  ]).baseUrl, "http://127.0.0.1:8080");
});
