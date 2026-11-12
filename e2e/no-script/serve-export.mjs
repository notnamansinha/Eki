// Serves the built static export (frontend/out) the way Firebase Hosting does
// for the pages under test: clean URLs plus the global security headers from
// firebase.json, so the Content-Security-Policy applied is the deployed one.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const outDir = path.join(root, "frontend", "out");
const port = Number(process.env.EKI_NOSCRIPT_PORT || 3129);

const hosting = JSON.parse(await readFile(path.join(root, "firebase.json"), "utf8")).hosting;
const globalHeaders = Object.fromEntries(
  (hosting.headers.find((rule) => rule.source === "**")?.headers ?? []).map(({ key, value }) => [key, value]),
);
// Strict-Transport-Security is meaningless over plain HTTP on loopback.
delete globalHeaders["Strict-Transport-Security"];

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

async function resolveFile(urlPath) {
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, "");
  const candidates = clean === "" || clean === "."
    ? ["index.html"]
    : [clean, `${clean}.html`, path.join(clean, "index.html")];
  for (const candidate of candidates) {
    const file = path.join(outDir, candidate);
    if (!file.startsWith(outDir)) return null;
    try {
      if ((await stat(file)).isFile()) return file;
    } catch {
      // Try the next clean-URL candidate.
    }
  }
  return null;
}

createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  const file = await resolveFile(pathname);
  const target = file ?? path.join(outDir, "404.html");
  try {
    const body = await readFile(target);
    response.writeHead(file ? 200 : 404, {
      ...globalHeaders,
      "Content-Type": types[path.extname(target)] ?? "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found. Run `npm run build` first.");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Serving ${outDir} on http://127.0.0.1:${port}`);
});
