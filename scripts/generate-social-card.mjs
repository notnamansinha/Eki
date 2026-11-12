/**
 * Build the 1200x630 Open Graph / Twitter card from the approved landscape
 * transit painting and the Eki app icon. Run from the repository root:
 *   node scripts/generate-social-card.mjs
 */
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Use the encoder that ships with this project's Next.js installation.
const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", {
  paths: [require.resolve("next/package.json")],
}));

const WIDTH = 1200;
const HEIGHT = 630;
const painting = fileURLToPath(new URL("../docs/design/transit-artwork/bus-background-landscape-trees.png", import.meta.url));
const icon = fileURLToPath(new URL("../frontend/public/icon-512.png", import.meta.url));
const destination = fileURLToPath(new URL("../frontend/public/images/social-card.jpg", import.meta.url));

const source = await sharp(painting).metadata();
if (source.width !== 1672 || source.height !== 941) {
  throw new Error("Expected the approved 1672x941 bus-background-landscape-trees.png.");
}

const TILE = 112;
const tile = await sharp({
  create: { width: TILE, height: TILE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([
    { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}"><rect width="${TILE}" height="${TILE}" rx="26" fill="#ffffff"/></svg>`) },
    { input: await sharp(icon).resize(92, 92).png().toBuffer(), left: 10, top: 10 },
  ])
  .png()
  .toBuffer();

// A left-to-right shade keeps the white type above WCAG AA contrast on the
// red halftone while leaving the passengers visible on the right.
const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#09090b" stop-opacity="0.9"/>
      <stop offset="0.5" stop-color="#09090b" stop-opacity="0.74"/>
      <stop offset="0.82" stop-color="#09090b" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#09090b" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#shade)"/>
  <text x="208" y="146" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="64" fill="#ffffff">Eki</text>
  <text x="80" y="330" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="84" fill="#ffffff">Track your</text>
  <text x="80" y="424" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="84" fill="#ffffff">campus bus</text>
  <text x="80" y="498" font-family="Arial, Helvetica, sans-serif" font-size="32" fill="#ececef">Live bus locations for University routes</text>
  <rect x="80" y="540" width="96" height="6" rx="3" fill="#AE9562"/>
</svg>`;

const output = await sharp(painting)
  .resize(WIDTH, HEIGHT, { fit: "cover", position: "centre" })
  .composite([
    { input: Buffer.from(overlay) },
    { input: tile, left: 80, top: 66 },
  ])
  .jpeg({ quality: 82, mozjpeg: true, chromaSubsampling: "4:2:0" })
  .toFile(destination);
console.log(`social-card.jpg: ${output.width}x${output.height}, ${output.size} bytes`);
