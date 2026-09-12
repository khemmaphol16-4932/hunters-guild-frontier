#!/usr/bin/env node
/**
 * Bakes every building tier-variant, in all four rotations, from the recipes in
 * src/data/town/building-art.json (art/specs/04-buildings.md, O-6).
 *
 *   node art/tools/bake-buildings.mjs      → art/buildings/greybox/  (sprites + index.json)
 *                                            art/qa/greybox/          (category line-up, tier sheet)
 *
 * Until the kit parts are generated this draws a greybox: every part as a lit prism in the
 * approved palette, on the exact 2:1 grid. It exists to prove the recipes and the ten-category
 * silhouette rule before any kit art is commissioned; when kit parts arrive, the same recipes
 * place them. Deterministic.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodePng, blank } from './png.mjs';
import { ramp } from './palette.mjs';
import { isoCanvas, face, outlineSilhouette, HW, HH } from './iso.mjs';
import { qaSheet, scaleNearest } from './sprite.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'art', 'buildings', 'greybox');
const QA = join(ROOT, 'art', 'qa', 'greybox');
const buildings = JSON.parse(readFileSync(join(ROOT, 'src/data/town/buildings.json'), 'utf8')).buildings;
const recipes = JSON.parse(readFileSync(join(ROOT, 'src/data/town/building-art.json'), 'utf8')).buildings;
export const ROTATIONS = [0, 90, 180, 270];

// ----------------------------------------------------------------------------- materials

/** Tier reads from material, never a label (ART_BIBLE §5.2): thatch → shingle → clay tile. */
const MATERIAL = {
  t1: { wall: '#8a5c3b', roof: '#c2a05e', base: '#9b9070', baseZ: 4, window: '#54382a' },
  t2: { wall: '#8a5c3b', roof: '#54382a', base: '#8d8a80', baseZ: 12, window: '#3e4a5c' },
  t3: { wall: '#8a5c3b', roof: '#9c5347', base: '#8d8a80', baseZ: 0.3, window: '#e8b45a' },
};
const R = Object.fromEntries(['#8a5c3b', '#c2a05e', '#9b9070', '#54382a', '#8d8a80', '#9c5347', '#3e4a5c', '#e8b45a', '#ccbfa3', '#6f7f4e', '#c9c0ae', '#2f4a52', '#7f8791'].map((h) => [h, ramp(h)]));
const C = (hex, step) => R[hex][step];

// ----------------------------------------------------------------------------- recipe

export function resolveTier(tiers, key) {
  const t = tiers[key];
  const base = t.inherits ? resolveTier(tiers, t.inherits) : { wall: 0, roof: 'none', walls: 'solid', material: 't1', features: [] };
  return {
    wall: t.wall ?? base.wall, roof: t.roof ?? base.roof, walls: t.walls ?? base.walls, material: t.material ?? base.material,
    features: [...(t.features ?? base.features), ...(t.add ?? [])], mass: t.mass ?? base.mass,
  };
}

// ----------------------------------------------------------------------------- frame

/**
 * The building's own frame → grid. u runs along the front (0 … W), v from front (0) to back (… D).
 * Rotation 0 fronts the south-west face; each 90° turns the front clockwise seen from above.
 */
function frame(W, D, rot) {
  const toGrid = {
    0: (u, v) => [u, D - v], 90: (u, v) => [v, u], 180: (u, v) => [W - u, v], 270: (u, v) => [D - v, W - u],
  }[rot];
  const du = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] }[rot];
  const dv = { 0: [0, -1], 90: [1, 0], 180: [0, 1], 270: [-1, 0] }[rot];
  const normal = { front: dv.map((x) => -x), back: dv, left: du.map((x) => -x), right: du };
  /** Only south-west (+gy) and south-east (+gx) faces face the camera. */
  const visible = (side) => { const [nx, ny] = normal[side]; return (nx === 1 && ny === 0) || (nx === 0 && ny === 1); };
  const lit = (side) => { const [nx, ny] = normal[side]; return nx === 0 && ny === 1; };
  const box = (u0, u1, v0, v1) => {
    const a = toGrid(u0, v0), b = toGrid(u1, v1);
    return [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  };
  return { toGrid, visible, lit, box, gridW: rot % 180 ? D : W, gridH: rot % 180 ? W : D };
}

// ----------------------------------------------------------------------------- one sprite

export function bake(buildingId, tierKey, rot) {
  const def = buildings.find((b) => b.id === buildingId);
  const t = resolveTier(recipes[buildingId].tiers, tierKey);
  const W = def.footprint.width, D = def.footprint.height;
  const F = frame(W, D, rot);
  const mat = MATERIAL[t.material];
  const has = (type) => t.features.some((f) => f.type === type);
  const find = (type) => t.features.find((f) => f.type === type);

  // The main mass leaves room in front for porches, platforms and the map table.
  const needsFront = has('porch') || has('map_table');
  const [fu0, fu1, fv0, fv1] = t.mass ?? [0.06, 0.94, needsFront ? 0.34 : 0.08, 0.92];
  const M = { u0: fu0 * W, u1: fu1 * W, v0: fv0 * D, v1: fv1 * D };
  const lift = has('stilts') ? 18 : 0;
  const Z = t.wall;
  const rise = Math.round(0.42 * Math.min(M.u1 - M.u0, M.v1 - M.v0) * HW);
  const roofR = { gable: rise, hip: rise, canvas: Math.round(rise * 0.5), awning: 0, flat: 0, none: 0 }[t.roof];
  const tallest = Math.max(0, ...t.features.map((f) => (f.type === 'tower' ? (f.rise ?? 80) + 16 : f.type === 'stone' ? 40 : f.type === 'chimney' ? (f.rise ?? 48) + 6 : f.type === 'vent' ? 82 : f.type === 'lantern' ? 60 : f.type === 'lookout' ? (f.rise ?? 80) + 30 : f.type === 'arch' ? 80 : 0)));
  const maxZ = lift + Z + roofR + Math.max(tallest, has('windows_row') ? 30 : 0) + 24;
  const pad = 8;
  const width = (F.gridW + F.gridH) * HW + 2 * pad;
  const height = (F.gridW + F.gridH) * HH + maxZ + 2 * pad;
  const { img, S } = isoCanvas(width, height, F.gridH * HW + pad, maxZ + pad);

  // A prism in the building's frame: u0..u1, v0..v1, z0..z1. Faces lit by the §7 rig.
  const prism = (u0, u1, v0, v1, z0, z1, hex, { top = true } = {}) => {
    const [gx0, gx1, gy0, gy1] = F.box(u0, u1, v0, v1);
    const edge = C(hex, 0);
    face(img, [S(gx1, gy0, z0), S(gx1, gy1, z0), S(gx1, gy1, z1), S(gx1, gy0, z1)], C(hex, 1), edge); // south-east
    face(img, [S(gx0, gy1, z0), S(gx1, gy1, z0), S(gx1, gy1, z1), S(gx0, gy1, z1)], C(hex, 2), edge); // south-west
    if (top) face(img, [S(gx0, gy0, z1), S(gx1, gy0, z1), S(gx1, gy1, z1), S(gx0, gy1, z1)], C(hex, 3), edge);
  };
  // A flat decal on one side face of a box, spanning a along the face and z0..z1 in height.
  const decal = (side, bx, a0, a1, z0, z1, hex) => {
    if (!F.visible(side)) return;
    const pts = side === 'front' || side === 'back'
      ? [[a0, side === 'front' ? bx.v0 : bx.v1], [a1, side === 'front' ? bx.v0 : bx.v1]]
      : [[side === 'left' ? bx.u0 : bx.u1, a0], [side === 'left' ? bx.u0 : bx.u1, a1]];
    const [p, q] = pts.map(([u, v]) => F.toGrid(u, v));
    face(img, [S(p[0], p[1], z0), S(q[0], q[1], z0), S(q[0], q[1], z1), S(p[0], p[1], z1)], hex, null);
  };
  const corner = (name, size) => {
    const s = Math.min(size, (M.u1 - M.u0) * 0.4, (M.v1 - M.v0) * 0.4);
    const map = {
      'back-left': [M.u0, M.u0 + s, M.v1 - s, M.v1], 'back-right': [M.u1 - s, M.u1, M.v1 - s, M.v1],
      'front-left': [M.u0, M.u0 + s, M.v0, M.v0 + s], 'front-right': [M.u1 - s, M.u1, M.v0, M.v0 + s],
      centre: [(M.u0 + M.u1) / 2 - s / 2, (M.u0 + M.u1) / 2 + s / 2, (M.v0 + M.v1) / 2 - s / 2, (M.v0 + M.v1) / 2 + s / 2],
    };
    return map[name ?? 'back-right'];
  };
  const [gx0, gx1, gy0, gy1] = F.box(M.u0, M.u1, M.v0, M.v1);
  const nearKey = (u0, u1, v0, v1) => { const [, a, , b] = F.box(u0, u1, v0, v1); return a + b; };

  // Draw order: painter's algorithm on the near corner (gx + gy); roof-top items after the roof.
  const drawables = [];
  const push = (key, draw, order = 1) => drawables.push({ key, order, draw });

  // --- ground-level features outside or beside the mass
  for (const f of t.features) {
    const uc = (M.u0 + M.u1) / 2;
    if (f.type === 'chimney') {
      const [a, b, c, d] = corner(f.corner, 0.55);
      push(nearKey(a, b, c, d), () => { prism(a, b, c, d, lift, lift + Z + roofR + (f.rise ?? 48), '#9c5347'); prism(a - 0.03, b + 0.03, c - 0.03, d + 0.03, lift + Z + roofR + (f.rise ?? 48), lift + Z + roofR + (f.rise ?? 48) + 6, '#3e4a5c'); });
    } else if (f.type === 'flue') {
      const [a, b, c, d] = corner(f.corner, 0.2);
      push(nearKey(a, b, c, d), () => prism(a, b, c, d, lift, lift + Z + roofR * 0.7, '#8d8a80'));
    } else if (f.type === 'arch') {
      // recruitment: a freestanding gateway in front — posts and a lintel above the eave line
      const uc = (M.u0 + M.u1) / 2, g = Math.min(0.55, (M.u1 - M.u0) * 0.3);
      push(nearKey(uc - g, uc + g, 0.0, 0.07), () => {
        // the front projects ~32 px lower than the ridge, so the gate must clear it by much more
        const gt = lift + Z + roofR + 72;
        prism(uc - g - 0.08, uc - g, 0.0, 0.07, 0, gt, '#54382a');
        prism(uc + g, uc + g + 0.08, 0.0, 0.07, 0, gt, '#54382a');
        prism(uc - g - 0.18, uc + g + 0.18, 0.0, 0.07, gt - 14, gt + 2, '#8a5c3b');
        prism(uc - 0.2, uc + 0.2, 0.01, 0.06, gt - 40, gt - 16, '#ccbfa3');
      });
    } else if (f.type === 'windows_row') {
      // housing: a washing line strung beside the front — the domestic rhythm at ground level
      const u0 = M.u1 - Math.min(1.4, (M.u1 - M.u0) * 0.55);
      push(nearKey(u0, M.u1, 0.0, 0.05), () => {
        prism(u0, u0 + 0.05, 0.0, 0.05, 0, 40, '#54382a'); prism(M.u1 - 0.05, M.u1, 0.0, 0.05, 0, 40, '#54382a');
        prism(u0 + 0.05, M.u1 - 0.05, 0.01, 0.03, 36, 37, '#54382a');
        for (let i = 0; i < 3; i++) { const a = u0 + 0.15 + i * (M.u1 - u0 - 0.3) / 3; prism(a, a + 0.18, 0.012, 0.028, 18, 36, ['#ccbfa3', '#c9c0ae', '#8d8a80'][i]); }
      });
    } else if (f.type === 'tower' && f.corner !== 'centre') {
      const [a, b, c, d] = corner(f.corner, Math.min(1.1, W * 0.36));
      const top = Z + roofR + (f.rise ?? 80);
      push(nearKey(a, b, c, d), () => {
        prism(a, b, c, d, 0, top, mat.wall);
        const [tx0, tx1, ty0, ty1] = F.box(a, b, c, d), ax = (tx0 + tx1) / 2, ay = (ty0 + ty1) / 2, cap = top + 26;
        face(img, [S(tx0, ty0, top), S(tx1, ty0, top), S(ax, ay, cap)], C(mat.roof, 1), C(mat.roof, 0));
        face(img, [S(tx0, ty0, top), S(tx0, ty1, top), S(ax, ay, cap)], C(mat.roof, 1), C(mat.roof, 0));
        face(img, [S(tx1, ty0, top), S(tx1, ty1, top), S(ax, ay, cap)], C(mat.roof, 2), C(mat.roof, 0));
        face(img, [S(tx0, ty1, top), S(tx1, ty1, top), S(ax, ay, cap)], C(mat.roof, 3), C(mat.roof, 0));
      });
    } else if (f.type === 'banner') {
      const u = M.u0 + 0.05, v = Math.max(0.04, M.v0 - 0.12);
      push(nearKey(u, u + 0.06, v, v + 0.06) + 0.01, () => { prism(u, u + 0.05, v, v + 0.05, 0, Z * 0.95, '#54382a'); prism(u + 0.05, u + 0.3, v, v + 0.03, Z * 0.45, Z * 0.9, '#9c5347'); });
    } else if (f.type === 'map_table') {
      push(nearKey(uc - 0.5, uc + 0.5, 0.04, M.v0 - 0.06), () => {
        prism(uc - 0.55, uc - 0.5, 0.06, 0.1, 0, 34, '#54382a'); prism(uc + 0.5, uc + 0.55, 0.06, 0.1, 0, 34, '#54382a');
        prism(uc - 0.35, uc + 0.35, 0.1, M.v0 - 0.08, 0, 14, '#8a5c3b');
        prism(uc - 0.6, uc + 0.6, 0.04, M.v0 - 0.02, 32, 35, '#ccbfa3');
      });
    } else if (f.type === 'porch') {
      push(nearKey(M.u0, M.u1, 0.04, M.v0), () => {
        prism(M.u0, M.u1, 0.04, M.v0, 0, 5, '#8a5c3b');
        prism(M.u0 + 0.04, M.u0 + 0.1, 0.06, 0.12, 5, Z * 0.72, '#54382a'); prism(M.u1 - 0.1, M.u1 - 0.04, 0.06, 0.12, 5, Z * 0.72, '#54382a');
        prism(M.u0 - 0.04, M.u1 + 0.04, 0.02, M.v0, Z * 0.72, Z * 0.72 + 5, mat.roof);
        for (let i = 0; i < 4; i++) { const u = M.u0 + 0.3 + i * (M.u1 - M.u0 - 0.6) / 3; prism(u, u + 0.06, 0.14, 0.18, Z * 0.5, Z * 0.7, '#6f7f4e'); }
      });
    } else if (f.type === 'stone') {
      push(nearKey(0.1, 0.34, 0.1, 0.28), () => prism(0.1, 0.34, 0.1, 0.28, 0, Z + 40, '#8d8a80'));
    } else if (f.type === 'brazier') {
      push(nearKey(0.46, 0.62, 0.1, 0.26), () => { prism(0.46, 0.62, 0.1, 0.26, 0, 14, '#3e4a5c', { top: false }); prism(0.48, 0.6, 0.12, 0.24, 14, 17, '#e8b45a'); });
    } else if (f.type === 'platform') {
      push(nearKey(M.u0, M.u1, 0.02, M.v0 - 0.02), () => prism(M.u0, M.u1, 0.02, M.v0 - 0.02, 0, 10, '#54382a'));
    } else if (f.type === 'logs') {
      push(nearKey(0.15, 0.95, 0.08, 0.34) + 0.02, () => { for (let i = 0; i < 3; i++) prism(0.15 + i * 0.04, 0.95, 0.08 + i * 0.08, 0.16 + i * 0.08, 10 + (2 - i) * 9, 19 + (2 - i) * 9, '#8a5c3b'); });
    } else if (f.type === 'stonepile') {
      push(nearKey(W - 1.1, W - 0.2, 0.08, 0.34) + 0.02, () => { prism(W - 1.1, W - 0.2, 0.08, 0.34, 10, 24, '#7f8791'); prism(W - 0.9, W - 0.45, 0.12, 0.28, 24, 34, '#7f8791'); });
    } else if (f.type === 'crates') {
      push(nearKey(0.2, 1.6, 0.06, 0.34) + 0.02, () => { prism(0.2, 0.46, 0.06, 0.3, 10, 30, '#8a5c3b'); prism(0.56, 0.8, 0.08, 0.3, 10, 28, '#c2a05e'); prism(0.25, 0.44, 0.1, 0.28, 30, 46, '#8a5c3b'); });
    } else if (f.type === 'frames') {
      for (const u of [0.15, 0.6 * W]) push(nearKey(u, u + 0.5, 0.1, 0.16), () => { prism(u, u + 0.05, 0.1, 0.16, 0, 44, '#54382a'); prism(u + 0.45, u + 0.5, 0.1, 0.16, 0, 44, '#54382a'); prism(u + 0.05, u + 0.45, 0.11, 0.14, 10, 40, '#ccbfa3'); });
    } else if (f.type === 'trough') {
      push(nearKey(M.u1 - 0.7, M.u1 - 0.1, 0.0, 0.07), () => { prism(M.u1 - 0.7, M.u1 - 0.1, 0.0, 0.07, 0, 10, '#8a5c3b', { top: false }); prism(M.u1 - 0.68, M.u1 - 0.12, 0.01, 0.06, 10, 10, '#2f4a52'); });
    } else if (f.type === 'stair') {
      for (let i = 0; i < 5; i++) { const v0 = M.v0 + i * (M.v1 - M.v0) / 5; push(nearKey(M.u1, M.u1 + 0.18, v0, v0 + 0.14), () => prism(M.u1, M.u1 + 0.18, v0, v0 + 0.14, 0, 12 + i * (Z / 5), '#8a5c3b')); }
    } else if (f.type === 'well') {
      push(nearKey(0.25, 0.75, 0.25, 0.75), () => {
        prism(0.25, 0.75, 0.25, 0.75, 0, 18, '#8d8a80'); prism(0.3, 0.7, 0.3, 0.7, 18, 18, '#2f4a52');
        prism(0.16, 0.22, 0.46, 0.54, 0, 48, '#54382a'); prism(0.78, 0.84, 0.46, 0.54, 0, 48, '#54382a'); prism(0.16, 0.84, 0.47, 0.53, 44, 48, '#8a5c3b');
      });
    } else if (f.type === 'fence') {
      const posts = [];
      for (let i = 0; i <= 6; i++) { const u = (W * i) / 6; posts.push([u, 0.02], [u, D - 0.02]); }
      for (let i = 1; i < 6; i++) { const v = (D * i) / 6; posts.push([0.02, v], [W - 0.02, v]); }
      for (const [u, v] of posts) push(nearKey(u - 0.04, u + 0.04, v - 0.04, v + 0.04), () => prism(Math.max(0, u - 0.04), Math.min(W, u + 0.04), Math.max(0, v - 0.04), Math.min(D, v + 0.04), 0, 22, '#54382a'));
      push(nearKey(0, W, 0, 0.04), () => prism(0.02, W - 0.02, 0.0, 0.03, 14, 18, '#8a5c3b'), 2);
      push(nearKey(W - 0.03, W, 0, D), () => prism(W - 0.03, W, 0.02, D - 0.02, 14, 18, '#8a5c3b'), 2);
    } else if (f.type === 'posts') {
      for (const [u, v] of [[W * 0.35, D * 0.4], [W * 0.5, D * 0.6], [W * 0.65, D * 0.4]]) push(nearKey(u, u + 0.1, v, v + 0.1), () => prism(u, u + 0.1, v, v + 0.1, 0, 46, '#8a5c3b'));
    } else if (f.type === 'rack') {
      push(nearKey(W - 1, W - 0.3, D - 0.4, D - 0.3), () => { prism(W - 1, W - 0.3, D - 0.4, D - 0.32, 0, 12, '#54382a'); for (let i = 0; i < 4; i++) prism(W - 0.95 + i * 0.17, W - 0.91 + i * 0.17, D - 0.39, D - 0.34, 0, 44, '#c9c0ae'); });
    } else if (f.type === 'drying_rack') {
      push(nearKey(0.1, 0.9, 0.1, 0.16), () => { prism(0.1, 0.15, 0.1, 0.16, 0, 40, '#54382a'); prism(0.85, 0.9, 0.1, 0.16, 0, 40, '#54382a'); prism(0.15, 0.85, 0.11, 0.14, 36, 40, '#8a5c3b'); prism(0.25, 0.5, 0.115, 0.135, 14, 36, '#c9c0ae'); prism(0.55, 0.78, 0.115, 0.135, 18, 36, '#c9c0ae'); });
    } else if (f.type === 'firepit') {
      push(nearKey(W - 0.7, W - 0.3, 0.1, 0.4), () => { prism(W - 0.7, W - 0.3, 0.1, 0.4, 0, 6, '#8d8a80'); prism(W - 0.62, W - 0.38, 0.16, 0.34, 6, 10, '#e8b45a'); });
    }
  }

  // --- the main mass, its roof and the decals on its faces
  push(gx1 + gy1, () => {
    if (t.walls === 'solid') {
      const baseTop = t.material === 't3' ? Math.round(Z * mat.baseZ) : mat.baseZ;
      if (lift) for (const [a, b] of [[M.u0, M.v0], [M.u1 - 0.08, M.v0], [M.u0, M.v1 - 0.08], [M.u1 - 0.08, M.v1 - 0.08]]) prism(a, a + 0.08, b, b + 0.08, 0, lift, '#54382a');
      prism(M.u0, M.u1, M.v0, M.v1, lift, lift + baseTop, mat.base, { top: false });
      prism(M.u0, M.u1, M.v0, M.v1, lift + baseTop, lift + Z, mat.wall, { top: t.roof === 'flat' || t.roof === 'none' });
    } else if (t.walls === 'open') {
      for (const [a, b] of [[M.u0, M.v0], [M.u1 - 0.08, M.v0], [M.u0, M.v1 - 0.08], [M.u1 - 0.08, M.v1 - 0.08]]) prism(a, a + 0.08, b, b + 0.08, 0, Z, '#54382a');
      if (has('map_table') || t.roof === 'canvas') prism(M.u0 + 0.2, M.u1 - 0.2, M.v0 + 0.2, M.v1 - 0.2, 0, 14, '#8a5c3b');
    } else if (t.walls === 'stakes') {
      const n = Math.round(W * 4);
      for (let i = n - 1; i >= 0; i--) {
        const u = (W * i) / n, vc = D / 2;
        const [sx0, sx1, sy0, sy1] = F.box(u, u + W / n - 0.02, vc - 0.12, vc + 0.12);
        prism(u, u + W / n - 0.02, vc - 0.12, vc + 0.12, 0, Z, mat.wall, { top: false });
        const ax = (sx0 + sx1) / 2, ay = (sy0 + sy1) / 2;
        face(img, [S(sx0, sy1, Z), S(sx1, sy1, Z), S(ax, ay, Z + 16)], C(mat.wall, 2), C(mat.wall, 0));
        face(img, [S(sx1, sy0, Z), S(sx1, sy1, Z), S(ax, ay, Z + 16)], C(mat.wall, 1), C(mat.wall, 0));
      }
    }
    const zr = lift + Z;
    const rc = mat.roof === '#c2a05e' && t.roof === 'canvas' ? '#ccbfa3' : t.roof === 'canvas' || t.roof === 'awning' ? '#ccbfa3' : mat.roof;
    if (t.roof === 'gable') {
      const dx = gx1 - gx0, dy = gy1 - gy0;
      if (dx >= dy) {
        const gm = (gy0 + gy1) / 2;
        face(img, [S(gx0, gy0, zr), S(gx1, gy0, zr), S(gx1, gm, zr + roofR), S(gx0, gm, zr + roofR)], C(rc, 1), C(rc, 0));
        face(img, [S(gx1, gy0, zr), S(gx1, gy1, zr), S(gx1, gm, zr + roofR)], C(mat.wall, 1), C(mat.wall, 0));
        face(img, [S(gx0, gy1, zr), S(gx1, gy1, zr), S(gx1, gm, zr + roofR), S(gx0, gm, zr + roofR)], C(rc, 3), C(rc, 0));
      } else {
        const gm = (gx0 + gx1) / 2;
        face(img, [S(gx0, gy0, zr), S(gx0, gy1, zr), S(gm, gy1, zr + roofR), S(gm, gy0, zr + roofR)], C(rc, 1), C(rc, 0));
        face(img, [S(gx1, gy0, zr), S(gx1, gy1, zr), S(gm, gy1, zr + roofR), S(gm, gy0, zr + roofR)], C(rc, 2), C(rc, 0));
        face(img, [S(gx0, gy1, zr), S(gx1, gy1, zr), S(gm, gy1, zr + roofR)], C(mat.wall, 2), C(mat.wall, 0));
      }
    } else if (t.roof === 'hip' || t.roof === 'canvas') {
      const ax = (gx0 + gx1) / 2, ay = (gy0 + gy1) / 2, top = zr + roofR;
      face(img, [S(gx0, gy0, zr), S(gx1, gy0, zr), S(ax, ay, top)], C(rc, 1), C(rc, 0));
      face(img, [S(gx0, gy0, zr), S(gx0, gy1, zr), S(ax, ay, top)], C(rc, 1), C(rc, 0));
      face(img, [S(gx1, gy0, zr), S(gx1, gy1, zr), S(ax, ay, top)], C(rc, 2), C(rc, 0));
      face(img, [S(gx0, gy1, zr), S(gx1, gy1, zr), S(ax, ay, top)], C(rc, 3), C(rc, 0));
    } else if (t.roof === 'awning') {
      prism(M.u0 - 0.04, M.u1 + 0.04, Math.max(0, M.v0 - 0.3), M.v1, zr, zr + 5, rc);
    }
    const body = { u0: M.u0, u1: M.u1, v0: M.v0, v1: M.v1 };
    const uc = (M.u0 + M.u1) / 2;
    const doorTop = lift + Math.min(Z * 0.62, 58);
    if (t.walls === 'solid') {
      if (has('counter')) { decal('front', body, M.u0 + 0.12, M.u1 - 0.12, lift + Z * 0.42, lift + Z * 0.86, C('#54382a', 0)); decal('front', body, M.u0 + 0.1, M.u1 - 0.1, lift + Z * 0.38, lift + Z * 0.44, C('#8a5c3b', 3)); }
      if (has('arch')) decal('front', body, uc - 0.3, uc + 0.3, lift, lift + Z * 0.72, C('#54382a', 0));
      if (has('door')) decal('front', body, uc - 0.13, uc + 0.13, lift, doorTop, C('#54382a', t.material === 't3' ? 1 : 0));
      if (has('trophy')) decal('front', body, uc - 0.12, uc + 0.12, doorTop + 6, doorTop + 20, C('#c9c0ae', 2));
      if (has('notice')) decal('front', body, M.u0 + 0.16, M.u0 + 0.42, lift + Z * 0.34, lift + Z * 0.62, C('#ccbfa3', 2));
      if (has('forge')) decal(F.visible('right') ? 'right' : 'front', body, (F.visible('right') ? M.v0 : M.u1 - 0.55) + 0.05, (F.visible('right') ? M.v0 : M.u1 - 0.55) + 0.35, lift + 6, lift + 26, C('#e8b45a', 2));
      const row = has('windows_row'), any = has('windows') || row;
      if (any) {
        const winZ0 = lift + Z * (row ? 0.46 : 0.5), winZ1 = lift + Z * (row ? 0.72 : 0.7);
        for (const side of ['front', 'back', 'left', 'right']) {
          if (!F.visible(side)) continue;
          const along = side === 'front' || side === 'back' ? [M.u0, M.u1] : [M.v0, M.v1];
          const n = Math.max(1, Math.round((along[1] - along[0]) * (row ? 2 : 1)));
          for (let i = 0; i < n; i++) {
            const c = along[0] + ((i + 0.5) * (along[1] - along[0])) / n;
            if (side === 'front' && (has('door') || has('arch') || has('counter')) && Math.abs(c - uc) < 0.4) continue;
            decal(side, body, c - (row ? 0.09 : 0.11), c + (row ? 0.09 : 0.11), winZ0, winZ1, t.material === 't3' ? C('#e8b45a', 2) : C(mat.window, 0));
          }
        }
      }
    }
  }, 0);

  // --- roof-top items, drawn after the roof
  const top = lift + Z + roofR;
  for (const f of t.features) {
    if (f.type === 'vent') push(Infinity, () => {
      const uc = (M.u0 + M.u1) / 2, vc = (M.v0 + M.v1) / 2;
      prism(uc - 0.16, uc + 0.16, vc - 0.05, vc + 0.22, top - roofR * 0.3, top + 10, '#8a5c3b');
      [[0.12, 14, 30], [0.2, 32, 50], [0.28, 52, 72]].forEach(([r, z0, z1], i) => prism(uc - r + i * 0.06, uc + r + i * 0.06, vc - r * 0.7, vc + r * 0.7, top + z0, top + z1, '#ccbfa3'));
    }, 3);
    if (f.type === 'lantern') push(Infinity, () => { const uc = (M.u0 + M.u1) / 2, vc = (M.v0 + M.v1) / 2; const lb = { u0: uc - 0.38, u1: uc + 0.38, v0: vc - 0.26, v1: vc + 0.26 }; prism(lb.u0, lb.u1, lb.v0, lb.v1, top - roofR * 0.35, top + 30, '#8a5c3b'); for (const s of ['front', 'right', 'left', 'back']) decal(s, lb, (s === 'front' || s === 'back' ? uc : vc) - 0.2, (s === 'front' || s === 'back' ? uc : vc) + 0.2, top + 6, top + 24, C('#e8b45a', 2)); prism(lb.u0 - 0.04, lb.u1 + 0.04, lb.v0 - 0.04, lb.v1 + 0.04, top + 30, top + 36, '#54382a'); prism(uc - 0.025, uc + 0.025, vc - 0.025, vc + 0.025, top + 36, top + 58, '#3e4a5c'); prism(uc, uc + 0.22, vc - 0.015, vc + 0.015, top + 50, top + 56, '#3e4a5c'); }, 3);
    if (f.type === 'lookout' || (f.type === 'tower' && f.corner === 'centre')) {
      const [a, b, c, d] = corner('centre', Math.min(M.u1 - M.u0, M.v1 - M.v0) * 0.9);
      const tz = Z + (f.rise ?? 80);
      push(Infinity, () => prism(a, b, c, d, Z, tz, mat.wall), 3);
      if (has('merlons')) push(Infinity, () => merlons({ u0: a, u1: b, v0: c, v1: d }, tz), 4);
    }
  }
  if (has('windows_row') && t.roof === 'gable') {
    const n = Math.max(2, Math.round((M.u1 - M.u0) * 1.2));
    for (let i = 0; i < n; i++) {
      const c = M.u0 + ((i + 0.5) * (M.u1 - M.u0)) / n, dv = Math.min(0.38, (M.v1 - M.v0) * 0.3);
      push(Infinity, () => {
        const vc = (M.v0 + M.v1) / 2, zr0 = lift + Z + roofR * 0.55, zb = lift + Z + roofR + 8;
        prism(c - 0.16, c + 0.16, vc - dv / 2, vc + dv / 2, zr0, zb, mat.wall);
        decal('front', { u0: c - 0.16, u1: c + 0.16, v0: vc - dv / 2, v1: vc + dv / 2 }, c - 0.07, c + 0.07, zr0 + 6, zb - 6, C(mat.window, 0));
        const [a0, a1, b0, b1] = F.box(c - 0.2, c + 0.2, vc - dv / 2 - 0.04, vc + dv / 2 + 0.04), ax = (a0 + a1) / 2, ay = (b0 + b1) / 2;
        face(img, [S(a0, b0, zb), S(a1, b0, zb), S(ax, ay, zb + 16)], C(mat.roof, 1), C(mat.roof, 0));
        face(img, [S(a0, b0, zb), S(a0, b1, zb), S(ax, ay, zb + 16)], C(mat.roof, 1), C(mat.roof, 0));
        face(img, [S(a1, b0, zb), S(a1, b1, zb), S(ax, ay, zb + 16)], C(mat.roof, 2), C(mat.roof, 0));
        face(img, [S(a0, b1, zb), S(a1, b1, zb), S(ax, ay, zb + 16)], C(mat.roof, 3), C(mat.roof, 0));
      }, 2);
    }
  }
  if (has('merlons') && !has('lookout') && !t.features.some((f) => f.type === 'tower' && f.corner === 'centre')) {
    const bx = t.walls === 'stakes' ? { u0: 0, u1: W, v0: D / 2 - 0.12, v1: D / 2 + 0.12 } : { u0: M.u0, u1: M.u1, v0: M.v0, v1: M.v1 };
    push(Infinity, () => merlons(bx, lift + Z + (t.walls === 'stakes' ? 10 : 0)), 4);
  }
  function merlons(bx, z) {
    const step = 0.3;
    for (const side of ['back', 'left', 'right', 'front']) {
      const along = side === 'front' || side === 'back' ? [bx.u0, bx.u1] : [bx.v0, bx.v1];
      for (let a = along[0]; a < along[1] - 0.05; a += step) {
        const b = Math.min(a + 0.15, along[1]);
        const [u0, u1, v0, v1] = side === 'front' ? [a, b, bx.v0, bx.v0 + 0.12] : side === 'back' ? [a, b, bx.v1 - 0.12, bx.v1] : side === 'left' ? [bx.u0, bx.u0 + 0.12, a, b] : [bx.u1 - 0.12, bx.u1, a, b];
        prism(u0, u1, v0, v1, z, z + 14, t.material === 't1' ? '#8a5c3b' : '#8d8a80');
      }
    }
  }

  drawables.sort((a, b) => a.key - b.key || a.order - b.order).forEach((d) => d.draw());
  outlineSilhouette(img);
  const pivot = S(F.gridW / 2, F.gridH / 2, 0).map(Math.round);
  return { img, pivot, footprint: [F.gridW, F.gridH] };
}

// ----------------------------------------------------------------------------- run

function blackFill(img) {
  const out = blank(img.width, img.height);
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] === 255) { out.data[i] = 30; out.data[i + 1] = 30; out.data[i + 2] = 34; out.data[i + 3] = 255; }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(QA, { recursive: true });
  const index = { tileHalf: [HW, HH], note: 'Greybox sprites baked from src/data/town/building-art.json. Pivot is the footprint centre on the ground, at @2x.', buildings: {} };
  let count = 0;
  for (const b of buildings) {
    index.buildings[b.id] = {};
    for (const key of Object.keys(recipes[b.id].tiers)) {
      index.buildings[b.id][key] = {};
      for (const rot of ROTATIONS) {
        const { img, pivot, footprint } = bake(b.id, key, rot);
        const file = `bld_${b.id}_t${key}_r${rot}@2x.png`;
        writeFileSync(join(OUT, file), encodePng(img));
        index.buildings[b.id][key][rot] = { file, width: img.width, height: img.height, pivot, footprint };
        count++;
      }
    }
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');

  // The ten-category line-up (specs/04 §1.3): one building per category, rotation 0.
  const LINEUP = [['guild_hall', '3'], ['bunkhouse', '2'], ['field_kitchen', '2'], ['infirmary', '3'], ['shrine', '1'], ['smithy', '2'], ['lumber_yard', '2'], ['research_annex', '2'], ['watchtower', '2'], ['recruitment_hall', '1']];
  const lineup = LINEUP.map(([id, t]) => bake(id, t, 0).img);
  writeFileSync(join(QA, 'category_lineup.png'), encodePng(qaSheet(lineup)));
  writeFileSync(join(QA, 'category_lineup_silhouette.png'), encodePng(qaSheet([...lineup.map(blackFill), ...lineup.map((i) => scaleNearest(blackFill(i), 0.55))], '#ccbfa3')));
  writeFileSync(join(QA, 'guild_hall_tiers.png'), encodePng(qaSheet(['1', '2', '3'].map((t) => bake('guild_hall', t, 0).img))));
  writeFileSync(join(QA, 'guild_hall_rotations.png'), encodePng(qaSheet(ROTATIONS.map((r) => bake('guild_hall', '3', r).img))));
  console.log(`baked ${count} sprites (${buildings.length} buildings, all tiers, 4 rotations) → ${OUT}`);
}
