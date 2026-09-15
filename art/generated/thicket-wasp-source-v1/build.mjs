import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decodePng, encodePng } from '../../tools/png.mjs';
import { bbox, contactShadow, downsample, halve, place, qaSheet, quantize, scaleNearest, validate } from '../../tools/sprite.mjs';

const SOURCE = 'art/generated/thicket-wasp-source-v1/thicket_wasp_idle_se_candidate.png';
const OUT = 'art/qa/thicket-wasp-source-v1';
mkdirSync(OUT, { recursive: true });

const raw = decodePng(readFileSync(SOURCE));
const sourceBox = bbox(raw, 128);
if (!sourceBox) throw new Error('Thicket Wasp source is empty');

const firstHeight = Math.round(sourceBox.h * 60 / sourceBox.w);
const firstPass = downsample(raw, sourceBox, 60, firstHeight);
const firstBox = bbox(firstPass, 128);
const finalHeight = Math.round(firstBox.h * 60 / firstBox.w);
const sampled = downsample(firstPass, firstBox, 60, finalHeight);
const { img: limited, palette } = quantize(sampled, 24);

// The sprite body hovers 20 @2x pixels above its ground pivot at (64,112).
const sprite = place(limited, 128, 128, [64, 92]);
const half = halve(sprite);
const shadow = contactShadow(sprite, [64, 112]);
const result = validate(sprite, { canvas: [128, 128], category: '03', halfImg: half });

writeFileSync(`${OUT}/monster_thicket_wasp_idle_se_01@2x.png`, encodePng(sprite));
writeFileSync(`${OUT}/monster_thicket_wasp_idle_se_01@1x.png`, encodePng(half));
writeFileSync(`${OUT}/monster_thicket_wasp_idle_se_01_shadow@2x.png`, encodePng(shadow));

const single = scaleNearest(sprite, 0.55);
const swarm = { width: 128, height: 128, data: new Uint8Array(128 * 128 * 4) };
for (const [dx, dy] of [[-18, 4], [0, -6], [18, 5]]) {
  for (let y = 0; y < sprite.height; y++) for (let x = 0; x < sprite.width; x++) {
    const tx = x + dx, ty = y + dy;
    if (tx < 0 || ty < 0 || tx >= swarm.width || ty >= swarm.height) continue;
    const si = (y * sprite.width + x) * 4, di = (ty * swarm.width + tx) * 4;
    if (sprite.data[si + 3] === 0) continue;
    for (let k = 0; k < 4; k++) swarm.data[di + k] = sprite.data[si + k];
  }
}
writeFileSync(`${OUT}/monster_thicket_wasp_idle_se_01_qa.png`, encodePng(qaSheet([sprite, single, swarm, scaleNearest(swarm, 0.55)])));

const b = result.bbox;
const report = [
  '# QA — Thicket Wasp source v1',
  '',
  `Source: \`${SOURCE}\` · deterministic batch-local normalization using \`art/tools/sprite.mjs\`.`,
  '',
  '| | |',
  '|---|---|',
  `| Output | \`monster_thicket_wasp_idle_se_01@2x.png\` · subject ${b.w}×${b.h} on 128×128 |`,
  '| Hover | sprite bottom y=92; ground pivot `(64,112)`; 20 px @2x offset |',
  `| Palette | ${palette.length} colors |`,
  `| Machine checks | **${result.pass ? 'PASS' : 'FAIL'}** |`,
  '| Human review | Pending review of single and three-wasp overlap at 55%. |',
  '| Promoted | no |',
  '',
  ...result.checks.map((c) => `- ${c.pass ? '✅' : '❌'} ${c.name} — ${c.detail}`),
  '',
  '![QA sheet](monster_thicket_wasp_idle_se_01_qa.png)',
  '',
  'Sheet order: single at 100%, single at 55%, three-wasp overlap at 100%, overlap at 55%.',
  '',
];
writeFileSync(`${OUT}/report.md`, report.join('\n'));
console.log(`${result.pass ? 'PASS' : 'FAIL'} MON_THICKET_WASP v01 — ${b.w}×${b.h}, ${palette.length} colors`);
if (!result.pass) process.exitCode = 1;

