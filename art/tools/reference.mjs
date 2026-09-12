#!/usr/bin/env node
/**
 * Constructs the two gate reference sheets that must be exact, not generated (ART_BIBLE.md §11):
 *
 *   REF_PALETTE_MASTER   art/reference-sheets/palette_master.{png,gpl,md}
 *   REF_GRID_PROJECTION  art/reference-sheets/grid_projection.png
 *
 * The palette's base colours are read from ART_BIBLE.md §6.2, so the bible stays the single
 * source; this script only derives the five-step ramps §6.3 asks for. Deterministic.
 *
 *   node art/tools/reference.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, blank } from './png.mjs';
import { FUNCTIONAL_HUES } from './sprite.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'art', 'reference-sheets');
mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ colour helpers

const toRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function hslToRgb([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
/** Move hue `amount` degrees toward `target`, the short way round. */
const shiftHue = (h, target, amount) => { const d = ((target - h + 540) % 360) - 180; return (h + Math.sign(d) * Math.min(Math.abs(d), amount) + 360) % 360; };

/**
 * ART_BIBLE §6.3: five steps — shadow, core shadow, base, light, highlight — shifting hue as they
 * shift value: shadows cooler toward blue, highlights warmer toward yellow. Never pure black or white.
 */
function ramp(base) {
  const [h, s, l] = rgbToHsl(toRgb(base));
  const steps = [
    [shiftHue(h, 225, 14), Math.min(1, s * 1.05), l * 0.55],
    [shiftHue(h, 225, 7), s, l * 0.78],
    [h, s, l],
    [shiftHue(h, 50, 6), s * 0.95, l + (1 - l) * 0.22],
    [shiftHue(h, 50, 12), s * 0.85, l + (1 - l) * 0.42],
  ];
  return steps.map((hsl, i) => (i === 2 ? base : toHex(hslToRgb([hsl[0], hsl[1], Math.max(0.06, Math.min(0.94, hsl[2]))]))));
}

// ------------------------------------------------------------------ palette master

const bible = readFileSync(join(ROOT, 'art', 'ART_BIBLE.md'), 'utf8').replace(/\r\n/g, '\n');
const start = bible.indexOf('### 6.2 Environmental palettes');
const end = bible.indexOf('### 6.3', start);
if (start < 0 || end < 0) throw new Error('ART_BIBLE.md §6.2 not found');
const section = bible.slice(start, end);
const functional = new Set(FUNCTIONAL_HUES);

// Each paragraph of §6.2 is one palette group: "**Name — mood.** colour `#hex`, colour `#hex` …".
const groups = [];
for (const para of section.split('\n\n')) {
  const title = /\*\*([^*]+?)[.—]/.exec(para)?.[1]?.replace(/\s*[—-]\s*$/, '').trim();
  const colours = [...para.matchAll(/([A-Za-z][A-Za-z -]*?)\s*`(#[0-9a-fA-F]{6})`/g)]
    .map(([, name, h]) => ({ name: name.replace(/^(and|with|to|→|,)\s+/i, '').trim(), hex: h.toLowerCase() }))
    .filter((c) => !functional.has(c.hex));
  if (title && colours.length) groups.push({ title, colours });
}

const seen = new Set();
const rows = [];
for (const g of groups) for (const c of g.colours) {
  if (seen.has(c.hex)) continue;
  seen.add(c.hex);
  rows.push({ group: g.title, name: c.name, base: c.hex, ramp: ramp(c.hex) });
}

const SW = 32, GAP = 4;
const png = blank(5 * (SW + GAP) + GAP, rows.length * (SW + GAP) + GAP + (SW + GAP) * 2);
const fill = (x0, y0, w, h, hex) => {
  const [r, g, b] = toRgb(hex);
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const o = (y * png.width + x) * 4; png.data[o] = r; png.data[o + 1] = g; png.data[o + 2] = b; png.data[o + 3] = 255;
  }
};
fill(0, 0, png.width, png.height, '#ccbfa3');
rows.forEach((row, y) => row.ramp.forEach((hex, x) => fill(GAP + x * (SW + GAP), GAP + y * (SW + GAP), SW, SW, hex)));
// The functional hues, unramped, in a separate band below a gap: signal, not material.
FUNCTIONAL_HUES.forEach((hex, i) => fill(GAP + (i % 5) * (SW + GAP), GAP + (rows.length + 0.5 + Math.floor(i / 5)) * (SW + GAP), SW, SW, hex));
writeFileSync(join(OUT, 'palette_master.png'), encodePng(png));

const total = rows.length * 5 + FUNCTIONAL_HUES.length;
const gpl = ['GIMP Palette', "Name: Hunter's Guild Frontier master", 'Columns: 5', '#'];
const STEP = ['shadow', 'core shadow', 'base', 'light', 'highlight'];
for (const row of rows) row.ramp.forEach((hex, i) => { const [r, g, b] = toRgb(hex); gpl.push(`${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${row.name} — ${STEP[i]}`); });
FUNCTIONAL_HUES.forEach((hex) => { const [r, g, b] = toRgb(hex); gpl.push(`${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\tfunctional ${hex}`); });
writeFileSync(join(OUT, 'palette_master.gpl'), gpl.join('\n') + '\n');

const md = [
  '<!-- GENERATED by art/tools/reference.mjs from ART_BIBLE.md §6.2. Change the bible, then rerun. -->',
  '',
  '# REF_PALETTE_MASTER',
  '',
  `**Status: PENDING APPROVAL** (gate sheet, ART_BIBLE.md §11). ${rows.length} material ramps × 5 steps + ${FUNCTIONAL_HUES.length} functional hues = **${total} colours**.`,
  '',
  'Bases are read from ART_BIBLE.md §6.2; each ramp shifts cooler toward blue in the shadows and warmer toward yellow in the highlights (§6.3). The nine functional hues (§6.1) sit in their own band, unramped: they are signal, not material, and may not be used decoratively.',
  '',
  '![palette](palette_master.png)',
  '',
  '| Group | Colour | Shadow | Core shadow | **Base** | Light | Highlight |',
  '|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.group} | ${r.name} | \`${r.ramp[0]}\` | \`${r.ramp[1]}\` | **\`${r.ramp[2]}\`** | \`${r.ramp[3]}\` | \`${r.ramp[4]}\` |`),
  '',
  `Functional: ${FUNCTIONAL_HUES.map((h) => `\`${h}\``).join(' ')}`,
  '',
];
writeFileSync(join(OUT, 'palette_master.md'), md.join('\n'));

// ------------------------------------------------------------------ grid projection

// An 8 × 8 grid of true 2:1 diamonds at @2x (128 × 64), with 1×1, 2×2 and 3×3 footprints marked.
const N = 8, HW = 64, HH = 32, M = 32;
const grid = blank(2 * N * HW + 2 * M, 2 * N * HH + 2 * M);
const put = (x, y, hex) => {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return;
  const [r, g, b] = toRgb(hex), o = (y * grid.width + x) * 4;
  grid.data[o] = r; grid.data[o + 1] = g; grid.data[o + 2] = b; grid.data[o + 3] = 255;
};
for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) put(x, y, '#ccbfa3');
const topX = M + N * HW, topY = M;
const P = (gx, gy) => [topX + (gx - gy) * HW, topY + (gx + gy) * HH];
/** An exact 2:1 line: two pixels across for every one down — the pixel-art isometric stair. */
function line(a, b, hex) {
  const [x0, y0] = a, [x1, y1] = b;
  const n = Math.abs(x1 - x0), sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
  for (let i = 0; i <= n; i++) put(x0 + sx * i, y0 + sy * Math.floor(i / 2), hex);
}
function fillFootprint(gx, gy, w, h, hex) {
  for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) {
    const [cx, cy] = P(gx + tx, gy + ty);
    for (let dy = 1; dy < 2 * HH; dy++) {
      const half = dy <= HH ? dy * 2 : (2 * HH - dy) * 2;
      for (let dx = -half + 2; dx < half - 1; dx++) put(cx + dx, cy + dy, hex);
    }
  }
}
function outline(gx, gy, w, h, hex) {
  line(P(gx, gy), P(gx + w, gy), hex); line(P(gx, gy + h), P(gx + w, gy + h), hex);
  line(P(gx, gy), P(gx, gy + h), hex); line(P(gx + w, gy), P(gx + w, gy + h), hex);
}
fillFootprint(1, 1, 1, 1, '#e8b45a'); fillFootprint(3, 1, 2, 2, '#c2a05e'); fillFootprint(1, 4, 3, 3, '#9b9070');
for (let k = 0; k <= N; k++) { line(P(0, k), P(N, k), '#8d8a80'); line(P(k, 0), P(k, N), '#8d8a80'); }
outline(1, 1, 1, 1, '#54382a'); outline(3, 1, 2, 2, '#54382a'); outline(1, 4, 3, 3, '#54382a');
writeFileSync(join(OUT, 'grid_projection.png'), encodePng(grid));

console.log(`palette_master: ${rows.length} ramps × 5 + ${FUNCTIONAL_HUES.length} functional = ${total} colours`);
console.log(`grid_projection: ${grid.width} × ${grid.height}, tile 128 × 64 @2x, footprints 1×1, 2×2, 3×3`);
