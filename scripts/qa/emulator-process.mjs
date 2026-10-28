import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

/**
 * Process hygiene for the local Firebase emulator runner
 * (scripts/run-rules-emulator.mjs).
 *
 * On Windows with the default Oracle JDK install, `java` on PATH is the
 * javapath launcher stub, which starts the real JDK java.exe as a child.
 * firebase-tools spawns the Firestore/Database emulators detached and stops
 * them with kill('SIGINT'), which on Windows only terminates the stub — the
 * real JVM keeps ports 8085/9005 open and every later run fails with
 * "port taken". These helpers put the real JDK first on PATH, kill the whole
 * process tree on deadline, refuse to start when an emulator port is already
 * held, and reap emulator JVMs left listening on our ports after exit.
 */

/** Every port the generated emulator config (rules-for-emulator.mjs) binds, plus the Firestore websocket. */
export const EMULATOR_PORTS = Object.freeze([8085, 9005, 9095, 4405, 4505, 9150]);

/** Extracts `java.home` from `java -XshowSettings:properties -version` stderr. */
export function parseJavaHome(output) {
  const match = /^\s*java\.home\s*=\s*(.+?)\s*$/m.exec(String(output ?? ''));
  return match ? match[1] : null;
}

/** Finds the real JDK home on Windows: JAVA_HOME when valid, else java.home reported by the JVM. */
export function resolveJavaHome(env, { run = spawnSync, exists = existsSync } = {}) {
  const hasJava = (home) => Boolean(home) && exists(path.win32.join(home, 'bin', 'java.exe'));
  if (hasJava(env.JAVA_HOME)) return env.JAVA_HOME;
  const result = run('java', ['-XshowSettings:properties', '-version'], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
  const home = parseJavaHome(`${result?.stderr ?? ''}\n${result?.stdout ?? ''}`);
  return hasJava(home) ? home : null;
}

/** Returns a copy of env with `<javaHome>\bin` first on PATH, preserving the existing key's casing (Path vs PATH). */
export function withJdkFirstOnPath(env, javaHome) {
  if (!javaHome) return { ...env };
  const key = Object.keys(env).find(name => name.toUpperCase() === 'PATH') ?? 'PATH';
  const bin = path.win32.join(javaHome, 'bin');
  const rest = (env[key] ?? '').split(';').filter(entry => entry && entry.toLowerCase() !== bin.toLowerCase());
  return { ...env, [key]: [bin, ...rest].join(';') };
}

/** Terminates the child and all of its descendants. Windows needs taskkill /T; POSIX keeps SIGTERM semantics. */
export function killProcessTree(child, { platform = process.platform, exec = execFileSync } = {}) {
  if (!child?.pid) return;
  if (platform !== 'win32') { child.kill('SIGTERM'); return; }
  try {
    exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } catch {
    child.kill('SIGTERM'); // Tree already gone or taskkill unavailable: fall back to the direct child.
  }
}

/** Resolves true when 127.0.0.1:port can be bound (i.e. nothing is listening there). */
export function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen({ port, host, exclusive: true });
  });
}

/** Parses `netstat -ano` output into listening sockets `{ port, pid }`. */
export function parseNetstatListeners(output) {
  const listeners = [];
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const match = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
    if (match) listeners.push({ port: Number(match[2]), pid: Number(match[3]) });
  }
  return listeners;
}

function windowsListeners(exec) {
  try {
    return parseNetstatListeners(exec('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true }));
  } catch {
    return [];
  }
}

function windowsImageName(pid, exec) {
  try {
    const row = exec('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
    return /^"([^"]+)"/m.exec(row)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Fails fast when any emulator port is already bound, naming the port and
 * (on Windows) the owning PID/image, instead of letting firebase-tools fail
 * later with "port taken".
 */
export async function assertEmulatorPortsFree({ ports = EMULATOR_PORTS, platform = process.platform, exec = execFileSync, probe = isPortFree } = {}) {
  const busy = [];
  for (const port of ports) if (!(await probe(port))) busy.push(port);
  if (!busy.length) return;
  const listeners = platform === 'win32' ? windowsListeners(exec) : [];
  const owners = busy.map((port) => {
    const pid = listeners.find(entry => entry.port === port)?.pid;
    if (!pid) return `${port}`;
    const image = windowsImageName(pid, exec);
    return `${port} (pid ${pid}${image ? ` ${image}` : ''})`;
  });
  throw new Error(`Emulator port(s) already in use: ${owners.join(', ')}. ` +
    'A previous emulator run is probably still running; stop it (Windows: taskkill /PID <pid> /T /F) and retry.');
}

/**
 * Windows only: after the runner exits, terminates java.exe processes still
 * listening on emulator ports. The preflight guarantees those ports were free
 * at start, so any JVM holding them now is an emulator orphaned by this run.
 * Returns the PIDs it terminated.
 */
export function reapOrphanedEmulators({ ports = EMULATOR_PORTS, platform = process.platform, exec = execFileSync } = {}) {
  if (platform !== 'win32') return [];
  const pids = [...new Set(windowsListeners(exec).filter(entry => ports.includes(entry.port)).map(entry => entry.pid))];
  const reaped = [];
  for (const pid of pids) {
    if (!pid || windowsImageName(pid, exec)?.toLowerCase() !== 'java.exe') continue;
    try {
      exec('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      reaped.push(pid);
    } catch {
      // Already exited between netstat and taskkill.
    }
  }
  return reaped;
}
