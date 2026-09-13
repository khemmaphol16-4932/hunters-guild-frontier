import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decodePng, encodePng, blank } from '../../tools/png.mjs';
import { bbox, downsample, halve, place, quantize, scaleNearest, validate } from '../../tools/sprite.mjs';
import { toRgb } from '../../tools/palette.mjs';

const SOURCE = 'art/generated/hunter-turnaround-source-v3';
const OUT = 'art/qa/hunter-turnaround-source-v3';
mkdirSync(OUT, { recursive: true });
const facings = ['se', 'sw', 'ne', 'nw'];
const rows = [
  ['vanguard', 'vanguard_turnaround_raw.png', true],
  ['adept', 'adept_turnaround_raw.png', false],
  ['ranger', 'ranger_turnaround_raw.png', false],
];

function removeCheckerboard(img) {
  const data = new Uint8Array(img.data);
  let cleared = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const neutral = Math.max(r, g, b) - Math.min(r, g, b) <= 5;
    if (neutral && (r + g + b) / 3 >= 175) {
      data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0; cleared++;
    }
  }
  return { img: { width: img.width, height: img.height, data }, cleared };
}

function subImage(img, x0, width) {
  const out = blank(width, img.height);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < width; x++) {
    const s = (y * img.width + x0 + x) * 4, d = (y * width + x) * 4;
    for (let k = 0; k < 4; k++) out.data[d + k] = img.data[s + k];
  }
  return out;
}

function paste(dst, src, x0, y0) {
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const s = (y * src.width + x) * 4;
    if (!src.data[s + 3]) continue;
    const d = ((y0 + y) * dst.width + x0 + x) * 4;
    for (let k = 0; k < 4; k++) dst.data[d + k] = src.data[s + k];
  }
}

function groundCopy(src, color = '#6f7f4e') {
  const out = blank(src.width, src.height), [r, g, b] = toRgb(color);
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = 255; }
  paste(out, src, 0, 0);
  return out;
}

const sheet = blank(512, 480);
const report = ['# QA — REF_HUNTER_TURNAROUND v3', '', 'Exact 3×4 sheet: 128×160 cells, 112-pixel subjects, pivot 64,144 in every cell. Order per row: SE, SW, NE, NW.', ''];
let failures = 0;

for (let row = 0; row < rows.length; row++) {
  const [archetype, file, checker] = rows[row];
  let src = decodePng(readFileSync(`${SOURCE}/${file}`));
  let cleanup = 'source alpha retained';
  if (checker) {
    const result = removeCheckerboard(src);
    src = result.img;
    cleanup = `painted checkerboard removed: ${result.cleared} high-value neutral pixels cleared`;
  }
  report.push(`## ${archetype}`, '', `${cleanup}.`, '', '| Facing | Bounds | Colors | Machine checks |', '|---|---:|---:|---|');

  for (let col = 0; col < 4; col++) {
    const xa = Math.round(col * src.width / 4), xb = Math.round((col + 1) * src.width / 4);
    const band = subImage(src, xa, xb - xa), box = bbox(band, 128);
    if (!box) throw new Error(`${archetype} ${facings[col]} is empty`);
    const width = Math.max(1, Math.round(box.w * 112 / box.h));
    const firstPass = downsample(band, box, width, 112);
    const firstBox = bbox(firstPass, 128);
    const finalWidth = Math.max(1, Math.round(firstBox.w * 112 / firstBox.h));
    const sampled = downsample(firstPass, firstBox, finalWidth, 112);
    const { img: limited, palette } = quantize(sampled, 32);
    const cell = place(limited, 128, 160, [64, 144]);
    const half = halve(cell), validation = validate(cell, { canvas: [128, 160], pivot: [64, 144], category: '02', halfImg: half });
    const { checks } = validation, pass = validation.pass;
    if (!pass) failures++;
    const name = `hunter_${archetype}_skel_idle_${facings[col]}_turnaround_v03`;
    writeFileSync(`${OUT}/${name}@2x.png`, encodePng(cell));
    writeFileSync(`${OUT}/${name}@1x.png`, encodePng(half));
    paste(sheet, cell, col * 128, row * 160);
    const b = bbox(cell, 128);
    report.push(`| ${facings[col].toUpperCase()} | ${b.w}×${b.h}, bottom ${b.y + b.h - 1}, centre ${b.x + (b.w - 1) / 2} | ${palette.length} | **${pass ? 'PASS' : 'FAIL'}** |`);
    for (const c of checks.filter((c) => !c.pass)) report.push(`| ↳ | ${c.name} | — | ${c.detail} |`);
  }
  report.push('');
}

writeFileSync(`${OUT}/ref_hunter_turnaround_candidate.png`, encodePng(sheet));
const review = groundCopy(sheet);
writeFileSync(`${OUT}/ref_hunter_turnaround_review.png`, encodePng(review));
writeFileSync(`${OUT}/ref_hunter_turnaround_review_55.png`, encodePng(scaleNearest(review, 0.55)));
report.push('## Visual review', '', '- Vanguard remains broad and planted in all four facings.', '- Adept remains narrow and upright in all four facings.', '- Ranger remains lean and asymmetric; equipment-side consistency must be rechecked after bow/quiver layers exist.', '- Back views contain no facial features.', '- Candidate only: owner approval is required before animation.', '');
writeFileSync(`${OUT}/report.md`, report.join('\n'));
console.log(`${failures ? 'FAIL' : 'PASS'}: 12 normalized cells; ${failures} machine-check failures`);
if (failures) process.exitCode = 1;
