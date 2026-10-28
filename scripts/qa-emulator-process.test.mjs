import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import {
  EMULATOR_PORTS, parseJavaHome, resolveJavaHome, withJdkFirstOnPath, killProcessTree,
  isPortFree, parseNetstatListeners, assertEmulatorPortsFree, reapOrphanedEmulators,
} from './qa/emulator-process.mjs';

const JDK = 'C:\\Program Files\\Java\\jdk-27';
const STUB = 'C:\\Program Files\\Common Files\\Oracle\\Java\\javapath';

test('emulator port list covers every port the generated config binds', () => {
  const source = readFileSync(new URL('./rules-for-emulator.mjs', import.meta.url), 'utf8');
  const configured = [...source.matchAll(/port:\s*(\d+)/g)].map(match => Number(match[1]));
  assert(configured.length >= 5);
  for (const port of configured) assert(EMULATOR_PORTS.includes(port), `missing ${port}`);
  assert(EMULATOR_PORTS.includes(9150), 'Firestore websocket port');
});

test('parses java.home from -XshowSettings output', () => {
  const stderr = 'Property settings:\n    file.encoding = UTF-8\n    java.home = C:\\Program Files\\Java\\jdk-27\r\n    java.version = 27\n';
  assert.equal(parseJavaHome(stderr), JDK);
  assert.equal(parseJavaHome('openjdk version "27"'), null);
  assert.equal(parseJavaHome(undefined), null);
});

test('resolves the real JDK home from JAVA_HOME, else from the JVM, never the javapath stub', () => {
  const exists = file => file === `${JDK}\\bin\\java.exe`;
  let ran = 0;
  const run = () => { ran++; return { stderr: `    java.home = ${JDK}\n` }; };
  assert.equal(resolveJavaHome({ JAVA_HOME: JDK }, { run, exists }), JDK);
  assert.equal(ran, 0);
  assert.equal(resolveJavaHome({ JAVA_HOME: 'C:\\missing' }, { run, exists }), JDK);
  assert.equal(resolveJavaHome({}, { run: () => ({ stderr: 'no java here' }), exists }), null);
  assert.equal(resolveJavaHome({}, { run: () => ({ error: new Error('ENOENT') }), exists }), null);
});

test('puts the JDK bin first on PATH without duplicating the Windows Path key', () => {
  const env = withJdkFirstOnPath({ Path: `${STUB};C:\\Windows`, OTHER: '1' }, JDK);
  assert.deepEqual(Object.keys(env).filter(key => key.toUpperCase() === 'PATH'), ['Path']);
  assert.equal(env.Path, `${JDK}\\bin;${STUB};C:\\Windows`);
  assert.equal(env.OTHER, '1');
  const again = withJdkFirstOnPath(env, JDK);
  assert.equal(again.Path, env.Path, 'idempotent');
  assert.deepEqual(withJdkFirstOnPath({ PATH: 'x' }, null), { PATH: 'x' });
});

test('deadline kill terminates the whole Windows process tree, SIGTERM on POSIX', () => {
  const calls = [];
  const signals = [];
  const child = { pid: 4242, kill: signal => signals.push(signal) };
  killProcessTree(child, { platform: 'win32', exec: (file, args) => calls.push([file, ...args]) });
  assert.deepEqual(calls, [['taskkill', '/PID', '4242', '/T', '/F']]);
  assert.deepEqual(signals, []);
  killProcessTree(child, { platform: 'win32', exec: () => { throw new Error('not found'); } });
  assert.deepEqual(signals, ['SIGTERM']);
  killProcessTree(child, { platform: 'linux', exec: () => assert.fail('no taskkill on POSIX') });
  assert.deepEqual(signals, ['SIGTERM', 'SIGTERM']);
});

test('port probe detects a held port and fails fast naming port and owner', async () => {
  const server = net.createServer();
  await new Promise(resolve => server.listen({ port: 0, host: '127.0.0.1' }, resolve));
  const { port } = server.address();
  try {
    assert.equal(await isPortFree(port), false);
    const exec = (file) => file === 'netstat'
      ? `  TCP    127.0.0.1:${port}         0.0.0.0:0              LISTENING       10532\r\n`
      : '"java.exe","10532","Console","1","512,000 K"\r\n';
    await assert.rejects(assertEmulatorPortsFree({ ports: [port], platform: 'win32', exec }),
      new RegExp(`port\\(s\\) already in use: ${port} \\(pid 10532 java\\.exe\\)`));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  assert.equal(await isPortFree(port), true);
  await assertEmulatorPortsFree({ ports: [port], platform: 'win32', exec: () => assert.fail('no lookup when free') });
});

test('parses netstat listeners, ignoring established and UDP rows', () => {
  const output = [
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    127.0.0.1:8085         0.0.0.0:0              LISTENING       10532',
    '  TCP    [::1]:9005             [::]:0                 LISTENING       28728',
    '  TCP    127.0.0.1:50000        127.0.0.1:8085         ESTABLISHED     777',
    '  UDP    0.0.0.0:5353           *:*                                    999',
  ].join('\r\n');
  assert.deepEqual(parseNetstatListeners(output), [{ port: 8085, pid: 10532 }, { port: 9005, pid: 28728 }]);
});

test('reaps only orphaned java.exe emulators still listening on emulator ports', () => {
  const killed = [];
  const exec = (file, args) => {
    if (file === 'netstat') return [
      '  TCP    127.0.0.1:8085   0.0.0.0:0   LISTENING   10532',
      '  TCP    127.0.0.1:9005   0.0.0.0:0   LISTENING   28728',
      '  TCP    127.0.0.1:3000   0.0.0.0:0   LISTENING   5880',
      '  TCP    127.0.0.1:4405   0.0.0.0:0   LISTENING   6000',
    ].join('\r\n');
    if (file === 'tasklist') return args[1] === 'PID eq 6000' ? '"node.exe","6000"' : `"java.exe","${args[1].slice(7)}"`;
    if (file === 'taskkill') return killed.push(Number(args[1]));
    throw new Error(file);
  };
  assert.deepEqual(reapOrphanedEmulators({ platform: 'win32', exec }), [10532, 28728]);
  assert.deepEqual(killed, [10532, 28728]);
  assert.deepEqual(reapOrphanedEmulators({ platform: 'linux', exec: () => assert.fail() }), []);
});

test('launcher preflights ports, uses the real JDK and kills the tree on deadline', () => {
  const launcher = readFileSync(new URL('./run-rules-emulator.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(launcher, /child\.kill\(/);
  assert.match(launcher, /killProcessTree\(child\)/);
  assert.match(launcher, /await assertEmulatorPortsFree\(\)/);
  assert.match(launcher, /withJdkFirstOnPath\(/);
  assert.match(launcher, /reapOrphanedEmulators\(\)/);
  assert(launcher.indexOf('assertEmulatorPortsFree()') < launcher.indexOf('spawnNpx();'), 'preflight before spawn');
});
