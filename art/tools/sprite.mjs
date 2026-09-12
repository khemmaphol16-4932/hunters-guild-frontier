/**
 * Deterministic sprite operations for the art pipeline (art/ART_BIBLE.md §6–9, §13).
 *
 * Every function is pure over RGBA images ({ width, height, data }) and gives the same output for
 * the same input, so an export can be re-run and diffed. Nothing here makes an aesthetic choice
 * that a human reviewer cannot see in the QA sheet.
 */

import { blank } from './png.mjs';

/** ART_BIBLE.md §6.1 — the nine functional hues. */
export const FUNCTIONAL_HUES = ['#8c98a8', '#dde3ea', '#5b8dd6', '#d9a441', '#d4685f', '#b58bd6', '#8c5fd6', '#5fbf87', '#4fb0b8'];

/** ART_BIBLE.md §6.3 colour caps, keyed by prompt-library category. */
export const COLOUR_CAP = { '01': 24, '02': 32, '03': 32, '04': 48, '05': 24, '06': 32, '07': 16, '08': 12, '09': 16, '10': 12, '11': 32, '12': 64 };

/** Categories where a functional hue must never appear decoratively (§6.1 hard rule). */
export const NO_FUNCTIONAL = new Set(['01', '04', '05']);

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Bounding box of pixels with alpha ≥ threshold, or null if empty. */
export function bbox(img, threshold = 128) {
  const { width: w, height: h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] >= threshold) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Remove a dark matte baked into colour — the "soft halo" generation leaves around a subject.
 * Flood-fills from every fully transparent pixel through neighbouring pixels darker than
 * `maxLuminance` and clears them. Bright subject pixels stop the fill, so an interior dark
 * detail enclosed by the subject survives; only dark pixels connected to the outside go.
 */
export function removeDarkMatte(img, maxLuminance) {
  const { width: w, height: h } = img;
  const data = new Uint8Array(img.data);
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let i = 0; i < w * h; i++) if (data[i * 4 + 3] < 128) { seen[i] = 1; stack.push(i); }
  let cleared = 0;
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (seen[n]) continue;
      const p = n * 4;
      if (luminance(data[p], data[p + 1], data[p + 2]) <= maxLuminance) {
        seen[n] = 1; data[p + 3] = 0; cleared++; stack.push(n);
      }
    }
  }
  return { img: { width: w, height: h, data }, cleared };
}

/**
 * Downsample a region to an exact size by block mode: each output pixel takes the most common
 * colour among the opaque source pixels in its block (colours bucketed to 5 bits a channel, the
 * winning bucket averaged). A block is opaque only if at least half its pixels are, which snaps
 * alpha to 0 or 255 — the binary alpha §13 requires.
 */
export function downsample(img, region, outW, outH) {
  const out = blank(outW, outH);
  const sx = region.w / outW, sy = region.h / outH;
  for (let oy = 0; oy < outH; oy++) for (let ox = 0; ox < outW; ox++) {
    const xa = region.x + Math.floor(ox * sx), xb = region.x + Math.max(Math.floor((ox + 1) * sx), Math.floor(ox * sx) + 1);
    const ya = region.y + Math.floor(oy * sy), yb = region.y + Math.max(Math.floor((oy + 1) * sy), Math.floor(oy * sy) + 1);
    const buckets = new Map();
    let opaque = 0, total = 0;
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      total++;
      const p = (y * img.width + x) * 4;
      if (img.data[p + 3] < 128) continue;
      opaque++;
      const key = ((img.data[p] >> 3) << 10) | ((img.data[p + 1] >> 3) << 5) | (img.data[p + 2] >> 3);
      const b = buckets.get(key) ?? [0, 0, 0, 0];
      b[0]++; b[1] += img.data[p]; b[2] += img.data[p + 1]; b[3] += img.data[p + 2];
      buckets.set(key, b);
    }
    if (total === 0 || opaque * 2 < total) continue;
    let best = null, bestKey = -1;
    for (const [key, b] of buckets) if (!best || b[0] > best[0] || (b[0] === best[0] && key < bestKey)) { best = b; bestKey = key; }
    const o = (oy * outW + ox) * 4;
    out.data[o] = Math.round(best[1] / best[0]); out.data[o + 1] = Math.round(best[2] / best[0]); out.data[o + 2] = Math.round(best[3] / best[0]); out.data[o + 3] = 255;
  }
  return out;
}

/** Deterministic median-cut quantization of opaque pixels to at most `cap` colours. */
export function quantize(img, cap) {
  const px = [];
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] === 255) px.push([img.data[i], img.data[i + 1], img.data[i + 2]]);
  if (px.length === 0) return { img, palette: [] };
  let boxes = [px];
  while (boxes.length < cap) {
    let bi = -1, bc = 0, range = -1;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0;
        for (const p of box) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; }
        if (hi - lo > range) { range = hi - lo; bi = i; bc = c; }
      }
    });
    if (bi < 0 || range <= 0) break;
    const box = boxes[bi].slice().sort((a, b) => a[bc] - b[bc] || a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }
  const palette = boxes.map((box) => {
    const s = box.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
    return s.map((v) => Math.round(v / box.length));
  });
  const data = new Uint8Array(img.data);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 255) continue;
    const c = [data[i], data[i + 1], data[i + 2]];
    let best = palette[0], bd = Infinity;
    for (const p of palette) { const d = dist2(c, p); if (d < bd) { bd = d; best = p; } }
    data[i] = best[0]; data[i + 1] = best[1]; data[i + 2] = best[2];
  }
  return { img: { width: img.width, height: img.height, data }, palette: palette.map((p) => hex(...p)) };
}

/** Place a subject so its bottom row sits on the pivot row and its centre on the pivot column. */
export function place(subject, canvasW, canvasH, pivot) {
  const out = blank(canvasW, canvasH);
  const ox = Math.round(pivot[0] - subject.width / 2), oy = pivot[1] - subject.height + 1;
  for (let y = 0; y < subject.height; y++) for (let x = 0; x < subject.width; x++) {
    const tx = ox + x, ty = oy + y;
    if (tx < 0 || ty < 0 || tx >= canvasW || ty >= canvasH) continue;
    const s = (y * subject.width + x) * 4, d = (ty * canvasW + tx) * 4;
    for (let k = 0; k < 4; k++) out.data[d + k] = subject.data[s + k];
  }
  return out;
}

/** O-1: the @1x image from the @2x one — every 2 × 2 block becomes one pixel by block mode. */
export const halve = (img) => downsample(img, { x: 0, y: 0, w: img.width, h: img.height }, img.width / 2, img.height / 2);

/**
 * O-2: the contact shadow from the sprite's own alpha (ART_BIBLE §8.2): an ellipse 0.7 × the
 * silhouette width and 0.35 × that tall, centred on the pivot, slate-blue #3e4a5c at 35%. It is
 * the one asset exempt from binary alpha — a shadow is translucent by design.
 */
export function contactShadow(img, pivot) {
  const box = bbox(img);
  const out = blank(img.width, img.height);
  if (!box) return out;
  const rx = (box.w * 0.7) / 2, ry = (box.w * 0.7 * 0.35) / 2;
  const [r, g, b] = rgb('#3e4a5c');
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const dx = (x + 0.5 - pivot[0]) / rx, dy = (y + 0.5 - pivot[1]) / ry;
    if (dx * dx + dy * dy > 1) continue;
    const o = (y * img.width + x) * 4;
    out.data[o] = r; out.data[o + 1] = g; out.data[o + 2] = b; out.data[o + 3] = 89;
  }
  return out;
}

/** Nearest-neighbour scale — used only for QA previews, never for shipped art. */
export function scaleNearest(img, factor) {
  const w = Math.max(1, Math.round(img.width * factor)), h = Math.max(1, Math.round(img.height * factor));
  const out = blank(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(img.width - 1, Math.floor(x / factor)), sy = Math.min(img.height - 1, Math.floor(y / factor));
    const s = (sy * img.width + sx) * 4, d = (y * w + x) * 4;
    for (let k = 0; k < 4; k++) out.data[d + k] = img.data[s + k];
  }
  return out;
}

/** Composite images left to right over a solid ground colour, for a QA sheet a human reviews. */
export function qaSheet(images, ground = '#6f7f4e', gap = 16) {
  const w = images.reduce((n, i) => n + i.width + gap, gap), h = Math.max(...images.map((i) => i.height)) + gap * 2;
  const out = blank(w, h);
  const [gr, gg, gb] = rgb(ground);
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = gr; out.data[i + 1] = gg; out.data[i + 2] = gb; out.data[i + 3] = 255; }
  let x0 = gap;
  for (const img of images) {
    const y0 = h - gap - img.height;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4, a = img.data[s + 3] / 255;
      if (a === 0) continue;
      const d = ((y0 + y) * w + x0 + x) * 4;
      for (let k = 0; k < 3; k++) out.data[d + k] = Math.round(img.data[s + k] * a + out.data[d + k] * (1 - a));
    }
    x0 += img.width + gap;
  }
  return out;
}

/**
 * Check an exported sprite against every ART_BIBLE §13 rule a machine can measure. The 0.55-zoom
 * readability test and the silhouette tests still need human eyes — the QA sheet is for those.
 */
export function validate(img, { canvas, pivot, category, halfImg }) {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass, detail });
  const colours = new Set();
  let partial = 0, pureBW = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3];
    if (a !== 0 && a !== 255) partial++;
    if (a === 255) {
      const h = hex(img.data[i], img.data[i + 1], img.data[i + 2]);
      colours.add(h);
      if (h === '#000000' || h === '#ffffff') pureBW++;
    }
  }
  add('canvas size', canvas ? img.width === canvas[0] && img.height === canvas[1] : true, `${img.width} × ${img.height}${canvas ? ` (spec ${canvas[0]} × ${canvas[1]})` : ''}`);
  add('binary alpha', partial === 0, partial ? `${partial} semi-transparent pixels` : 'every pixel is 0 or 255');
  const cap = COLOUR_CAP[category];
  add('colour cap', !cap || colours.size <= cap, `${colours.size} colours${cap ? ` (cap ${cap})` : ''}`);
  add('no pure black or white', pureBW === 0, pureBW ? `${pureBW} pixels of #000000/#ffffff` : 'none');
  if (NO_FUNCTIONAL.has(category)) {
    const hits = FUNCTIONAL_HUES.filter((f) => [...colours].some((c) => dist2(rgb(c), rgb(f)) < 100));
    add('no functional hue', hits.length === 0, hits.length ? `near ${hits.join(', ')}` : 'none');
  }
  const box = bbox(img);
  if (pivot && box) {
    const bottom = box.y + box.h - 1, centre = box.x + (box.w - 1) / 2;
    add('pivot', Math.abs(bottom - pivot[1]) <= 1 && Math.abs(centre - pivot[0]) <= 2, `ground row ${bottom}, centre ${centre} (spec ${pivot[1]}, ${pivot[0]})`);
  }
  if (halfImg) add('@1x is exactly half', halfImg.width * 2 === img.width && halfImg.height * 2 === img.height, `${halfImg.width} × ${halfImg.height}`);
  return { pass: checks.every((c) => c.pass), checks, colours: colours.size, bbox: box };
}
