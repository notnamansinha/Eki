import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { backendOriginFromUrl } from "./csp-backend-origin.mjs";
import { parseRtdbInstanceUrl } from "./rtdb-instance-config.mjs";
import { inlineScriptHashes } from "./inline-script-hashes.mjs";
import { loadFrontendEnv } from "./load-frontend-env.mjs";

const root = path.resolve(import.meta.dirname, "..");
// Read NEXT_PUBLIC_* the way `next build` did, or the CSP would omit origins
// that only frontend/.env* configures while the bundle still calls them.
loadFrontendEnv(root);
const output = path.join(root, "frontend", "out");
const firebasePath = path.join(root, "firebase.json");

async function htmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(target);
    return entry.isFile() && entry.name.endsWith(".html") ? [target] : [];
  }));
  return nested.flat();
}

const hashes = new Set();
for (const file of await htmlFiles(output)) {
  const html = await readFile(file, "utf8");
  for (const hash of inlineScriptHashes(html)) hashes.add(hash);
}

if (hashes.size === 0) throw new Error("No inline Next.js scripts found; refusing to write an empty CSP.");

const firebase = JSON.parse(await readFile(firebasePath, "utf8"));
const globalHeaders = firebase.hosting.headers.find((entry) => entry.source === "**");
const csp = globalHeaders?.headers.find((header) => header.key === "Content-Security-Policy");
if (!csp) throw new Error("Global Content-Security-Policy header not found.");

// Rewrite a managed directive wherever it appears (including as the final,
// unterminated directive). A missing directive is a build error: reporting
// success without hashes or sources would ship a policy that blocks the app.
function replaceDirective(name, sources) {
  const pattern = new RegExp(`(^|;\\s*)${name} [^;]*`);
  if (!pattern.test(csp.value)) {
    throw new Error(`Global Content-Security-Policy has no ${name} directive to update.`);
  }
  csp.value = csp.value.replace(pattern, (_match, prefix) => `${prefix}${name} ${sources}`);
}

const backendOrigin = backendOriginFromUrl(process.env.NEXT_PUBLIC_BACKEND_URL);
// RTDB's long-poll fallback loads /.lp through script elements, so connect-src
// alone does not allow it. Production builds name the configured instance, but
// only its /.lp path: the bare origin would also allow REST `?callback=` JSONP.
const databaseHostname = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL
  ? parseRtdbInstanceUrl(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL).hostname
  : null;
// Firebase can redirect long-polling to a different Google-owned shard. The
// protocol loads JSONP scripts and a disconnect iframe at /.lp; permitting only
// connect-src or the configured instance breaks clients after a socket failure.
// Restrict these additional script/frame sources to that transport path.
const rtdbLongPollSources = [
  "https://*.firebaseio.com/.lp",
  "https://*.firebasedatabase.app/.lp",
];

// Never add a host that serves callback-reflecting JSONP (for example
// www.google.com): it would run attacker-chosen calls despite the hashes.
const sources = [
  "'self'",
  ...[...hashes].sort(),
  "https://apis.google.com",
  "https://www.gstatic.com",
  "https://maps.googleapis.com",
  ...(databaseHostname ? [`https://${databaseHostname}/.lp`] : []),
  ...rtdbLongPollSources,
].join(" ");
replaceDirective("script-src", sources);
const connectSources = [
  "'self'",
  // Workbox fetches Google's Auth helper on controlled pages. The worker's
  // connect-src governs that fetch even though the page permits script-src.
  "https://apis.google.com",
  "https://*.googleapis.com",
  "https://*.gstatic.com",
  "https://*.ggpht.com",
  "https://*.firebaseio.com",
  "https://*.firebasedatabase.app",
  "https://*.firebaseapp.com",
  "wss://*.firebaseio.com",
  "wss://*.firebasedatabase.app",
  ...(backendOrigin ? [backendOrigin] : []),
].join(" ");
replaceDirective("connect-src", connectSources);
const imageSources = [
  "'self'",
  "data:",
  "blob:",
  "https://*.googleapis.com",
  "https://*.gstatic.com",
  "https://*.googleusercontent.com",
  "https://*.ggpht.com",
].join(" ");
replaceDirective("img-src", imageSources);
const frameSources = [
  "'self'",
  "https://accounts.google.com",
  "https://*.firebaseapp.com",
  ...rtdbLongPollSources,
].join(" ");
replaceDirective("frame-src", frameSources);
await writeFile(firebasePath, `${JSON.stringify(firebase, null, 2)}\n`);
console.log(`Updated CSP with ${hashes.size} inline-script hashes.`);

