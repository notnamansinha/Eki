import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, copyFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execute = promisify(execFile);
const requiredSources = ['https://*.firebaseio.com/.lp', 'https://*.firebasedatabase.app/.lp'];

for (const database of [undefined, 'https://demo-transport-default-rtdb.firebaseio.com',
  'https://demo-transport-default-rtdb.asia-southeast1.firebasedatabase.app']) {
  test(`generated CSP permits RTDB JSONP and disconnect frames after shard redirect (${database ?? 'non-deployment build'})`, async () => {
    // Keep the isolated script tree below the workspace so its real parser
    // dependency resolves through the installed root node_modules on every OS.
    const scratch = fileURLToPath(new URL('../temp/', import.meta.url));
    await mkdir(scratch, { recursive: true });
    const root = await mkdtemp(path.join(scratch, 'eki-csp-'));
    assert.equal(path.dirname(root), path.resolve(scratch));
    try {
      await mkdir(path.join(root, 'scripts'));
      await mkdir(path.join(root, 'frontend/out'), { recursive: true });
      for (const file of ['update-csp.mjs', 'csp-backend-origin.mjs', 'rtdb-instance-config.mjs', 'inline-script-hashes.mjs', 'load-frontend-env.mjs'])
        await copyFile(new URL(file, import.meta.url), path.join(root, 'scripts', file));
      await writeFile(path.join(root, 'frontend/out/index.html'), '<html><script>window.fixture=true;</script></html>');
      const policy = "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self'; frame-src 'self'; object-src 'none';";
      await writeFile(path.join(root, 'firebase.json'), JSON.stringify({ hosting: { headers: [{ source: '**',
        headers: [{ key: 'Content-Security-Policy', value: policy }] }] } }));
      const env = { ...process.env };
      delete env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
      delete env.NEXT_PUBLIC_BACKEND_URL;
      if (database) env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = database;
      await execute(process.execPath, [path.join(root, 'scripts/update-csp.mjs')], { env });
      const configuration = JSON.parse(await readFile(path.join(root, 'firebase.json'), 'utf8'));
      const result = configuration.hosting.headers[0].headers[0].value;
      const directives = Object.fromEntries(result.split(';').filter(Boolean).map(value => {
        const [name, ...sources] = value.trim().split(/\s+/); return [name, sources];
      }));
      for (const name of ['script-src', 'frame-src']) {
        for (const source of requiredSources) assert(directives[name].includes(source), `${name} must permit ${source}`);
        assert(!directives[name].includes('*'));
        assert(!directives[name].includes('https://*.firebaseio.com'), 'new sources must retain the /.lp path restriction');
        assert(!directives[name].includes('https://*.firebasedatabase.app'));
        assert(!directives[name].includes("'unsafe-inline'"));
      }
      assert(directives['script-src'].some(value => value.startsWith("'sha256-")));
      assert.deepEqual(directives['object-src'], ["'none'"]);
      // JSONP gadgets: www.google.com reflects ?callback= with attacker text and
      // RTDB REST answers /<path>.json?callback=. Only the /.lp transport path
      // of the configured instance may load scripts.
      assert(!new Set(directives['script-src']).has('https://www.google.com'), 'script-src must not allow the www.google.com JSONP host');
      if (database) {
        assert(!directives['script-src'].includes(new URL(database).origin), 'the bare RTDB origin allows REST JSONP');
        assert(directives['script-src'].includes(`${new URL(database).origin}/.lp`));
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
