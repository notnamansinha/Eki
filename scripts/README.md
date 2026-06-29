# Scripts Directory

This directory contains utility scripts intended to be executed from the repository root or via CI/CD pipelines.

## `fix-leaflet-ssr.js`

### Purpose
React-Leaflet and Leaflet inherently depend on the browser `window` object. Next.js App Router attempts to Server-Side Render (SSR) components by default, which causes the build or runtime to crash with `window is not defined` when Leaflet is imported.

This script recursively scans the `frontend/src` directory for `.ts` and `.tsx` files containing direct Leaflet imports (`import L from "leaflet";`) and rewrites them into conditional runtime imports:
```javascript
let L: any;
if (typeof window !== "undefined") {
  L = require("leaflet");
}
```

### Usage
This script is typically run automatically as a pre-build step or manually if new map components are introduced that break the SSR boundary.

```bash
node scripts/fix-leaflet-ssr.js
```
