/**
 * A tiny isometric rasteriser for greybox art: convex polygons filled at pixel centres, hard
 * edges, no anti-aliasing — so every edge of a 2:1 face lands on the pixel-art stair.
 */

import { blank } from './png.mjs';
import { toRgb } from './palette.mjs';

export const HW = 64; // half a tile's width at @2x
export const HH = 32; // half a tile's height at @2x

/** A canvas with a projection: S(gx, gy, z) → screen pixel, in true 2:1 at @2x. */
export function isoCanvas(width, height, originX, originY) {
  const img = blank(width, height);
  const S = (gx, gy, z = 0) => [originX + (gx - gy) * HW, originY + (gx + gy) * HH - z];
  return { img, S };
}

function setPx(img, x, y, rgb) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 4;
  img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
}

/** Fill a convex polygon (screen points) by testing each pixel centre against every edge. */
export function fillPoly(img, pts, hex) {
  if (pts.length < 3) return;
  const rgb = toRgb(hex);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(img.width - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(img.height - 1, Math.ceil(Math.max(...ys)));
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
  if (Math.abs(area) < 1e-6) return;
  const sign = Math.sign(area);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, py = y + 0.5;
    let inside = true;
    for (let i = 0; i < pts.length && inside; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (sign * ((b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])) < 0) inside = false;
    }
    if (inside) setPx(img, x, y, rgb);
  }
}

/** A 1-pixel Bresenham line. */
export function line(img, a, b, hex) {
  const rgb = toRgb(hex);
  let [x0, y0] = a.map(Math.round), [x1, y1] = b.map(Math.round);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    setPx(img, x0, y0, rgb);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Fill a polygon and stroke its edges — one face of a greybox prism. */
export function face(img, pts, fill, edge) {
  fillPoly(img, pts, fill);
  if (edge) for (let i = 0; i < pts.length; i++) line(img, pts[i], pts[(i + 1) % pts.length], edge);
}

/**
 * ART_BIBLE §8.3: the outer silhouette edge is the local colour darkened, never black. Every
 * opaque pixel touching transparency is darkened to 55 % of its colour.
 */
export function outlineSilhouette(img) {
  const { width: w, height: h, data } = img;
  const edge = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    if (data[o + 3] !== 255) continue;
    const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      return nx < 0 || ny < 0 || nx >= w || ny >= h || data[(ny * w + nx) * 4 + 3] === 0;
    });
    if (open) edge.push(o);
  }
  for (const o of edge) for (let k = 0; k < 3; k++) data[o + k] = Math.round(data[o + k] * 0.55);
  return img;
}
