import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decodePng, encodePng } from '../../tools/png.mjs';
import { bbox, contactShadow, downsample, halve, place, qaSheet, quantize, removeDarkMatte, scaleNearest, validate } from '../../tools/sprite.mjs';

const SOURCE = 'art/generated/moss-crawler-source-v2/moss_crawler_idle_se_contrast.png';
const OUT = 'art/qa/moss-crawler-source-v2';
mkdirSync(OUT, { recursive: true });

const raw = decodePng(readFileSync(SOURCE));
const matte = removeDarkMatte(raw, 40);
const sourceBox = bbox(matte.img, 128);
if (!sourceBox) throw new Error('Moss Crawler source is empty after matte cleanup');
const subjectWidth = Math.round(sourceBox.w * 40 / sourceBox.h);
const firstPass = downsample(matte.img, sourceBox, subjectWidth, 40);
const firstBox = bbox(firstPass, 128);
const finalWidth = Math.round(firstBox.w * 40 / firstBox.h);
const sampled = downsample(firstPass, firstBox, finalWidth, 40);
const { img: limited, palette } = quantize(sampled, 32);
const sprite = place(limited, 128, 128, [64, 112]);
const half = halve(sprite);
const shadow = contactShadow(sprite, [64, 112]);
const result = validate(sprite, { canvas: [128, 128], pivot: [64, 112], category: '03', halfImg: half });

writeFileSync(`${OUT}/monster_moss_crawler_idle_se_02@2x.png`, encodePng(sprite));
writeFileSync(`${OUT}/monster_moss_crawler_idle_se_02@1x.png`, encodePng(half));
writeFileSync(`${OUT}/monster_moss_crawler_idle_se_02_shadow@2x.png`, encodePng(shadow));
writeFileSync(`${OUT}/monster_moss_crawler_idle_se_02_qa.png`, encodePng(qaSheet([sprite, scaleNearest(sprite, 0.55)])));
const previous = decodePng(readFileSync('art/qa/proof-cycle-actors-source-v1/monster_moss_crawler_idle_se_01@2x.png'));
writeFileSync(`${OUT}/monster_moss_crawler_v01_v02_comparison.png`, encodePng(qaSheet([previous, sprite, scaleNearest(previous, 0.55), scaleNearest(sprite, 0.55)])));

const b = result.bbox;
const report = [
  '# QA — Moss Crawler contrast v2',
  '',
  `Source: \`${SOURCE}\` · deterministic batch-local build using \`art/tools/sprite.mjs\`.`,
  '',
  '| | |',
  '|---|---|',
  `| Output | \`monster_moss_crawler_idle_se_02@2x.png\` · subject ${b.w}×${b.h} on 128×128 |`,
  `| Matte removal | dark matte ≤40 luminance, ${matte.cleared} pixels cleared |`,
  `| Palette | ${palette.length} colors |`,
  `| Machine checks | **${result.pass ? 'PASS' : 'FAIL'}** |`,
  '| Human review | Codex: **PASS candidate** — the cool dark underside remains a single readable mass at 55%, while pale lichen separates the moss back from Verdant grass. Claude promotion review remains pending. |',
  '| Promoted | no |',
  '',
  ...result.checks.map((c) => `- ${c.pass ? '✅' : '❌'} ${c.name} — ${c.detail}`),
  '',
  '![QA sheet](monster_moss_crawler_idle_se_02_qa.png)',
  '',
  'Comparison order: v01 at 100%, v02 at 100%, v01 at 55%, v02 at 55%.',
  '',
  '![v01-v02 comparison](monster_moss_crawler_v01_v02_comparison.png)',
  '',
  'The normal shared exporter is temporarily blocked by the committed `partyReturned` notification lacking a matching entry in `art/prompts/src/09-ui-icons.mjs`. This batch-local build does not modify that file and does not promote the asset.',
  '',
];
writeFileSync(`${OUT}/report.md`, report.join('\n'));
console.log(`${result.pass ? 'PASS' : 'FAIL'} MON_MOSS_CRAWLER v02 — ${b.w}×${b.h}, ${palette.length} colors`);
if (!result.pass) process.exitCode = 1;
