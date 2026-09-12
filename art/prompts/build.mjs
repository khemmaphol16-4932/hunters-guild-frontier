#!/usr/bin/env node
/**
 * Compiles the art prompt library.
 *
 *   node art/prompts/build.mjs           write art/prompts/*.md and prompts.jsonl
 *   node art/prompts/build.mjs --check   fail if the written files are stale or coverage has gaps
 *
 * Single source: the master style, compact style and master negative are read from
 * art/ART_BIBLE.md; each category negative from its spec in art/specs/. The sources in
 * art/prompts/src/ hold only what is unique to each asset. Change a rule in the bible and every
 * prompt follows on the next build.
 *
 * Coverage: every content id the art must represent (monsters, buildings, resources, jobs,
 * statuses, …) is read from src/data and must be covered by at least one asset. A content id
 * with no prompt, or a prompt covering an id that no longer exists, fails the build.
 *
 * Zero dependencies; Node built-ins only.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const oneLine = (t) => t.replace(/\s+/g, ' ').trim();

function codeBlockAfter(markdown, heading, file) {
  const at = markdown.indexOf(heading);
  if (at < 0) throw new Error(`${file}: heading "${heading}" not found`);
  const m = /```[a-z]*\n([\s\S]*?)```/.exec(markdown.slice(at));
  if (!m) throw new Error(`${file}: no code block after "${heading}"`);
  return oneLine(m[1]);
}

// ---------------------------------------------------------------- the rules, from the bible

const BIBLE = read('art/ART_BIBLE.md');
const MASTER_STYLE = codeBlockAfter(BIBLE, '## 2. Master style prompt', 'ART_BIBLE.md');
const COMPACT_STYLE = codeBlockAfter(BIBLE, '### Compact form', 'ART_BIBLE.md');
const MASTER_NEGATIVE = codeBlockAfter(BIBLE, '## 3. Master negative prompt', 'ART_BIBLE.md');

const SUBJECT_SENTENCE = 'Single subject, centred, feet or footprint aligned to the ground plane.';
const TRANSPARENT_SENTENCE = 'Fully transparent background.';

/**
 * The master style assumes one grounded sprite on transparency. Other kinds of asset swap the
 * one sentence that does not fit them, and drop the negative terms that would fight them.
 * Every swap must match the bible's text exactly, so an edit there fails loudly here.
 */
const KINDS = {
  sprite: {},
  tile: { subject: 'A single ground tile filling exactly one 2:1 diamond, transparent outside the diamond.', keep: 'the same tile shape, palette, light direction, level of detail and seamless edges' },
  sheet: { subject: 'Several panels on one canvas, laid out exactly as listed below, evenly spaced on a shared baseline, each panel a complete subject.', drop: ['multiple characters', 'collage', 'sprite sheet grid lines'] },
  icon: { subject: 'Single subject, centred in the frame, not standing on any ground.' },
  fx: { subject: 'A single effect, centred on its anchor point, with no character or creature in it.', drop: ['multiple characters'] },
  scene: { subject: 'A complete composed scene filling the whole frame edge to edge.', transparent: 'Opaque background: the scene fills the frame.', drop: ['background scenery', 'ground plate', 'multiple characters'] },
};
const KEEP = 'the same subject, proportions, silhouette, palette, 1-pixel outline, pixel density, lighting from the upper left and 2:1 dimetric angle';

function styleFor(kind) {
  const k = KINDS[kind];
  if (!k) throw new Error(`unknown kind "${kind}"`);
  let style = MASTER_STYLE;
  const swap = (from, to) => {
    if (!style.includes(from)) throw new Error(`ART_BIBLE.md master style no longer contains "${from}"`);
    style = style.replace(from, to);
  };
  if (k.subject) swap(SUBJECT_SENTENCE, k.subject);
  if (k.transparent) swap(TRANSPARENT_SENTENCE, k.transparent);
  return style;
}

function mergeNegative(parts, drop = []) {
  const seen = new Set(drop.map((t) => t.toLowerCase()));
  const out = [];
  for (const part of parts) {
    for (const term of (part ?? '').split(',').map((t) => t.trim()).filter(Boolean)) {
      const key = term.toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push(term); }
    }
  }
  return out.join(', ');
}

// ---------------------------------------------------------------- composing one asset

const px = ([w, h]) => `${w} × ${h}`;

function composeSubject(a) {
  let text = oneLine(a.subject);
  if (a.members) {
    const cols = a.grid?.cols ?? a.members.length;
    const rows = Math.ceil(a.members.length / cols);
    const [w, h] = a.canvas;
    const list = a.members.map((m, i) => `${i + 1}) ${oneLine(m.subject)}`).join('; ');
    text += ` Lay out ${a.members.length} panels in ${rows === 1 ? 'one row' : `${rows} rows of ${cols}`}, each panel ${w} by ${h} pixels, separated by 16 pixels of empty space, in this order, left to right${rows > 1 ? ' and top to bottom' : ''}: ${list}.`;
  } else if (a.canvas) {
    text += ` Draw it on a ${a.canvas[0]} by ${a.canvas[1]} pixel canvas`;
    text += a.pivot ? `, with the point where it meets the ground at pixel ${a.pivot[0]}, ${a.pivot[1]}.` : '.';
  }
  return text;
}

function compose(a, category) {
  if (a.generate === false) return { ...a, category: category.id };
  const kind = a.kind ?? 'sprite';
  const subject = composeSubject(a);
  const prompt = `${styleFor(kind)}\n\n${subject}`;
  const compact = `${subject} ${COMPACT_STYLE}`;
  // An asset may drop a master term that fights its own subject, e.g. a boss made of many figures.
  const negative = mergeNegative([MASTER_NEGATIVE, category.negative, a.negative], [...(KINDS[kind].drop ?? []), ...(a.dropNegative ?? [])]);
  const keep = a.keep ?? KINDS[kind].keep ?? KEEP;
  const tail = kind === 'scene' ? 'No text.' : 'Fully transparent background, no text.';
  const variations = (a.variations ?? []).map((v) =>
    `Use the attached, approved ${a.id} image as the exact reference. Keep ${keep}. Change only this: ${oneLine(v)} ${tail}`);
  return { ...a, kind, category: category.id, prompt, compact, negative, variations };
}

// ---------------------------------------------------------------- rendering

function renderMarkdown(category, assets, sourceFile) {
  const out = [];
  const generated = assets.filter((a) => a.generate !== false);
  out.push(`<!-- GENERATED by art/prompts/build.mjs from art/prompts/src/${sourceFile}. Edit the source, then run \`npm run art:prompts\`. -->`);
  out.push('');
  out.push(`# Prompts ${category.id} — ${category.title}`);
  out.push('');
  out.push(`Spec: [${category.spec}](../${category.spec}) · **${generated.length}** generation prompts` +
    (assets.length > generated.length ? ` · ${assets.length - generated.length} constructed or blocked` : ''));
  out.push('');
  out.push('Every prompt below is complete: the master style from `ART_BIBLE.md` §2 is already expanded, and the negative prompt already merges the master, category and asset negatives. Generate the **prompt** first; once it is approved, use each **variation** with that image attached as the reference. Family sheets are generated as one image so their members share one look, then sliced in Aseprite with *Import Sprite Sheet → By Cell Size*.');
  for (const group of category.groups) {
    out.push('');
    out.push(`## ${group.title}`);
    if (group.note) { out.push(''); out.push(oneLine(group.note)); }
    for (const a of assets.filter((x) => x.group === group.title)) {
      out.push('');
      out.push(`### \`${a.id}\``);
      out.push('');
      out.push('| | |');
      out.push('|---|---|');
      out.push(`| Priority | ${a.priority ?? 'P1'} |`);
      if (a.out) out.push(`| Output | \`${a.out}\` |`);
      if (a.canvas) out.push(`| ${a.members ? 'Panel' : 'Canvas'} | ${px(a.canvas)} px \`@2x\`${a.pivot ? ` · pivot ${a.pivot[0]}, ${a.pivot[1]}` : ''} |`);
      const covers = [...(a.covers ?? []), ...(a.members ?? []).flatMap((m) => m.covers ?? [])];
      if (covers.length) out.push(`| Covers | ${covers.map((c) => `\`${c}\``).join(' ')} |`);
      if (a.members) {
        out.push('');
        out.push('| # | Member | Output |');
        out.push('|---|---|---|');
        a.members.forEach((m, i) => out.push(`| ${i + 1} | \`${m.id}\` | ${m.out ? `\`${m.out}\`` : 'part of the sheet'} |`));
      }
      if (a.note) { out.push(''); out.push(`> **Note.** ${oneLine(a.note)}`); }
      if (a.generate === false) {
        out.push('');
        out.push(`**Not generated.** ${oneLine(a.construct)}`);
        continue;
      }
      out.push('');
      out.push('**Prompt**');
      out.push('');
      out.push('```text');
      out.push(a.prompt);
      out.push('```');
      out.push('');
      out.push('**Negative prompt**');
      out.push('');
      out.push('```text');
      out.push(a.negative);
      out.push('```');
      if (a.variations.length) {
        out.push('');
        out.push('**Variations** — attach the approved image as the reference:');
        for (const v of a.variations) {
          out.push('');
          out.push('```text');
          out.push(v);
          out.push('```');
        }
      }
    }
  }
  return out.join('\n') + '\n';
}

const PRIORITY = { P0: 0, P1: 1, P2: 2, P3: 3 };

function renderJsonl(all) {
  return all
    .filter((a) => a.generate !== false)
    .sort((x, y) => (PRIORITY[x.priority ?? 'P1'] - PRIORITY[y.priority ?? 'P1']) || x.category.localeCompare(y.category))
    .map((a) => JSON.stringify({
      id: a.id,
      category: a.category,
      priority: a.priority ?? 'P1',
      kind: a.kind,
      width: a.members ? undefined : a.canvas?.[0],
      height: a.members ? undefined : a.canvas?.[1],
      output: a.out,
      members: a.members?.map((m) => ({ id: m.id, output: m.out })),
      prompt: a.prompt,
      compact: a.compact,
      negative: a.negative,
      variations: a.variations,
    }))
    .join('\n') + '\n';
}

// ---------------------------------------------------------------- coverage, from src/data

const json = (p) => JSON.parse(read(`src/data/${p}`));
const firstArray = (o) => Object.entries(o).find(([k, v]) => k !== '$comment' && Array.isArray(v))[1];
const ids = (arr) => arr.map((x) => x.id);
const keys = (o) => Object.keys(o).filter((k) => !k.startsWith('$'));
const tsConst = (file, name) => {
  const m = new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(read(file));
  if (!m) throw new Error(`${file}: ${name} not found`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

function requirements() {
  const monsters = json('combat/monsters.json').monsters;
  const regions = json('world/regions.json');
  const buildings = json('town/buildings.json');
  return {
    archetype: ids(json('archetypes.json').archetypes),
    origin: ids(json('names.json').pools),
    role: [...new Set(json('archetypes.json').archetypes.flatMap((a) => keys(a.roleLean)))],
    attribute: ['str', 'agi', 'vit', 'dex', 'int', 'luk'],
    monster: ids(monsters),
    skill: ids(json('skills.json').skills),
    monsterSkill: [...new Set(monsters.flatMap((m) => (m.skills ?? []).map((s) => s.id)))],
    status: ids(firstArray(json('combat/statuses.json'))),
    region: ids(regions.regions),
    zone: keys(regions.zoneTiers),
    node: keys(regions.nodeKinds),
    hazard: [...new Set(regions.regions.flatMap((r) => r.hazards ?? []))],
    knowledge: tsConst('src/data/combatSchema.ts', 'KNOWLEDGE_TIERS'),
    event: ids(json('world/events.json').events),
    ground: ids(json('town/threats.json').hunting.grounds),
    building: ids(buildings.buildings),
    buildingCategory: keys(buildings.categories),
    job: ids(firstArray(json('town/jobs.json'))),
    department: ids(firstArray(json('town/departments.json'))),
    resource: ids(json('economy/resources.json').resources),
    itemType: ids(json('items/item-types.json').types),
    slot: json('items/item-types.json').slots,
    rarity: ids(json('items/rarities.json').rarities),
    set: ids(json('items/sets.json').sets),
    unique: ids(firstArray(json('items/unique-effects.json'))),
    card: ids(json('items/cards.json').cards),
    personality: ids(firstArray(json('personalities.json'))),
    notification: keys(json('ui/notifications.json').priorities),
    monument: tsConst('src/data/progressionSchema.ts', 'MONUMENT_KINDS'),
  };
}

function checkCoverage(all) {
  const need = requirements();
  const covered = new Set(all.flatMap((a) => [...(a.covers ?? []), ...(a.members ?? []).flatMap((m) => m.covers ?? [])]));
  const missing = [];
  const unknown = [];
  for (const [kind, list] of Object.entries(need)) {
    for (const id of list) if (!covered.has(`${kind}:${id}`)) missing.push(`${kind}:${id}`);
  }
  for (const c of covered) {
    const [kind, id] = c.split(':');
    if (!need[kind]?.includes(id)) unknown.push(c);
  }
  const total = Object.values(need).reduce((n, l) => n + l.length, 0);
  return { missing, unknown, total };
}

// ---------------------------------------------------------------- main

const sourceDir = join(HERE, 'src');
const sourceFiles = readdirSync(sourceDir).filter((f) => /^\d\d-.*\.mjs$/.test(f)).sort();
const all = [];
const files = new Map();
const summary = [];

for (const file of sourceFiles) {
  const { default: category } = await import(pathToFileURL(join(sourceDir, file)).href);
  const spec = read(category.spec);
  category.negative = category.spec.startsWith('art/specs/') && spec.includes('### Category negative prompt')
    ? codeBlockAfter(spec, '### Category negative prompt', category.spec)
    : '';
  const assets = category.groups.flatMap((g) => g.assets.map((a) => compose({ ...a, group: g.title }, category)));
  const seen = new Set();
  for (const a of assets) {
    if (all.some((x) => x.id === a.id) || seen.has(a.id)) throw new Error(`duplicate asset id ${a.id}`);
    seen.add(a.id);
  }
  all.push(...assets);
  const name = file.replace(/\.mjs$/, '.md');
  files.set(name, renderMarkdown(category, assets, file));
  summary.push({ category, name, prompts: assets.filter((a) => a.generate !== false).length, other: assets.filter((a) => a.generate === false).length,
    p0: assets.filter((a) => a.generate !== false && a.priority === 'P0').length });
}

const coverage = checkCoverage(all);
files.set('prompts.jsonl', renderJsonl(all));

const totalPrompts = summary.reduce((n, s) => n + s.prompts, 0);
const totalP0 = summary.reduce((n, s) => n + s.p0, 0);
const readme = [
  '<!-- GENERATED by art/prompts/build.mjs. Edit art/prompts/src/ or the bible and specs, then run `npm run art:prompts`. -->',
  '',
  '# Art Prompt Library',
  '',
  `**${totalPrompts} complete generation prompts** across ${summary.length} categories, **${totalP0} of them P0**. Every prompt is fully expanded — no placeholders — from the rules in [\`ART_BIBLE.md\`](../ART_BIBLE.md) and the specs in [\`specs/\`](../specs/).`,
  '',
  '| # | Category | Prompts | P0 | Not generated |',
  '|---|---|---|---|---|',
  ...summary.map((s) => `| ${s.category.id} | [${s.category.title}](${s.name}) | ${s.prompts} | ${s.p0} | ${s.other} |`),
  '',
  `**Coverage:** ${coverage.total - coverage.missing.length} of ${coverage.total} content ids in \`src/data\` have art${coverage.missing.length ? ` — **missing: ${coverage.missing.join(', ')}**` : ' — complete'}.`,
  '',
  '## How to use',
  '',
  '1. **Order.** Work P0 first. `npm run art:prompts` also writes `prompts.jsonl` (gitignored — it is a build artifact): every asset on one line, sorted by priority, for scripted batch generation.',
  '2. **Base, then variations.** Generate an asset\'s prompt, review it against the spec\'s acceptance checklist, then generate each variation with the approved image attached as the reference.',
  '3. **Families are one image.** Icon sets, markers, hair styles and decals are generated as a single sheet so every member shares one look — one generation instead of many, and more consistent. Slice in Aseprite (*Import Sprite Sheet → By Cell Size*, panel size in the table, 16 px spacing).',
  '4. **Token-limited models.** Each line of `prompts.jsonl` also carries `compact`: the subject first, then the compact style from `ART_BIBLE.md` §2.',
  '5. **Generation is a draft.** Image models do not place pixels on an exact grid or hit exact pixel heights. Every output is cleaned up in Aseprite against the reference sheets before it enters `art/`; animation frames are hand-animated from the keyframe sheets in category 11.',
  '6. **Not generated.** Some assets are constructed, not generated — exact grids, palettes, code-driven effects — or blocked on missing content. Each says why.',
  '',
  '## Rebuilding',
  '',
  '```bash',
  'npm run art:prompts',
  '```',
  '',
  '`npm run art:prompts -- --check` fails if these files are stale or any content id lacks a prompt.',
  '',
].join('\n');
files.set('README.md', readme);

const check = process.argv.includes('--check');
let stale = [];
for (const [name, content] of files) {
  const path = join(HERE, name);
  if (check && name === 'prompts.jsonl') continue; // a build artifact, gitignored
  if (check) {
    if (!existsSync(path) || readFileSync(path, 'utf8').replace(/\r\n/g, '\n') !== content) stale.push(name);
  } else {
    writeFileSync(path, content);
  }
}

console.log(`${totalPrompts} prompts (${totalP0} P0) in ${summary.length} categories; coverage ${coverage.total - coverage.missing.length}/${coverage.total}`);
if (coverage.missing.length) console.error(`missing art for: ${coverage.missing.join(', ')}`);
if (coverage.unknown.length) console.error(`covers ids that do not exist: ${coverage.unknown.join(', ')}`);
if (check && stale.length) console.error(`stale: ${stale.join(', ')} — run npm run art:prompts`);
if (coverage.missing.length || coverage.unknown.length || (check && stale.length)) process.exit(1);
