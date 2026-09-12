#!/usr/bin/env node
/**
 * Deterministic export of generated source art into game sprites, with QA.
 *
 *   node art/tools/export.mjs art/qa/<batch>/manifest.json            export + validate → art/qa/<batch>/
 *   node art/tools/export.mjs art/qa/<batch>/manifest.json --promote  copy approved jobs to production
 *
 * A manifest names each source image, the asset id it becomes (from art/prompts/), the variant and
 * the target subject height in @2x pixels. Canvas, pivot and colour cap come from the prompt
 * library and ART_BIBLE.md, never from the manifest, so an export cannot drift from the spec.
 *
 * Sources are read and never written (they carry provenance metadata). Exports go to the QA folder;
 * only jobs a human has marked "approved": true after reviewing the QA sheet are promoted.
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.mjs';
import { bbox, removeDarkMatte, downsample, quantize, place, halve, contactShadow, scaleNearest, qaSheet, validate, COLOUR_CAP } from './sprite.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifestPath = process.argv[2];
const promote = process.argv.includes('--promote');
if (!manifestPath) { console.error('usage: node art/tools/export.mjs <manifest.json> [--promote]'); process.exit(2); }

// The prompt library is the spec of record for canvas, pivot and output path.
const build = spawnSync(process.execPath, [join(ROOT, 'art/prompts/build.mjs')], { encoding: 'utf8' });
if (build.status !== 0) { console.error(build.stderr || build.stdout); process.exit(1); }
const library = new Map(readFileSync(join(ROOT, 'art/prompts/prompts.jsonl'), 'utf8').trim().split('\n').map((l) => { const a = JSON.parse(l); return [a.id, a]; }));

const manifest = JSON.parse(readFileSync(join(ROOT, manifestPath), 'utf8'));
const qaDir = dirname(join(ROOT, manifestPath));
const rel = (p) => p.slice(ROOT.length + 1).replace(/\\/g, '/');
const write = (path, img) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, encodePng(img)); };
const report = [`# QA — ${manifest.batch}`, '', `Source: \`${manifest.source}\` · exported by \`art/tools/export.mjs\` · deterministic: re-running gives identical files.`, ''];
let failures = 0;

for (const job of manifest.jobs) {
  const asset = library.get(job.id);
  if (!asset) throw new Error(`${job.id} is not in art/prompts/ — ids must match the prompt library exactly`);
  if (!asset.width || !asset.pivot) throw new Error(`${job.id} has no single-sprite canvas and pivot in the prompt library`);
  const canvas = [asset.width, asset.height];
  const base = basename(asset.output).replace(/_01@2x\.png$/, `_${job.variant ?? '01'}`).replace(/@2x\.png$/, '');
  const prodDir = join(ROOT, dirname(asset.output));
  const files = { x2: join(qaDir, `${base}@2x.png`), x1: join(qaDir, `${base}@1x.png`), shadow: join(qaDir, `${base}_shadow@2x.png`), qa: join(qaDir, `${base}_qa.png`) };

  if (promote) {
    if (!job.approved) continue;
    mkdirSync(prodDir, { recursive: true });
    for (const k of ['x2', 'x1', 'shadow']) copyFileSync(files[k], join(prodDir, basename(files[k])));
    writeFileSync(join(prodDir, `${base}.json`), JSON.stringify({ id: job.id, frameWidth: canvas[0], frameHeight: canvas[1], frames: 1, fps: 0, loop: false, pivotX: asset.pivot[0], pivotY: asset.pivot[1], source: `${manifest.source}/${job.file}` }, null, 2) + '\n');
    console.log(`promoted ${job.id} → ${rel(prodDir)}/${base}@2x.png`);
    continue;
  }

  const srcPath = join(ROOT, manifest.source, job.file);
  const srcBytes = readFileSync(srcPath);
  let src = decodePng(srcBytes);
  let matteNote = 'none';
  if (job.matte) { const r = removeDarkMatte(src, job.matte); src = r.img; matteNote = `dark matte ≤ ${job.matte} luminance, ${r.cleared} px cleared`; }
  const box = bbox(src);
  if (!box) throw new Error(`${job.file}: no opaque pixels`);

  // Subject height is the manifest's; width follows the source aspect, shrunk to fit the canvas.
  let h = job.height, w = Math.round(box.w * (h / box.h));
  const maxW = canvas[0] - 4, maxH = asset.pivot[1] + 1 - 2;
  if (w > maxW) { h = Math.round(h * (maxW / w)); w = maxW; }
  if (h > maxH) { w = Math.round(w * (maxH / h)); h = maxH; }
  const cap = COLOUR_CAP[asset.category];
  const { img: subject, palette } = quantize(downsample(src, box, w, h), cap ?? 256);
  const x2 = place(subject, canvas[0], canvas[1], asset.pivot);
  const x1 = halve(x2);
  const shadow = contactShadow(x2, asset.pivot);
  write(files.x2, x2); write(files.x1, x1); write(files.shadow, shadow);
  // QA sheet: @2x, @2x at the 0.55 zoom floor, and @1x, on Verdant Reach grass, enlarged ×2 to review.
  write(files.qa, scaleNearest(qaSheet([x2, scaleNearest(x2, 0.55), x1]), 2));

  const v = validate(x2, { canvas, pivot: asset.pivot, category: asset.category, halfImg: x1 });
  if (!v.pass) failures++;
  report.push(`## \`${job.id}\` — variant ${job.variant ?? '01'}`, '');
  report.push(`| | |`, `|---|---|`);
  report.push(`| Source | \`${manifest.source}/${job.file}\` · ${src.width} × ${src.height} · sha256 \`${createHash('sha256').update(srcBytes).digest('hex').slice(0, 16)}\` |`);
  report.push(`| Output | \`${rel(files.x2)}\` · subject ${w} × ${h} on ${canvas[0]} × ${canvas[1]} |`);
  report.push(`| Matte removal | ${matteNote} |`);
  report.push(`| Palette | ${palette.length} colours: ${palette.map((c) => `\`${c}\``).join(' ')} |`);
  report.push(`| Machine checks | **${v.pass ? 'PASS' : 'FAIL'}** |`);
  report.push(`| Human review (0.55 zoom, silhouette) | ${job.review ?? 'pending'} |`);
  report.push(`| Promoted | ${job.approved ? 'yes' : 'no'} |`, '');
  for (const c of v.checks) report.push(`- ${c.pass ? '✅' : '❌'} ${c.name} — ${c.detail}`);
  report.push('', `![QA sheet](${basename(files.qa)})`, '');
  console.log(`${v.pass ? 'PASS' : 'FAIL'} ${job.id} v${job.variant ?? '01'} — ${v.checks.filter((c) => !c.pass).map((c) => c.name).join(', ') || 'all machine checks'}`);
}

if (!promote) writeFileSync(join(qaDir, 'report.md'), report.join('\n') + '\n');
if (failures) process.exit(1);
