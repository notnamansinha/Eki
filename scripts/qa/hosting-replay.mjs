import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { expectedHeaders, routeRequest } from './cache-matrix.mjs';

/**
 * Loopback replay of Firebase Hosting for the static export (qa/CACHE_MATRIX.md).
 * It routes and sets headers exactly as firebase.json describes, through the
 * same derivation the matrix checks. It does not model CDN behaviour: no
 * ETag, Last-Modified, Range, compression, Age or X-Cache. A rewrite to a
 * backend answers 502, because that traffic never reaches static content.
 */

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};
const contentType = file => CONTENT_TYPES[/\.[^./]+$/.exec(file)?.[0].toLowerCase()] ?? 'application/octet-stream';

/** Every file of the export as a request path (`/admin.html`), with forward slashes. */
export async function listExport(publicDir) {
  const files = new Set();
  const walk = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.add(`/${relative(publicDir, full).replaceAll('\\', '/')}`);
    }
  };
  await walk(publicDir);
  return files;
}

export function createHostingReplay({ hosting, publicDir, files }) {
  return createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, { allow: 'GET, HEAD' }).end();
        return;
      }
      const url = new URL(request.url, 'http://replay.invalid');
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { response.writeHead(400).end(); return; }
      const route = routeRequest(hosting, pathname, path => files.has(path));
      const expected = expectedHeaders(hosting, pathname, { notFound: route.kind === 'not-found' });
      const headers = Object.fromEntries(expected.headers);
      if (expected.cacheControl) headers['cache-control'] = expected.cacheControl;
      if (route.kind === 'redirect') {
        response.writeHead(route.status, { ...headers, location: `${route.location}${url.search}` }).end();
        return;
      }
      if (route.kind === 'reserved' || route.kind === 'backend') {
        response.writeHead(route.kind === 'reserved' ? 404 : 502, { 'content-type': 'text/plain' }).end('Not replayed\n');
        return;
      }
      // route.file is always a member of `files`, so the read stays inside the export.
      const body = route.file ? await readFile(join(publicDir, ...route.file.split('/'))) : Buffer.from('Not Found\n');
      response.writeHead(route.status, {
        ...headers, 'content-type': route.file ? contentType(route.file) : 'text/plain', 'content-length': body.length,
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });
}
