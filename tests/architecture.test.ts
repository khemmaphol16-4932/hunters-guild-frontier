/**
 * Architectural invariants, enforced rather than documented.
 *
 * REQ-TEC-005/010, DL-003, risks R1 and R3. Every rule here exists because violating it
 * would be invisible at review time and expensive to discover later: an unseeded random
 * call or a wall-clock read anywhere in the simulation path silently breaks offline
 * determinism (REQ-OFF-002), and an upward import quietly turns the module graph into the
 * "every system depends on every other system" shape §126 forbids.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** Import may only flow downward through this order. */
const LAYERS = [
  'data',
  'core',
  'systems',
  'ai',
  'sim',
  'save',
  'app',
  'ui',
  'debug',
] as const;
type Layer = (typeof LAYERS)[number];

const layerRank = new Map<Layer, number>(LAYERS.map((l, i) => [l, i]));

interface SourceFile {
  readonly path: string;
  readonly layer: Layer | undefined;
  readonly text: string;
}

function collect(dir: string, out: SourceFile[] = []): SourceFile[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, out);
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    const rel = relative(SRC, full).split(sep).join('/');
    const top = rel.split('/')[0] as Layer | undefined;
    out.push({
      path: rel,
      layer: top && layerRank.has(top) ? top : undefined,
      text: readFileSync(full, 'utf8'),
    });
  }
  return out;
}

const files = collect(SRC);

/** Resolve a relative import specifier to the layer it lands in. */
function importedLayer(fromPath: string, specifier: string): Layer | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const fromDir = fromPath.split('/').slice(0, -1);
  const parts = [...fromDir, ...specifier.split('/')];
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  const top = resolved[0] as Layer | undefined;
  return top && layerRank.has(top) ? top : undefined;
}

function importSpecifiers(text: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:^|\n)\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match[1]) specifiers.push(match[1]);
  }
  return specifiers;
}

/** Strip comments and string literals so prose about a banned call is not a violation. */
function stripCommentsAndStrings(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

describe('layering', () => {
  it('collected source files', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('never imports upward through the layer order', () => {
    const violations: string[] = [];

    for (const file of files) {
      if (!file.layer) continue;
      const fromRank = layerRank.get(file.layer) ?? 0;

      for (const specifier of importSpecifiers(file.text)) {
        const target = importedLayer(file.path, specifier);
        if (!target) continue;
        const toRank = layerRank.get(target) ?? 0;
        if (toRank > fromRank) {
          violations.push(`${file.path} imports ${specifier} (${file.layer} -> ${target})`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps nothing importing debug except the composition root', () => {
    // main.ts attaches the dev console in a dev build (REQ-TEC-006). It is the composition
    // boundary and the only file permitted to know debug tooling exists — in particular the
    // UI must not, or player actions and rule-bypassing debug commands would blur together.
    const violations = files
      .filter((f) => f.layer !== 'debug' && f.path !== 'main.ts')
      .filter((f) => importSpecifiers(f.text).some((s) => importedLayer(f.path, s) === 'debug'))
      .map((f) => f.path);

    expect(violations).toEqual([]);
  });

  it('keeps the DOM out of the domain layers', () => {
    // REQ-TEC-010: game logic must never depend on UI. `document` or `window` below the
    // ui/ layer means a system has grown a presentation dependency.
    const violations: string[] = [];
    for (const file of files) {
      if (file.layer === 'ui' || file.layer === 'debug' || file.path === 'main.ts') continue;
      const code = stripCommentsAndStrings(file.text);
      if (/\bdocument\.|\bwindow\./.test(code)) violations.push(file.path);
    }
    expect(violations).toEqual([]);
  });
});

describe('determinism', () => {
  it('bans Math.random outside debug', () => {
    // REQ-TEC-005 / risk R1. One unseeded call is enough to make offline simulation
    // diverge from real-time play, and the divergence would be silent.
    const violations: string[] = [];
    for (const file of files) {
      if (file.layer === 'debug') continue;
      if (/Math\.random/.test(stripCommentsAndStrings(file.text))) violations.push(file.path);
    }
    expect(violations).toEqual([]);
  });

  it('bans wall-clock reads in the simulation path', () => {
    // DL-003: gameplay advances on the simulation clock, never on Date.now or rAF delta.
    // main.ts injects the wall clock at the composition boundary; nothing below reads it.
    const allowed = new Set(['main.ts']);
    const violations: string[] = [];

    for (const file of files) {
      if (allowed.has(file.path)) continue;
      if (file.layer === 'ui' || file.layer === 'debug') continue;
      const code = stripCommentsAndStrings(file.text);
      if (/\bDate\.now\s*\(|\bperformance\.now\s*\(|requestAnimationFrame/.test(code)) {
        violations.push(file.path);
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('locked design decisions', () => {
  it('has no reaction skill category anywhere', () => {
    // REQ-SKL-004 / conflict A2. Reactive behavior is expressed by conditions and triggers.
    const schema = files.find((f) => f.path === 'data/schema.ts');
    expect(schema).toBeDefined();
    expect(schema?.text).not.toMatch(/'reaction'/);
  });

  it('has no department budget system', () => {
    // REQ-DEP-003 / conflict A10. Explicitly forbidden and must not reappear.
    const violations = files.filter((f) => /departmentBudget|DepartmentBudget/.test(f.text));
    expect(violations.map((f) => f.path)).toEqual([]);
  });
});
