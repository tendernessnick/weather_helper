// Regenerate the PWA raster icons from public/icon.svg (the design source).
// Usage: npm run icons   (needs the dev dependency `sharp`)
import sharp from 'sharp';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Density is set for the largest target so downscales stay crisp (SVG at
// 96dpi renders the 512 viewBox exactly once, then sharp resizes).
const svg = sharp(join(root, 'public', 'icon.svg'), { density: 96 });

const targets = [
  ['icon-512.png', 512],
  ['icon-192.png', 192],
  ['icon-180.png', 180],
];

for (const [name, size] of targets) {
  await svg.clone().resize(size, size).png().toFile(join(root, 'public', name));
  console.log('wrote', name, `${size}x${size}`);
}
