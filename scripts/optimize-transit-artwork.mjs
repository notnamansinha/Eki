/** Rebuild delivery images from the approved PNGs, without upscaling or redrawing. */
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Use the encoder that ships with this project's Next.js installation.
const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", {
  paths: [require.resolve("next/package.json")],
}));
const directory = new URL("../frontend/public/images/", import.meta.url);
const sources = new URL("../docs/design/transit-artwork/", import.meta.url);
const compositions = [
  { orientation: "portrait", width: 841, height: 1870, sizes: [480, 768, 841] },
  { orientation: "landscape", width: 1672, height: 941, sizes: [960, 1280, 1672] },
];
for (const composition of compositions) {
  const name = `bus-background-${composition.orientation}-trees`;
  const source = fileURLToPath(new URL(`${name}.png`, sources));
  const metadata = await sharp(source).metadata();
  if (metadata.width !== composition.width || metadata.height !== composition.height) {
    throw new Error(`Expected the approved ${composition.width}x${composition.height} ${name}.png.`);
  }
  for (const width of composition.sizes) {
    const destination = fileURLToPath(new URL(`${name}-${width}.webp`, directory));
    const output = await sharp(source)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 96, effort: 6, smartSubsample: true })
      .toFile(destination);
    console.log(`${name}: ${output.width}x${output.height}, ${output.size} bytes`);
  }
}
