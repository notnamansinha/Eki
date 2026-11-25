import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATED_CSP_HASHES, describeDirty, workingTreeState } from './qa/working-tree.mjs';

// GIT_DIR and friends (set inside a git hook, for example) would point every
// git call here, including workingTreeState's, at another repository.
for (const name of Object.keys(process.env)) if (name.startsWith('GIT_')) delete process.env[name];

const POLICY ="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; frame-src 'self'; object-src 'none'";
const CLEAN = { dirty: false, ignoredChanges: [] };
const IGNORED = { dirty: false, ignoredChanges: [GENERATED_CSP_HASHES] };

/**
 * A committed repository with firebase.json and the real CSP build scripts.
 * It lives below the workspace's ignored temp/ so the copied update-csp
 * resolves parse5 and @next/env through the root node_modules, as in
 * csp-rtdb-transport.test.mjs.
 */
async function repository(t) {
  const scratch = fileURLToPath(new URL('../temp/', import.meta.url));
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, 'eki-tree-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const file = name => path.join(root, name);
  const env = { ...process.env };
  for (const name of ['NEXT_PUBLIC_BACKEND_URL', 'NEXT_PUBLIC_FIREBASE_DATABASE_URL', 'NODE_ENV']) delete env[name];
  /** `npm run build`'s CSP step over the current frontend/out. */
  const build = (shell = {}) => execFileSync(process.execPath, [file('scripts/update-csp.mjs')],
    { cwd: root, env: { ...env, ...shell }, stdio: ['pipe', 'pipe', 'pipe'] });
  const page = (name, script) => writeFile(file(`frontend/out/${name}`), `<html><script>${script}</script></html>`);
  const config = async () => JSON.parse(await readFile(file('firebase.json'), 'utf8'));
  const writeConfig = async (value, text = `${JSON.stringify(value, null, 2)}\n`) => writeFile(file('firebase.json'), text);
  const policy = async () => (await config()).hosting.headers[0].headers[0].value;

  await mkdir(file('scripts'));
  await mkdir(file('frontend/out/admin'), { recursive: true });
  for (const name of ['update-csp.mjs', 'csp-backend-origin.mjs', 'rtdb-instance-config.mjs', 'inline-script-hashes.mjs', 'load-frontend-env.mjs'])
    await copyFile(new URL(name, import.meta.url), file(`scripts/${name}`));
  await writeFile(file('.gitignore'), 'frontend/out/\n');
  await writeFile(file('source.txt'), 'tracked source\n');
  await writeConfig({ hosting: { headers: [{ source: '**', headers: [
    { key: 'Content-Security-Policy', value: POLICY }, { key: 'X-Frame-Options', value: 'DENY' }] }] } });
  await page('index.html', 'first()');
  build();
  git('init', '--quiet');
  git('config', 'core.autocrlf', 'false');
  git('add', '--all');
  git('-c', 'user.name=QA fixture', '-c', 'user.email=qa@example.invalid', 'commit', '--quiet', '--message', 'fixture');
  // The next build exports different inline scripts, so update-csp rewrites the hashes.
  await page('index.html', 'second()');
  await page('admin/index.html', 'third()');
  return { root, git, file, build, page, config, writeConfig, policy };
}

test('a committed checkout is clean', async t => {
  const { root } = await repository(t);
  assert.deepEqual(workingTreeState(root), CLEAN);
});

test('a build that only rewrites the inline-script hashes leaves the tree clean and says so', async t => {
  const { root, git, build, policy } = await repository(t);
  const before = await policy();
  build();
  assert.notEqual(await policy(), before, 'the fixture build must change the hashes');
  assert.equal(git('status', '--porcelain'), ' M firebase.json\n');
  const state = workingTreeState(root);
  assert.deepEqual(state, IGNORED);
  assert.equal(describeDirty(state), 'false (ignored: firebase.json (generated CSP hashes))');
  assert.equal(describeDirty({ dirty: true, ignoredChanges: [] }), 'true');
});

test('a CRLF checkout counts the same as git counts it', async t => {
  const { root, git, file, build } = await repository(t);
  build();
  const crlf = (await readFile(file('firebase.json'), 'utf8')).replaceAll('\n', '\r\n');
  await writeFile(file('firebase.json'), crlf);
  // Git with autocrlf stores CRLF as LF, so the hashes are still the only change.
  git('config', 'core.autocrlf', 'true');
  assert.deepEqual(workingTreeState(root), IGNORED);
  // Without it, the line endings are a change of their own.
  git('config', 'core.autocrlf', 'false');
  assert.deepEqual(workingTreeState(root), { dirty: true, ignoredChanges: [] });
});

test('any other change to firebase.json is dirty', async t => {
  const { root, git, build, config, writeConfig } = await repository(t);
  const edits = {
    'another header value': value => { value.hosting.headers[0].headers[1].value = 'SAMEORIGIN'; },
    'a host added to script-src': value => {
      const csp = value.hosting.headers[0].headers[0];
      csp.value = csp.value.replace("script-src 'self'", "script-src 'self' https://cdn.example.test");
    },
    'a hash that no exported script has': value => {
      const csp = value.hosting.headers[0].headers[0];
      csp.value = csp.value.replace("script-src 'self'", `script-src 'self' 'sha256-${'A'.repeat(43)}='`);
    },
    'a hash removed': value => {
      const csp = value.hosting.headers[0].headers[0];
      csp.value = csp.value.replace(/ 'sha256-[^']+'/, '');
    },
    'a hash outside script-src': value => {
      const csp = value.hosting.headers[0].headers[0];
      csp.value = csp.value.replace("style-src 'self'", `style-src 'self' 'sha256-${'B'.repeat(43)}='`);
    },
  };
  for (const [name, edit] of Object.entries(edits)) {
    git('checkout', '--', 'firebase.json');
    build();
    const value = await config();
    edit(value);
    await writeConfig(value);
    assert.deepEqual(workingTreeState(root), { dirty: true, ignoredChanges: [] }, name);
  }
  git('checkout', '--', 'firebase.json');
  build();
  await writeConfig(null, `${JSON.stringify(await config(), null, 4)}\n`);
  assert.deepEqual(workingTreeState(root), { dirty: true, ignoredChanges: [] }, 'a formatting-only change');
});

test('local build values that update-csp writes outside the hashes stay dirty', async t => {
  const { root, build } = await repository(t);
  build({ NEXT_PUBLIC_BACKEND_URL: 'http://localhost:4000' });
  assert.deepEqual(workingTreeState(root), { dirty: true, ignoredChanges: [] });
});

test('hashes count as generated only while the current export produces them', async t => {
  const { root, file, build, page } = await repository(t);
  build();
  await page('index.html', 'changed after the build()');
  assert.deepEqual(workingTreeState(root), { dirty: true, ignoredChanges: [] }, 'an export changed after the build');
  await rm(file('frontend/out'), { recursive: true });
  assert.deepEqual(workingTreeState(root), { dirty: true, ignoredChanges: [] }, 'no export at all');
});

test('a file mode change is dirty, with or without new hashes', async t => {
  const { root, git, build } = await repository(t);
  // Commit firebase.json as executable; the working copy keeps its ordinary mode.
  git('update-index', '--chmod=+x', 'firebase.json');
  git('-c', 'user.name=QA fixture', '-c', 'user.email=qa@example.invalid', 'commit', '--quiet', '--message', 'mode');
  git('config', 'core.fileMode', 'true');
  assert.equal(git('status', '--porcelain'), ' M firebase.json\n', 'git lists the mode change');
  assert.deepEqual(workingTreeState(root), { dirty: true, ignoredChanges: [] }, 'mode change alone');
  build();
  assert.deepEqual(workingTreeState(root), { dirty: true, ignoredChanges: [] }, 'mode change and new hashes');
});

test('a staged hash change is dirty', async t => {
  const { root, git, build } = await repository(t);
  build();
  git('add', 'firebase.json');
  assert.deepEqual(workingTreeState(root), { dirty: true, ignoredChanges: [] });
});

test('other modified, deleted and untracked files stay dirty next to generated hashes', async t => {
  const { root, git, file, build } = await repository(t);
  build();
  await writeFile(file('untracked.txt'), 'new\n');
  assert.deepEqual(workingTreeState(root), { dirty: true, ignoredChanges: [GENERATED_CSP_HASHES] }, 'untracked file');
  await rm(file('untracked.txt'));
  await writeFile(file('source.txt'), 'edited source\n');
  assert.deepEqual(workingTreeState(root), { dirty: true, ignoredChanges: [GENERATED_CSP_HASHES] }, 'modified file');
  git('checkout', '--', 'source.txt');
  await rm(file('source.txt'));
  assert.deepEqual(workingTreeState(root), { dirty: true, ignoredChanges: [GENERATED_CSP_HASHES] }, 'deleted file');
  git('checkout', '--', 'source.txt');
  assert.deepEqual(workingTreeState(root), IGNORED);
});

test('every QA runner records the working tree through workingTreeState', async () => {
  const qa = fileURLToPath(new URL('./qa/', import.meta.url));
  const files = [...(await readdir(qa)).filter(name => name.endsWith('.mjs')).map(name => path.join(qa, name)),
    fileURLToPath(new URL('./run-rules-emulator.mjs', import.meta.url))];
  const callers = [];
  for (const name of files) {
    if (path.basename(name) === 'working-tree.mjs') continue;
    const source = await readFile(name, 'utf8');
    assert.doesNotMatch(source, /--porcelain/, `${path.basename(name)} must use workingTreeState, not its own git status`);
    if (/workingTreeState\(/.test(source)) callers.push(path.basename(name));
  }
  for (const name of ['acceptance-catalog.mjs', 'campaign.mjs', 'run-api.mjs', 'run-browser-tests.mjs', 'run-dast.mjs', 'run-emulator-tests.mjs',
    'run-gnss.mjs', 'run-mutation.mjs', 'run-native.mjs', 'run-reviewed-unit.mjs', 'run-soak.mjs', 'weekly-report.mjs', 'run-rules-emulator.mjs'])
    assert.ok(callers.includes(name), `${name} must record dirty through workingTreeState`);
});
