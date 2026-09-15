import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decodePng, encodePng } from '../../tools/png.mjs';
import { bbox, contactShadow, downsample, halve, place, qaSheet, quantize, scaleNearest, validate } from '../../tools/sprite.mjs';

const OUT = 'art/qa/thicket-wasp-source-v1';
mkdirSync(OUT, { recursive: true });

function normalize(facing, frame = '01') {
  const suffix = frame === '01' ? '' : `_frame${frame}-v2`;
  const source = `art/generated/thicket-wasp-source-v1/thicket_wasp_idle_${facing}${suffix}_candidate.png`;
  const raw = decodePng(readFileSync(source));
  const sourceBox = bbox(raw, 128);
  if (!sourceBox) throw new Error(`Thicket Wasp ${facing} source is empty`);
  const firstHeight = Math.round(sourceBox.h * 60 / sourceBox.w);
  const firstPass = downsample(raw, sourceBox, 60, firstHeight);
  const firstBox = bbox(firstPass, 128);
  const finalHeight = Math.round(firstBox.h * 60 / firstBox.w);
  const sampled = downsample(firstPass, firstBox, 60, finalHeight);
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
  se.sprite, scaleNearest(se.sprite, 0.55), se02.sprite, scaleNearest(se02.sprite, 0.55), ne.sprite, scaleNearest(ne.sprite, 0.55), swarm, scaleNearest(swarm, 0.55),
])));

const pass = se.result.pass && se02.result.pass && ne.result.pass;
const report = [
  '# QA — Thicket Wasp source v1', '',
  `Sources: \`${se.source}\`, \`${ne.source}\` · deterministic batch-local normalization using \`art/tools/sprite.mjs\`.`, '',
  '| | |', '|---|---|',
  `| SE output | subject ${se.result.bbox.w}×${se.result.bbox.h} on 128×128 |`,
  `| SE frame 02 | subject ${se02.result.bbox.w}×${se02.result.bbox.h} on 128×128 |`,
  `| NE output | subject ${ne.result.bbox.w}×${ne.result.bbox.h} on 128×128 |`,
  '| Hover | sprite bottom y=92; ground pivot `(64,112)`; 20 px @2x offset |',
  `| Palette | SE-01 ${se.palette.length}; SE-02 ${se02.palette.length}; NE-01 ${ne.palette.length} colors |`,
  `| Machine checks | **${pass ? 'PASS' : 'FAIL'}** — both authored facings and frame 02 |`,
  '| Human review | Codex: **PASS candidate** — both facings and the downstroke retain their body segments and four-wing read at 55%; the three-wasp overlap still counts as three. |',
  '| Promoted | no |', '',
  ...se.result.checks.map((c) => `- ${c.pass ? '✅' : '❌'} SE ${c.name} — ${c.detail}`),
  ...se02.result.checks.map((c) => `- ${c.pass ? '✅' : '❌'} SE-02 ${c.name} — ${c.detail}`),
  ...ne.result.checks.map((c) => `- ${c.pass ? '✅' : '❌'} NE ${c.name} — ${c.detail}`), '',
  '![QA sheet](monster_thicket_wasp_idle_facings_qa.png)', '',
  'Sheet order: SE-01 at 100% and 55%, SE-02 at 100% and 55%, NE-01 at 100% and 55%, three-wasp SE overlap at 100% and 55%.', '',
];
writeFileSync(`${OUT}/report.md`, report.join('\n'));
console.log(`${pass ? 'PASS' : 'FAIL'} MON_THICKET_WASP idle — SE-01 ${se.result.bbox.w}×${se.result.bbox.h}, SE-02 ${se02.result.bbox.w}×${se02.result.bbox.h}, NE-01 ${ne.result.bbox.w}×${ne.result.bbox.h}`);
if (!pass) process.exitCode = 1;
