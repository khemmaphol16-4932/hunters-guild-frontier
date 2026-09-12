import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decodePng, encodePng, blank } from '../../tools/png.mjs';
import { bbox } from '../../tools/sprite.mjs';
import { ramp, toRgb } from '../../tools/palette.mjs';
import { fillPoly, line } from '../../tools/iso.mjs';

const OUT = 'art/generated/gate-sheets-corrected-v2';
mkdirSync(OUT, { recursive: true });
const stone = ramp('#8d8a80');
const skin = ramp('#ccbfa3');
const timber = ramp('#8a5c3b');
const moss = ramp('#6f7f4e');

function px(img, x, y, hex, a = 255) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const [r, g, b] = toRgb(hex), o = (y * img.width + x) * 4;
  img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = a;
}

function diamond(img, cx, cy, w, h, fill, edge) {
  const p = [[cx, cy - h / 2], [cx + w / 2, cy], [cx, cy + h / 2], [cx - w / 2, cy]];
  fillPoly(img, p, fill);
  for (let i = 0; i < 4; i++) line(img, p[i], p[(i + 1) % 4], edge);
}

function ellipse(img, cx, cy, rx, ry, colors, lightX = -0.45, lightY = -0.55) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    const nx = (x - cx) / rx, ny = (y - cy) / ry, d = nx * nx + ny * ny;
    if (d > 1) continue;
    const edge = d > 0.90;
    const light = -(nx * lightX + ny * lightY);
    const band = edge ? 0 : light > 0.45 ? 4 : light > 0.05 ? 3 : light > -0.25 ? 2 : 1;
    px(img, x, y, colors[band]);
  }
}

// REF_LIGHTING_BALL — 3 exact 128×128 panels with 16 transparent pixels between them.
const lighting = blank(416, 128);
for (let p = 0; p < 3; p++) diamond(lighting, p * 144 + 64, 108, 104, 40, stone[2], stone[0]);
ellipse(lighting, 64, 61, 44, 47, stone);

const ox = 144;
fillPoly(lighting, [[ox + 64, 18], [ox + 103, 38], [ox + 64, 58], [ox + 25, 38]], stone[4]);
fillPoly(lighting, [[ox + 25, 38], [ox + 64, 58], [ox + 64, 108], [ox + 25, 88]], stone[3]);
fillPoly(lighting, [[ox + 64, 58], [ox + 103, 38], [ox + 103, 88], [ox + 64, 108]], stone[1]);
for (const [a, b] of [
  [[ox + 64, 18], [ox + 103, 38]], [[ox + 103, 38], [ox + 103, 88]],
  [[ox + 103, 88], [ox + 64, 108]], [[ox + 64, 108], [ox + 25, 88]],
  [[ox + 25, 88], [ox + 25, 38]], [[ox + 25, 38], [ox + 64, 18]],
  [[ox + 25, 38], [ox + 64, 58]], [[ox + 103, 38], [ox + 64, 58]], [[ox + 64, 58], [ox + 64, 108]],
]) line(lighting, a, b, stone[0]);

const cx = 352;
for (let y = 33; y <= 106; y++) for (let x = cx - 30; x <= cx + 30; x++) {
  const nx = (x - cx) / 30;
  const band = Math.abs(nx) > 0.94 ? 0 : nx < -0.35 ? 4 : nx < 0.2 ? 3 : nx < 0.7 ? 2 : 1;
  px(lighting, x, y, stone[band]);
}
ellipse(lighting, cx, 32, 30, 13, stone);
for (let x = cx - 30; x <= cx + 30; x++) { px(lighting, x, 106, stone[0]); }
writeFileSync(`${OUT}/ref_lighting_ball_corrected.png`, encodePng(lighting));

function read(path) { return decodePng(readFileSync(path)); }
function crop(img) {
  const b = bbox(img, 1);
  const out = blank(b.w, b.h);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const s = ((b.y + y) * img.width + b.x + x) * 4, d = (y * out.width + x) * 4;
    for (let k = 0; k < 4; k++) out.data[d + k] = img.data[s + k];
  }
  return out;
}
function resize(img, width, height) {
  const out = blank(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.min(img.width - 1, Math.floor(x * img.width / width));
    const sy = Math.min(img.height - 1, Math.floor(y * img.height / height));
    const s = (sy * img.width + sx) * 4, d = (y * width + x) * 4;
    for (let k = 0; k < 4; k++) out.data[d + k] = img.data[s + k];
  }
  return out;
}
function fitHeight(img, h) { img = crop(img); return resize(img, Math.max(1, Math.round(img.width * h / img.height)), h); }
function fitWidth(img, w) { img = crop(img); return resize(img, w, Math.max(1, Math.round(img.height * w / img.width))); }
function composite(dst, src, cx, baseline) {
  const x0 = Math.round(cx - src.width / 2), y0 = baseline - src.height + 1;
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const s = (y * src.width + x) * 4;
    if (!src.data[s + 3]) continue;
    const dx = x0 + x, dy = y0 + y;
    if (dx < 0 || dy < 0 || dx >= dst.width || dy >= dst.height) continue;
    const d = (dy * dst.width + dx) * 4;
    for (let k = 0; k < 4; k++) dst.data[d + k] = src.data[s + k];
  }
}
function makeElite() {
  const img = blank(72, 112);
  ellipse(img, 36, 14, 13, 14, moss);
  fillPoly(img, [[29, 28], [43, 28], [48, 67], [24, 67]], moss[2]);
  fillPoly(img, [[25, 34], [31, 36], [18, 76], [12, 73]], moss[1]);
  fillPoly(img, [[41, 34], [47, 32], [60, 73], [54, 76]], moss[1]);
  fillPoly(img, [[25, 66], [35, 66], [31, 111], [20, 111]], moss[0]);
  fillPoly(img, [[37, 66], [47, 66], [53, 111], [42, 111]], moss[1]);
  px(img, 25, 111, moss[0]); px(img, 47, 111, moss[1]);
  return img;
}
function makeBoss() {
  const img = blank(256, 220);
  const footprint = [[128, 91], [255, 155], [128, 219], [0, 155]];
  fillPoly(img, footprint, stone[1]);
  for (let i = 0; i < 4; i++) line(img, footprint[i], footprint[(i + 1) % 4], stone[0]);
  fillPoly(img, [[89, 74], [128, 46], [167, 74], [158, 156], [98, 156]], timber[1]);
  fillPoly(img, [[80, 67], [102, 53], [106, 149], [77, 171], [60, 149]], timber[2]);
  fillPoly(img, [[154, 53], [176, 67], [196, 149], [179, 171], [150, 149]], timber[0]);
  fillPoly(img, [[104, 149], [126, 149], [120, 205], [92, 205]], stone[1]);
  fillPoly(img, [[131, 149], [154, 149], [166, 205], [138, 205]], stone[0]);
  ellipse(img, 128, 34, 31, 34, stone);
  return img;
}

// REF_SCALE_LINEUP — 9 exact 320×440 panels, 16 transparent pixels between panels.
const scale = blank(3008, 440); // 9*320 + 8*16
const baseline = 380;
const centers = Array.from({ length: 9 }, (_, i) => i * 336 + 160);
const tile = blank(128, 64);
const tilePoints = [[64, 0], [127, 32], [64, 63], [0, 32]];
fillPoly(tile, tilePoints, stone[2]);
for (let i = 0; i < 4; i++) line(tile, tilePoints[i], tilePoints[(i + 1) % 4], stone[0]);
const hunter = fitHeight(read('art/qa/proof-cycle-rigs-source-v2/hunter_vanguard_skel_idle_se_02@2x.png'), 112);
const npc = fitHeight(read('art/qa/proof-cycle-rigs-source-v2/hunter_adept_skel_idle_se_02@2x.png'), 104);
const trash = fitWidth(read('art/qa/proof-cycle-actors-source-v1/monster_moss_crawler_idle_se_01@2x.png'), 72);
const elite = makeElite();
const boss = makeBoss();
const building = crop(read('art/buildings/greybox/bld_bunkhouse_t1_r0@2x.png'));
const tree = fitHeight(read('art/qa/trees-source-v1/prp_trees_broadleaf_medium_01@2x.png'), 160);
const barrel = fitHeight(read('art/qa/town-props-source-v1/prp_town_basic_barrel_01@2x.png'), 36);
[tile, hunter, npc, trash, elite, boss, building, tree, barrel].forEach((img, i) => composite(scale, img, centers[i], baseline));
writeFileSync(`${OUT}/ref_scale_lineup_corrected.png`, encodePng(scale));

// Compact review copy at exactly 25%, preserving nearest-neighbour pixels.
writeFileSync(`${OUT}/ref_scale_lineup_review.png`, encodePng(resize(scale, 752, 110)));

console.log(`lighting ${lighting.width}x${lighting.height}`);
console.log(`scale ${scale.width}x${scale.height}; baseline ${baseline}; panels 320 with 16 gaps`);
