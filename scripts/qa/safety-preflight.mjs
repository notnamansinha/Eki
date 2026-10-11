import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectKeys = ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT', 'FIREBASE_PROJECT_ID', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID'];
const hosts = { FIRESTORE_EMULATOR_HOST: 8085, FIREBASE_DATABASE_EMULATOR_HOST: 9005, FIREBASE_AUTH_EMULATOR_HOST: 9095 };
const urlKeys = ['FIREBASE_DATABASE_URL', 'NEXT_PUBLIC_FIREBASE_DATABASE_URL', 'EKI_QA_BASE_URL',
  'NEXT_PUBLIC_BACKEND_URL', 'GOOGLE_MAPS_ROUTES_URL', 'GOOGLE_MAPS_PLACES_URL', 'OTEL_EXPORTER_OTLP_ENDPOINT'];
const forbiddenKeys = ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_SERVICE_ACCOUNT', 'FIREBASE_CONFIG',
  'GOOGLE_MAPS_API_KEY', 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'GOOGLE_ROUTES_API_KEY',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'AZURE_OPENAI_API_KEY'];
const loopback = new Set(['127.0.0.1', '[::1]']);

export function assertLoopbackUrl(value, name = 'target') {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name}: invalid URL`); }
  // Check the literal authority as well: WHATWG normalizes integer/hex/short IPv4.
  const authority = /^http:\/\/([^/?#]+)/.exec(value)?.[1];
  if (url.protocol !== 'http:' || !loopback.has(url.hostname) || url.username || url.password ||
    url.search || url.hash || !/^(127\.0\.0\.1|\[::1\]):[1-9]\d{0,4}$/.test(authority ?? '') ||
    !url.port || Number(url.port) > 65535) throw new Error(`${name}: explicit loopback HTTP port required`);
  return url;
}

export function safetyPreflight(env, { mode = 'static' } = {}) {
  if (!['static', 'emulator'].includes(mode)) throw new Error('Unknown safety mode');
  const present = key => typeof env[key] === 'string' && env[key].trim() !== '';
  for (const key of forbiddenKeys) if (present(key)) throw new Error(`${key}: forbidden in deterministic QA`);
  for (const key of projectKeys) {
    if (present(key) && env[key] !== 'demo-eki-qa') throw new Error(`${key}: approved demo project required`);
  }
  for (const key of urlKeys) if (present(key)) {
    const url = assertLoopbackUrl(env[key], key);
    if (/FIREBASE_DATABASE_URL$/.test(key) &&
      (url.port !== String(hosts.FIREBASE_DATABASE_EMULATOR_HOST) || url.pathname !== '/')) {
      throw new Error(`${key}: database emulator root required`);
    }
  }
  for (const [key, port] of Object.entries(hosts)) {
    if (present(key) && ![`127.0.0.1:${port}`, `[::1]:${port}`].includes(env[key])) {
      throw new Error(`${key}: reserved loopback emulator port required`);
    }
  }
  if (mode === 'emulator') {
    for (const key of ['GCLOUD_PROJECT', ...Object.keys(hosts), 'FIREBASE_DATABASE_URL', 'EKI_QA_BASE_URL']) {
      if (!present(key)) throw new Error(`${key}: required for emulator QA`);
    }
    if (env.EKI_QA_EXTERNAL_PROVIDERS !== 'mock') throw new Error('External providers must be mock');
    if (env.EKI_QA_CONFIRM_DISPOSABLE !== '1') throw new Error('Disposable emulator confirmation required');
    if (assertLoopbackUrl(env.EKI_QA_BASE_URL).pathname !== '/') throw new Error('Backend root required');
  }
  return { mode, configuredProject: present('GCLOUD_PROJECT') ? 'demo-eki-qa' : null,
    checkedVariables: [...projectKeys, ...Object.keys(hosts), ...urlKeys, ...forbiddenKeys].filter(present),
    configAccepted: true, runtimeIsolationVerified: false,
    limitation: 'Configuration check only. Does not prove a running backend uses emulators or prevent network access. No requests or SDK imports performed.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && args[0] !== '--emulator')) throw new Error('Only --emulator is supported');
  console.log(JSON.stringify(safetyPreflight(process.env, { mode: args.length ? 'emulator' : 'static' })));
}
