const http = require('http');
const fs = require('fs');
const path = require('path');

const port = 8080;
// Use __dirname instead of a hardcoded absolute path so this works on any machine
const root = path.resolve(__dirname);

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.wasm': 'application/wasm',
};

http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    // Resolve the target path and verify it stays within root (prevents path traversal)
    const filePath = path.resolve(root, urlPath === '/' ? 'prototype.html' : urlPath.slice(1));

    // ── Path traversal guard ──────────────────────────────────────────────────
    if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end('403 Forbidden');
        return;
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404);
                // Do NOT leak internal filesystem paths in error responses
                res.end('404 Not Found');
            } else {
                res.writeHead(500);
                res.end('500 Internal Server Error');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
}).listen(port);

console.log(`Server running at http://localhost:${port}/`);
