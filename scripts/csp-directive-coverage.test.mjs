import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, copyFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execute = promisify(execFile);

async function runUpdateCsp(policy, { envFiles = {}, shell = { NEXT_PUBLIC_BACKEND_URL: 'https://api.example.test' } } = {}) {
  // Same isolated layout as csp-rtdb-transport.test.mjs: the copied script
  // resolves parse5 through the workspace's root node_modules.
  const scratch = fileURLToPath(new URL('../temp/', import.meta.url));
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, 'eki-csp-directives-'));
  try {
    await mkdir(path.join(root, 'scripts'));
    await mkdir(path.join(root, 'frontend/out'), { recursive: true });
    for (const file of ['update-csp.mjs', 'csp-backend-origin.mjs', 'rtdb-instance-config.mjs', 'inline-script-hashes.mjs', 'load-frontend-env.mjs'])
      await copyFile(new URL(file, import.meta.url), path.join(root, 'scripts', file));
    await writeFile(path.join(root, 'frontend/out/index.html'), '<html><script>window.fixture=true;</script></html>');
    for (const [name, contents] of Object.entries(envFiles)) await writeFile(path.join(root, 'frontend', name), contents);
    await writeFile(path.join(root, 'firebase.json'), JSON.stringify({ hosting: { headers: [{ source: '**',
      headers: [{ key: 'Content-Security-Policy', value: policy }] }] } }));
    const env = { ...process.env };
    for (const name of ['NEXT_PUBLIC_BACKEND_URL', 'NEXT_PUBLIC_FIREBASE_DATABASE_URL', 'NODE_ENV']) delete env[name];
    Object.assign(env, shell);
    let error = null;
    try { await execute(process.execPath, [path.join(root, 'scripts/update-csp.mjs')], { env }); }
    catch (caught) { error = caught; }
    const configuration = JSON.parse(await readFile(path.join(root, 'firebase.json'), 'utf8'));
    return { error, policy: configuration.hosting.headers[0].headers[0].value };
  } finally { await rm(root, { recursive: true, force: true }); }
}

for (const [label, policy] of [
  ['script-src as the final directive without a semicolon',
    "default-src 'self'; connect-src 'self'; img-src 'self'; frame-src 'self'; script-src 'self'"],
  ['a missing frame-src directive',
    "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none';"],
]) {
  test(`update-csp never reports success while leaving a managed directive unwritten (${label})`, async () => {
    const { error, policy: written } = await runUpdateCsp(policy);
    if (error) {
      assert.match(String(error.stderr), /Content-Security-Policy/);
      assert.equal(written, policy, 'a failed update must not rewrite firebase.json');
      return;
    }
    const directives = Object.fromEntries(written.split(';').map(value => value.trim()).filter(Boolean)
      .map(value => { const [name, ...sources] = value.split(/\s+/); return [name, sources]; }));
    assert.ok(directives['script-src']?.some(value => value.startsWith("'sha256-")), 'script-src must carry inline hashes');
    // Exact source-token equality, not a URL substring check.
    assert.ok(directives['connect-src']?.some(source => source === 'https://api.example.test'));
    assert.ok(directives['frame-src']?.some(source => source === 'https://accounts.google.com'));
  });
}

test('update-csp still rewrites a complete policy and keeps unmanaged directives', async () => {
  const { error, policy } = await runUpdateCsp(
    "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self'; frame-src 'self'; object-src 'none'");
  assert.equal(error, null);
  assert.match(policy, /script-src 'self' 'sha256-/);
  assert.match(policy, /connect-src [^;]*https:\/\/api\.example\.test/);
  assert.match(policy, /object-src 'none'$/);
});

test('update-csp reads backend and RTDB URLs from frontend env files exactly as next build compiles them', async () => {
  const { error, policy } = await runUpdateCsp(
    "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self'; frame-src 'self'; object-src 'none'",
    { shell: {}, envFiles: {
      '.env.local': 'NEXT_PUBLIC_BACKEND_URL=http://localhost:4000\n',
      '.env.production': 'NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://demo-env-default-rtdb.firebaseio.com\n',
    } });
  assert.equal(error, null);
  const directives = Object.fromEntries(policy.split(';').map(value => value.trim()).filter(Boolean)
    .map(value => { const [name, ...sources] = value.split(/\s+/); return [name, sources]; }));
  assert.ok(directives['connect-src'].includes('http://localhost:4000'), 'connect-src must allow the origin the bundle calls');
  assert.ok(directives['script-src'].includes('https://demo-env-default-rtdb.firebaseio.com/.lp'));
});
