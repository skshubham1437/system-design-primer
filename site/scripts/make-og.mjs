// Renders public/og.png (the link-preview image). Run manually when the branding changes:
//   node scripts/make-og.mjs
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'og.png');
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0e1110"/>
  <g opacity="0.5" fill="#2b3431">${Array.from({ length: 27 * 14 }, (_, i) => `<circle cx="${(i % 27) * 46 + 20}" cy="${Math.floor(i / 27) * 46 + 20}" r="1.6"/>`).join('')}</g>
  <rect x="72" y="72" width="64" height="64" rx="18" fill="#4fd1c5"/>
  <g stroke="#062b28" stroke-width="3.6" stroke-linecap="round" fill="none"><path d="M104 90v11M104 101 90.5 117M104 101l13.5 16"/></g>
  <g fill="#062b28"><circle cx="104" cy="88.5" r="5.5"/><circle cx="90.5" cy="119" r="5.5"/><circle cx="117.5" cy="119" r="5.5"/></g>
  <text x="156" y="118" font-family="Georgia, 'Times New Roman', serif" font-size="34" font-weight="600" fill="#ecebe5">System Design Primer</text>
  <text x="72" y="316" font-family="Georgia, 'Times New Roman', serif" font-size="92" font-weight="600" fill="#ecebe5" letter-spacing="-2">Learn how to design</text>
  <text x="72" y="418" font-family="Georgia, 'Times New Roman', serif" font-size="92" font-style="italic" font-weight="500" fill="#4fd1c5" letter-spacing="-2">large-scale systems.</text>
  <text x="72" y="520" font-family="Helvetica, Arial, sans-serif" font-size="32" fill="#a8a79f">Concepts, trade-offs, worked solutions, flashcards and labs.</text>
  <text x="72" y="568" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#74746c">skshubham1437.github.io/system-design-primer</text>
</svg>`;
await sharp(Buffer.from(svg)).png().toFile(out);
console.log('wrote', out);
