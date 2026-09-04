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

// Open Graph share card (1200x630): brand icon over the sky gradient plus an
// English wordmark. Latin-only text on purpose — the local renderer (librsvg)
// has no CJK fonts on every build host, and boxes would ruin the preview.
const W = 1200, H = 630;
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#B7DBFF"/>
      <stop offset="1" stop-color="#EFF8FF"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <text x="${W / 2}" y="432" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
        font-size="64" font-weight="bold" fill="#0F172A">Tennis Weather HK</text>
  <text x="${W / 2}" y="492" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
        font-size="32" fill="#334155">Rain odds for every Hong Kong public tennis court,</text>
  <text x="${W / 2}" y="536" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
        font-size="32" fill="#334155">verified against real rain reports</text>
</svg>`;

// Round the icon tile so it reads as an app icon instead of a pasted square.
const tile = 260;
const mask = Buffer.from(
  `<svg width="${tile}" height="${tile}"><rect width="${tile}" height="${tile}" rx="56" fill="#fff"/></svg>`);
const iconBuf = await sharp(join(root, 'public', 'icon-512.png'))
  .resize(tile, tile)
  .composite([{ input: mask, blend: 'dest-in' }])
  .png().toBuffer();
await sharp(Buffer.from(ogSvg))
  .composite([{ input: iconBuf, left: Math.round((W - tile) / 2), top: 84 }])
  .png()
  .toFile(join(root, 'public', 'og-card.png'));
console.log('wrote og-card.png', `${W}x${H}`);
