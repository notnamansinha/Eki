import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repositoryRoot, buildCatalog } from './acceptance-catalog.mjs';
import { testMap } from '../../qa/test-map.mjs';

// Scope this first budget to authority, current position and session integrity.
// This is a changed-source review gate, not an assertion-strength metric.
export function criticalSource(path) {
  return /^(firestore\.rules|database\.rules\.json)$/.test(path) ||
    /^(backend|frontend)\/src\/.*(auth|appcheck|boarding|telemetry|tripstate|workerfence|livebus|ride|session|privacy|retention)/i.test(path)
      && !/\.(test|spec)\./.test(path);
}

export function checkCoverageBudget(changedPaths, mappings) {
  const changed = new Set(changedPaths);
  const failures = changedPaths.filter(criticalSource).filter(path => !mappings.some(mapping =>
    mapping.sourcePaths?.includes(path) && mapping.tests.some(test => changed.has(test.path))));
  if (failures.length) throw new Error(`Critical source changes need an exact case/test mapping and corresponding test change: ${failures.join(', ')}`);
  return { changedCriticalFiles: changedPaths.filter(criticalSource), status: 'PASS',
    scope: 'Changed critical source requires reviewed mapping and a test-file change; semantic strength remains a review responsibility.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length) throw new Error('Set EKI_QA_BASE_SHA; command arguments are unsupported');
  const base = process.env.EKI_QA_BASE_SHA;
  if (!base || !/^[a-f0-9]{40}$/.test(base)) throw new Error('EKI_QA_BASE_SHA must be an explicit full commit SHA');
  execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], { cwd: repositoryRoot });
  const changes = execFileSync('git', ['diff', '--name-only', '-z', base, 'HEAD'],
    { cwd: repositoryRoot, encoding: 'utf8' }).split('\0').filter(Boolean);
  await buildCatalog(); // validates all mapped test paths/titles/semantics before the gate
  console.log(JSON.stringify({ baseCommit: base, ...checkCoverageBudget(changes, testMap) }));
}
