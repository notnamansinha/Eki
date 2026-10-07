import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import * as optimized from '../backend/dist/services/routeMatching.js';
import * as baseline from '../backend/dist/test-support/routeMatchingBaseline.js';
import { haversineMeters } from '../backend/dist/lib/geo.js';
const repetitions = Number(process.env.R19_BENCH_SAMPLES || 300);
const cumulative = path => { const values = [0]; for (let i=1;i<path.length;i++) values.push(values[i-1]+haversineMeters(path[i-1],path[i])); return values; };
const dense = Array.from({length: 10001}, (_, i) => ({lat: 23, lng: 72 + i * .00001}));
const sparse = Array.from({length: 1001}, (_, i) => ({lat: 23, lng: 72 + i * .0001}));
const loop = Array.from({length: 1001}, (_, i) => ({lat: 23 + .0005 * Math.sin(i/1000*Math.PI*2), lng: 72 + .0005 * Math.cos(i/1000*Math.PI*2)}));
const fixture = (name, path, index, radius = 80, prior = true) => {
  const distances = cumulative(path);
  return {name, path, args: [path[index], path, undefined, prior ? {segmentIndex:index, alongRouteDistanceM: distances[index]} : null, 25, radius]};
};
const cases = [fixture('dense-continuity', dense, 5000), fixture('sparse-continuity', sparse, 500), fixture('loop-continuity', loop, 500),
  fixture('no-prior-warm-geometry', dense, 5000, undefined, false), fixture('reacquisition-no-bound', dense, 5000, Infinity),
  {name:'long-single-segment', path:[dense[0], dense.at(-1)], args:[dense[5000], [dense[0],dense.at(-1)], undefined,{segmentIndex:0,alongRouteDistanceM:cumulative(dense)[5000]},25,80]}];
const percentile = (values, fraction) => values.slice().sort((a,b)=>a-b)[Math.floor((values.length-1)*fraction)];
if (!process.env.R19_BENCH_CASE) {
  // Separate processes keep one geometry's JIT specialization from biasing another.
  const results = cases.flatMap(item => JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
    encoding: 'utf8', env: {...process.env, R19_BENCH_CASE:item.name},
  })).results);
  console.log(JSON.stringify({node:process.version, results}, null, 2));
} else {
const results = [];
for (const item of cases.filter(item => !process.env.R19_BENCH_CASE || item.name === process.env.R19_BENCH_CASE)) {
  assert.deepEqual(optimized.matchRoutePosition(...item.args), baseline.matchRoutePosition(...item.args), item.name);
  const row = {case:item.name, segments:item.path.length-1, samples:repetitions};
  const implementations = [['baseline',baseline],['optimized',optimized]];
  for (const [,implementation] of implementations) for(let i=0;i<300;i++) implementation.matchRoutePosition(...item.args);
  const before = optimized.getRouteMatchingWork();
  const times = {baseline:[], optimized:[]};
  // Alternate order so startup, temperature and CPU drift affect both sides.
  for (let i=0;i<repetitions;i++) for(const [label,implementation] of i%2 ? implementations.slice().reverse() : implementations) {
    const at=performance.now(); implementation.matchRoutePosition(...item.args); times[label].push(performance.now()-at);
  }
  const after = optimized.getRouteMatchingWork();
  for (const [label] of implementations) row[label] = {
    p50Ms: +percentile(times[label],.5).toFixed(4), p95Ms:+percentile(times[label],.95).toFixed(4),
    projectedSegmentsPerFix: label === 'optimized' ? (after.segmentProjections-before.segmentProjections)/repetitions : item.path.length-1,
  };
  results.push(row);
}
console.log(JSON.stringify({node:process.version, results}, null, 2));

}
