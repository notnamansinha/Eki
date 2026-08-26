import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { backendOriginFromUrl } from "./csp-backend-origin.mjs";

const root = path.resolve(import.meta.dirname, "..");
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
  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(match[1]) || match[2].length === 0) continue;
    hashes.add(`'sha256-${createHash("sha256").update(match[2]).digest("base64")}'`);
  }
}

if (hashes.size === 0) throw new Error("No inline Next.js scripts found; refusing to write an empty CSP.");

const firebase = JSON.parse(await readFile(firebasePath, "utf8"));
const globalHeaders = firebase.hosting.headers.find((entry) => entry.source === "**");
const csp = globalHeaders?.headers.find((header) => header.key === "Content-Security-Policy");
if (!csp) throw new Error("Global Content-Security-Policy header not found.");

const backendOrigin = backendOriginFromUrl(process.env.NEXT_PUBLIC_BACKEND_URL);

const sources = [
  "'self'",
  ...[...hashes].sort(),
  "https://apis.google.com",
  "https://www.gstatic.com",
  "https://www.google.com",
  "https://maps.googleapis.com",
].join(" ");
csp.value = csp.value.replace(/script-src [^;]+;/, `script-src ${sources};`);
const connectSources = [
  "'self'",
  "https://*.googleapis.com",
  "https://*.firebaseio.com",
  "https://*.firebasedatabase.app",
  "https://*.firebaseapp.com",
  "https://www.google.com/recaptcha/",
  "wss://*.firebaseio.com",
  "wss://*.firebasedatabase.app",
  ...(backendOrigin ? [backendOrigin] : []),
].join(" ");
csp.value = csp.value.replace(/connect-src [^;]+;/, `connect-src ${connectSources};`);
const frameSources = [
  "https://accounts.google.com",
  "https://*.firebaseapp.com",
  "https://www.google.com/recaptcha/",
  "https://recaptcha.google.com/recaptcha/",
].join(" ");
csp.value = csp.value.replace(/frame-src [^;]+;/, `frame-src ${frameSources};`);
await writeFile(firebasePath, `${JSON.stringify(firebase, null, 2)}\n`);
console.log(`Updated CSP with ${hashes.size} inline-script hashes.`);

