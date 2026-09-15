import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { blank, decodePng, encodePng } from '../../tools/png.mjs';
import { bbox, contactShadow, downsample, halve, place, qaSheet, quantize, scaleNearest, validate } from '../../tools/sprite.mjs';

const OUT = 'art/qa/thicket-wasp-source-v1';
mkdirSync(OUT, { recursive: true });

function normalize(facing, frame = '01') {
  const suffix = frame === '01' ? '' : facing === 'se' && frame === '02' ? '_frame02-v2' : `_frame${frame}`;
  const source = `art/generated/thicket-wasp-source-v1/thicket_wasp_idle_${facing}${suffix}_candidate.png`;
  // Wing span changes dramatically across the loop. Per-frame source widths keep the body mass
  // stable after reduction; the visual QA strip is the authority for these measured values.
  const targetWidth = frame === '03' ? 72 : frame === '04' ? 55 : 60;
  const raw = decodePng(readFileSync(source));
  const sourceBox = bbox(raw, 128);
  if (!sourceBox) throw new Error(`Thicket Wasp ${facing} source is empty`);
  const firstHeight = Math.round(sourceBox.h * targetWidth / sourceBox.w);
  const firstPass = downsample(raw, sourceBox, targetWidth, firstHeight);
  const firstBox = bbox(firstPass, 128);
  const finalHeight = Math.round(firstBox.h * targetWidth / firstBox.w);
  const sampled = downsample(firstPass, firstBox, targetWidth, finalHeight);
  const { img: limited, palette } = quantize(sampled, 24);
  const sprite = place(limited, 128, 128, [64, 92]);
  const half = halve(sprite);
  const shadow = contactShadow(sprite, [64, 112]);
  const result = validate(sprite, { canvas: [128, 128], category: '03', halfImg: half });
  writeFileSync(`${OUT}/monster_thicket_wasp_idle_${facing}_${frame}@2x.png`, encodePng(sprite));
  writeFileSync(`${OUT}/monster_thicket_wasp_idle_${facing}_${frame}@1x.png`, encodePng(half));
  writeFileSync(`${OUT}/monster_thicket_wasp_idle_${facing}_${frame}_shadow@2x.png`, encodePng(shadow));
  return { source, sprite, palette, result };
}

const se = normalize('se');
const ne = normalize('ne');
const se02 = normalize('se', '02');
const se03 = normalize('se', '03');
const se04 = normalize('se', '04');
const ne02 = normalize('ne', '02');
const ne03 = normalize('ne', '03');
const ne04 = normalize('ne', '04');

function mirror(img) {
  const out = blank(img.width, img.height);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const s = (y * img.width + x) * 4, d = (y * img.width + (img.width - 1 - x)) * 4;
    for (let k = 0; k < 4; k++) out.data[d + k] = img.data[s + k];
  }
  return out;
}

function sheet(frames) {
  const out = blank(frames[0].width * frames.length, frames[0].height);
  frames.forEach((frame, n) => {
    for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
      const s = (y * frame.width + x) * 4, d = (y * out.width + n * frame.width + x) * 4;
      for (let k = 0; k < 4; k++) out.data[d + k] = frame.data[s + k];
    }
  });
  return out;
}

function bodyLockedHover(base, dy, wingDelta) {
  const out = blank(base.width, base.height);
  for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width; x++) {
    const s = (y * base.width + x) * 4;
    if (base.data[s + 3] === 0) continue;
    const ty = y + dy;
    if (ty < 0 || ty >= out.height) continue;
    const d = (ty * out.width + x) * 4;
    const rgb = [base.data[s], base.data[s + 1], base.data[s + 2]];
    const hi = Math.max(...rgb), lo = Math.min(...rgb);
    const isWingInterior = hi - lo < 48 && lo > 105;
    for (let k = 0; k < 3; k++) out.data[d + k] = isWingInterior
      ? Math.max(1, Math.min(254, rgb[k] + wingDelta))
      : rgb[k];
    out.data[d + 3] = 255;
  }
  return out;
}

function writeDerivedFrame(facing, frame, sprite) {
  const half = halve(sprite);
  const result = validate(sprite, { canvas: [128, 128], category: '03', halfImg: half });
  writeFileSync(`${OUT}/monster_thicket_wasp_idle_${facing}_${frame}@2x.png`, encodePng(sprite));
  writeFileSync(`${OUT}/monster_thicket_wasp_idle_${facing}_${frame}@1x.png`, encodePng(half));
  writeFileSync(`${OUT}/monster_thicket_wasp_idle_${facing}_${frame}_shadow@2x.png`, encodePng(contactShadow(sprite, [64, 112])));
  return { sprite, result };
}

const seFrames = [se.sprite, se02.sprite, se03.sprite, se04.sprite];
const swFrames = seFrames.map(mirror);
// Image generation could not preserve the NE body across adjacent frames. Derive the restrained
// hover from the approved base instead: exact body pixels, a 0/-1/-2/-1 bob, and only a subtle
// neutral-wing ramp pulse. This satisfies reduced-motion without risking identity drift.
const neDerived02 = writeDerivedFrame('ne', '02', bodyLockedHover(ne.sprite, -1, -8));
const neDerived03 = writeDerivedFrame('ne', '03', bodyLockedHover(ne.sprite, -2, 6));
const neDerived04 = writeDerivedFrame('ne', '04', bodyLockedHover(ne.sprite, -1, -3));
const neFrames = [ne.sprite, neDerived02.sprite, neDerived03.sprite, neDerived04.sprite];
const nwFrames = neFrames.map(mirror);
writeFileSync(`${OUT}/monster_thicket_wasp_idle_se@2x.png`, encodePng(sheet(seFrames)));
writeFileSync(`${OUT}/monster_thicket_wasp_idle_sw@2x.png`, encodePng(sheet(swFrames)));
writeFileSync(`${OUT}/monster_thicket_wasp_idle_ne@2x.png`, encodePng(sheet(neFrames)));
writeFileSync(`${OUT}/monster_thicket_wasp_idle_nw@2x.png`, encodePng(sheet(nwFrames)));
writeFileSync(`${OUT}/monster_thicket_wasp_idle_se.json`, JSON.stringify({
  frameWidth: 128, frameHeight: 128, frames: 4, pivot: [64, 112], loop: true,
  advance: 'ambient', keyFrame: 1, hoverOffset: 20, mirrorOf: null,
}, null, 2) + '\n');
writeFileSync(`${OUT}/monster_thicket_wasp_idle_sw.json`, JSON.stringify({
  frameWidth: 128, frameHeight: 128, frames: 4, pivot: [64, 112], loop: true,
  advance: 'ambient', keyFrame: 1, hoverOffset: 20, mirrorOf: 'se',
}, null, 2) + '\n');
writeFileSync(`${OUT}/monster_thicket_wasp_idle_ne.json`, JSON.stringify({
  frameWidth: 128, frameHeight: 128, frames: 4, pivot: [64, 112], loop: true,
  advance: 'ambient', keyFrame: 1, hoverOffset: 20, mirrorOf: null,
}, null, 2) + '\n');
writeFileSync(`${OUT}/monster_thicket_wasp_idle_nw.json`, JSON.stringify({
  frameWidth: 128, frameHeight: 128, frames: 4, pivot: [64, 112], loop: true,
  advance: 'ambient', keyFrame: 1, hoverOffset: 20, mirrorOf: 'ne',
}, null, 2) + '\n');
const swarm = { width: 128, height: 128, data: new Uint8Array(128 * 128 * 4) };
for (const [dx, dy] of [[-18, 4], [0, -6], [18, 5]]) {
  for (let y = 0; y < se.sprite.height; y++) for (let x = 0; x < se.sprite.width; x++) {
    const tx = x + dx, ty = y + dy;
    if (tx < 0 || ty < 0 || tx >= swarm.width || ty >= swarm.height) continue;
    const si = (y * se.sprite.width + x) * 4, di = (ty * swarm.width + tx) * 4;
    if (se.sprite.data[si + 3] === 0) continue;
    for (let k = 0; k < 4; k++) swarm.data[di + k] = se.sprite.data[si + k];
  }
}
writeFileSync(`${OUT}/monster_thicket_wasp_idle_facings_qa.png`, encodePng(qaSheet([
  se.sprite, se02.sprite, se03.sprite, se04.sprite, scaleNearest(sheet(seFrames), 0.55),
  ...neFrames, scaleNearest(sheet(neFrames), 0.55),
  swarm, scaleNearest(swarm, 0.55),
])));
writeFileSync(`${OUT}/monster_thicket_wasp_idle_ne_rejected_qa.png`, encodePng(qaSheet([
  ne.sprite, ne02.sprite, ne03.sprite, ne04.sprite,
])));

const pass = [se, se02, se03, se04, ne, neDerived02, neDerived03, neDerived04].every((x) => x.result.pass);
const report = [
  '# QA — Thicket Wasp source v1', '',
  `Sources: \`${se.source}\`, \`${ne.source}\` · deterministic batch-local normalization using \`art/tools/sprite.mjs\`.`, '',
  '| | |', '|---|---|',
  `| SE output | subject ${se.result.bbox.w}×${se.result.bbox.h} on 128×128 |`,
  `| SE frame 02 | subject ${se02.result.bbox.w}×${se02.result.bbox.h} on 128×128 |`,
  `| SE frame 03 | subject ${se03.result.bbox.w}×${se03.result.bbox.h} on 128×128 |`,
  `| SE frame 04 | subject ${se04.result.bbox.w}×${se04.result.bbox.h} on 128×128 |`,
  `| NE output | subject ${ne.result.bbox.w}×${ne.result.bbox.h} on 128×128 |`,
  `| NE derived frames 02–04 | ${[neDerived02, neDerived03, neDerived04].map((x) => `${x.result.bbox.w}×${x.result.bbox.h}`).join(', ')} |`,
  '| Hover | sprite bottom y=92; ground pivot `(64,112)`; 20 px @2x offset |',
  `| Palette | SE frames ${[se, se02, se03, se04].map((x) => x.palette.length).join('/')}; NE frames ${[ne, neDerived02, neDerived03, neDerived04].map((x) => x.result.colours).join('/')} colors |`,
  `| Machine checks | **${pass ? 'PASS' : 'FAIL'}** — all four facings; SE/NE authored bases, SW/NW mirrors |`,
  '| Human review | Codex: **PASS candidate.** SE uses four generated wing poses; NE uses the approved base with an exact body-locked 0/-1/-2/-1 hover and restrained wing-ramp pulse. Both mirror safely, retain four wings, and remain countable at 55%. The three rejected NE generations remain provenance only. |',
  '| Promoted | no |', '',
  ...se.result.checks.map((c) => `- ${c.pass ? '✅' : '❌'} SE ${c.name} — ${c.detail}`),
  ...se02.result.checks.map((c) => `- ${c.pass ? '✅' : '❌'} SE-02 ${c.name} — ${c.detail}`),
  ...se03.result.checks.map((c) => `- ${c.pass ? '✅' : '❌'} SE-03 ${c.name} — ${c.detail}`),
  ...se04.result.checks.map((c) => `- ${c.pass ? '✅' : '❌'} SE-04 ${c.name} — ${c.detail}`),
  ...ne.result.checks.map((c) => `- ${c.pass ? '✅' : '❌'} NE ${c.name} — ${c.detail}`), '',
  ...neDerived02.result.checks.map((c) => `- ${c.pass ? '✅' : '❌'} NE-02 derived ${c.name} — ${c.detail}`),
  ...neDerived03.result.checks.map((c) => `- ${c.pass ? '✅' : '❌'} NE-03 derived ${c.name} — ${c.detail}`),
  ...neDerived04.result.checks.map((c) => `- ${c.pass ? '✅' : '❌'} NE-04 derived ${c.name} — ${c.detail}`), '',
  '![QA sheet](monster_thicket_wasp_idle_facings_qa.png)', '',
  'Sheet order: SE frames 01–04 and strip at 55%, NE frames 01–04 and strip at 55%, three-wasp SE overlap at 100% and 55%.', '',
  'Rejected generated NE intermediates (frame 01 reference, then rejected 02–04):', '',
  '![Rejected NE generations](monster_thicket_wasp_idle_ne_rejected_qa.png)', '',
];
writeFileSync(`${OUT}/report.md`, report.join('\n'));
console.log(`${pass ? 'PASS' : 'FAIL'} MON_THICKET_WASP idle — four complete facings; NE loop body-locked`);
if (!pass) process.exitCode = 1;
