/**
 * Research content and its validation.
 *
 * REQ-RES-001 asks for a tree with multiple branches where *some choices lock others*, and
 * REQ-RES-002 insists research is technology while Guild Mastery is experience — two ledgers
 * that must never merge. This file validates the first claim; keeping the second one true is
 * a matter of where research points come from, and they come from the Research department's
 * output, never from anything a hunter did well.
 *
 * Three validations here prevent silent content bugs rather than crashes:
 *
 *   - **Conflicts must be symmetric.** A one-way lock would make the *order* a guild
 *     researched things decide what it could become, which is a rule nobody wrote and no
 *     player could discover.
 *   - **A prerequisite may not conflict with its own dependant**, directly or through the
 *     chain — that is a node which can never be taken, and nothing would fail.
 *   - **The graph must be acyclic**, for the ordinary reason.
 *
 * Every effect is a named effect consumed by a real system. There is deliberately no
 * scripting hook: a node whose effect nothing reads would appear to do something and do
 * nothing, which is the exact failure the content pipeline exists to prevent (DL-034 made
 * the same call for events).
 */

import {
  ContentValidationError,
  assertUniqueIds,
  expectArray,
  expectEnum,
  expectNumber,
  expectObject,
  expectString,
  expectStringArray,
  field,
  optionalField,
} from './schema.js';
import { CAPACITY_KEYS, type CapacityKey } from './townSchema.js';

export const RESEARCH_BRANCHES = ['combat', 'town', 'economy'] as const;
export type ResearchBranch = (typeof RESEARCH_BRANCHES)[number];

/**
 * What a research node can do.
 *
 * A closed set, because each kind has a named consumer:
 *   `department` — `Departments.isUnlocked` (replaces the Phase 6a town-stage stand-in)
 *   `building`   — `Town.canBuild`
 *   `capacity`   — `Town.capacity`, a flat addition on one axis
 *   `quality`    — `Town.housingQuality` / `serviceQuality`, a multiplier
 *   `recovery`   — `Recovery.estimate`, a multiplier on the rate
 *   `reputation` — `Reputation.change`, a multiplier on gains only
 */
export const RESEARCH_EFFECT_KINDS = [
  'department',
  'building',
  'capacity',
  'quality',
  'recovery',
  'reputation',
] as const;
export type ResearchEffectKind = (typeof RESEARCH_EFFECT_KINDS)[number];

export interface ResearchEffect {
  readonly kind: ResearchEffectKind;
  /** A department or building id for those kinds; a number for the rest. */
  readonly value: string | number;
  /** Which capacity or quality axis, for the kinds that need one. */
  readonly axis: CapacityKey | undefined;
  /** REQ-RES-001's "result preview" — authored, so the player reads the writer's words. */
  readonly describe: string;
}

export interface ResearchNodeDef {
  readonly id: string;
  readonly name: string;
  readonly branch: ResearchBranch;
  readonly description: string;
  /** Research points. Accrued from the Research department, never from hunter activity. */
  readonly cost: number;
  /** Institutional experience required to make this technology actionable. */
  readonly masteryLevel?: number;
  readonly requires: readonly string[];
  /** Taking this node permanently forecloses these (REQ-RES-001). Symmetric. */
  readonly conflictsWith: readonly string[];
  readonly effects: readonly ResearchEffect[];
}

export interface ResearchData {
  readonly branches: Readonly<Record<string, string>>;
  readonly resetResource: { readonly id: string; readonly name: string; readonly amount: number };
  readonly nodes: readonly ResearchNodeDef[];
}

function parseEffect(raw: unknown, path: string): ResearchEffect {
  const o = expectObject(raw, path);
  const kind = expectEnum(field(o, 'kind', path), `${path}.kind`, RESEARCH_EFFECT_KINDS);
  const rawValue = field(o, 'value', path);
  const axisRaw = optionalField(o, 'axis');

  const needsAxis = kind === 'capacity' || kind === 'quality';
  if (needsAxis && axisRaw === undefined) {
    throw new ContentValidationError(
      `${path}.axis`,
      `a "${kind}" effect must say which axis it applies to`,
    );
  }
  if (!needsAxis && axisRaw !== undefined) {
    throw new ContentValidationError(
      `${path}.axis`,
      `a "${kind}" effect has no axis; the field would be silently ignored`,
    );
  }

  const axis = axisRaw === undefined ? undefined : expectEnum(axisRaw, `${path}.axis`, CAPACITY_KEYS);

  const isIdKind = kind === 'department' || kind === 'building';
  const value = isIdKind
    ? expectString(rawValue, `${path}.value`)
    : expectNumber(rawValue, `${path}.value`);

  // A multiplier below 1 would make research a *penalty*, which is never the intent and
  // would be very hard to notice in play.
  if (!isIdKind && (kind === 'quality' || kind === 'recovery' || kind === 'reputation')) {
    if (typeof value === 'number' && value < 1) {
      throw new ContentValidationError(
        `${path}.value`,
        `a "${kind}" multiplier below 1 would make researching this worse than not researching it`,
      );
    }
  }
  if (kind === 'capacity' && typeof value === 'number' && value <= 0) {
    throw new ContentValidationError(`${path}.value`, 'a capacity effect must add something');
  }

  return {
    kind,
    value,
    axis,
    describe: expectString(field(o, 'describe', path), `${path}.describe`),
  };
}

export function parseResearch(raw: unknown, path = 'research.json'): ResearchData {
  const o = expectObject(raw, path);

  const branchesRaw = expectObject(field(o, 'branches', path), `${path}.branches`);
  const branches: Record<string, string> = {};
  for (const [key, value] of Object.entries(branchesRaw)) {
    if (key.startsWith('$')) continue;
    if (!(RESEARCH_BRANCHES as readonly string[]).includes(key)) {
      throw new ContentValidationError(
        `${path}.branches.${key}`,
        `unknown branch; v1.0 §10 fixes [${RESEARCH_BRANCHES.join(', ')}]`,
      );
    }
    branches[key] = expectString(value, `${path}.branches.${key}`);
  }

  const resetRaw = expectObject(field(o, 'resetResource', path), `${path}.resetResource`);
  const resetResource = {
    id: expectString(field(resetRaw, 'id', `${path}.resetResource`), `${path}.resetResource.id`),
    name: expectString(
      field(resetRaw, 'name', `${path}.resetResource`),
      `${path}.resetResource.name`,
    ),
    amount: expectNumber(
      field(resetRaw, 'amount', `${path}.resetResource`),
      `${path}.resetResource.amount`,
    ),
  };

  const nodes = expectArray(field(o, 'nodes', path), `${path}.nodes`).map(
    (entry, index): ResearchNodeDef => {
      const p = `${path}.nodes[${index}]`;
      const n = expectObject(entry, p);
      const id = expectString(field(n, 'id', p), `${p}.id`);
      const np = `${path}:${id}`;

      const cost = expectNumber(field(n, 'cost', np), `${np}.cost`);
      if (cost <= 0) {
        throw new ContentValidationError(`${np}.cost`, 'research must cost something');
      }

      const requiresRaw = optionalField(n, 'requires');
      const conflictsRaw = optionalField(n, 'conflictsWith');
      const masteryLevelRaw = optionalField(n, 'masteryLevel');
      const masteryLevel = masteryLevelRaw === undefined ? 1 : expectNumber(masteryLevelRaw, `${np}.masteryLevel`);
      if (!Number.isInteger(masteryLevel) || masteryLevel < 1) {
        throw new ContentValidationError(`${np}.masteryLevel`, 'must be a positive integer');
      }

      const effects = expectArray(field(n, 'effects', np), `${np}.effects`).map((e, i) =>
        parseEffect(e, `${np}.effects[${i}]`),
      );
      if (effects.length === 0) {
        throw new ContentValidationError(
          `${np}.effects`,
          'a node with no effect is a node that appears to do something and does not',
        );
      }

      return {
        id,
        name: expectString(field(n, 'name', np), `${np}.name`),
        branch: expectEnum(field(n, 'branch', np), `${np}.branch`, RESEARCH_BRANCHES),
        description: expectString(field(n, 'description', np), `${np}.description`),
        cost,
        masteryLevel,
        requires: requiresRaw === undefined ? [] : expectStringArray(requiresRaw, `${np}.requires`),
        conflictsWith:
          conflictsRaw === undefined ? [] : expectStringArray(conflictsRaw, `${np}.conflictsWith`),
        effects,
      };
    },
  );

  assertUniqueIds(
    nodes.map((n) => n.id),
    `${path}.nodes`,
  );
  validateResearchGraph(nodes, path);

  return { branches, resetResource, nodes };
}

/**
 * Structural validation of the tree.
 *
 * Separate from parsing because it needs every node to exist first, and exported so a test
 * can feed it a deliberately broken graph without going through the file.
 */
export function validateResearchGraph(
  nodes: readonly ResearchNodeDef[],
  path = 'research.json',
): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (const node of nodes) {
    for (const required of node.requires) {
      if (!byId.has(required)) {
        throw new ContentValidationError(
          `${path}:${node.id}.requires`,
          `needs "${required}", which does not exist`,
        );
      }
      if (required === node.id) {
        throw new ContentValidationError(`${path}:${node.id}.requires`, 'requires itself');
      }
    }

    for (const conflict of node.conflictsWith) {
      const other = byId.get(conflict);
      if (!other) {
        throw new ContentValidationError(
          `${path}:${node.id}.conflictsWith`,
          `conflicts with "${conflict}", which does not exist`,
        );
      }
      if (conflict === node.id) {
        throw new ContentValidationError(
          `${path}:${node.id}.conflictsWith`,
          'conflicts with itself, so it could never be taken',
        );
      }
      // Asymmetry would make the *order* of research decide what a guild could become —
      // an undiscoverable rule. REQ-RES-001's locking has to work the same way round.
      if (!other.conflictsWith.includes(node.id)) {
        throw new ContentValidationError(
          `${path}:${node.id}.conflictsWith`,
          `locks "${conflict}" but "${conflict}" does not lock it back; conflicts must be symmetric`,
        );
      }
    }
  }

  // A node that conflicts with something it also depends on — directly or up the chain —
  // can never be taken, and nothing would fail at load or in play. It would simply sit
  // there, permanently unavailable, looking like content.
  for (const node of nodes) {
    const ancestors = ancestorsOf(node, byId, path);
    for (const conflict of node.conflictsWith) {
      if (ancestors.has(conflict)) {
        throw new ContentValidationError(
          `${path}:${node.id}`,
          `conflicts with "${conflict}", which it also depends on, so it can never be taken`,
        );
      }
    }
  }
}

/** Every node reachable through `requires`, with cycle detection. */
function ancestorsOf(
  node: ResearchNodeDef,
  byId: ReadonlyMap<string, ResearchNodeDef>,
  path: string,
): ReadonlySet<string> {
  const seen = new Set<string>();
  const walk = (current: ResearchNodeDef, stack: readonly string[]): void => {
    for (const required of current.requires) {
      if (stack.includes(required)) {
        throw new ContentValidationError(
          `${path}:${required}`,
          `research prerequisites form a cycle: ${[...stack, required].join(' -> ')}`,
        );
      }
      seen.add(required);
      const parent = byId.get(required);
      if (parent) walk(parent, [...stack, required]);
    }
  };
  walk(node, [node.id]);
  return seen;
}
