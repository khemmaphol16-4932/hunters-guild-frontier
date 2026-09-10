/**
 * Endless expeditions (REQ-END-002/003) — how deep runs scale, pay and are remembered.
 *
 * REQ-END-002 names six objectives the player chooses between before an endless run. Each is
 * authored here as a *base* party objective (which the planner and the Guild AI already
 * understand) plus an emphasis on what the run pays out, so no new decision logic is needed
 * for the AI to play one: a survival run is played as "survive", and is paid as one.
 *
 * Validated for the failure modes that would not crash: a stat growth that names a stat no
 * monster has would scale nothing, and a reward scale of zero on everything would make an
 * objective that pays nothing.
 */

import {
  ContentValidationError,
  assertUniqueIds,
  expectArray,
  expectEnum,
  expectNumber,
  expectObject,
  expectString,
  field,
  optionalField,
} from './schema.js';

export const ENDLESS_BASE_OBJECTIVES = ['clear', 'survive', 'loot', 'scout', 'slay'] as const;
export type EndlessBaseObjective = (typeof ENDLESS_BASE_OBJECTIVES)[number];

export interface EndlessRewardScale {
  readonly gold: number;
  readonly food: number;
  readonly materials: number;
  readonly loot: number;
}

export interface EndlessObjectiveDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly baseObjective: EndlessBaseObjective;
  readonly rewardScale: EndlessRewardScale;
  /** Rare resources per route cleared; fractions accumulate and are paid whole. */
  readonly extrasPerDepth: Readonly<Record<string, number>>;
}

export interface EndlessData {
  readonly unlock: { readonly guildMasteryLevel: number };
  readonly maxDepth: number;
  readonly statsPerDepth: Readonly<Record<string, number>>;
  readonly rewardPerDepth: number;
  readonly lootRollsPerDepth: number;
  /** Every this-many depths, a new personal record is carved on the Monument. */
  readonly recordMilestone: number;
  readonly objectives: readonly EndlessObjectiveDef[];
}

const FILE = 'balance/endless.json';

function nonNegative(value: unknown, path: string): number {
  const n = expectNumber(value, path);
  if (n < 0) throw new ContentValidationError(path, 'must not be negative');
  return n;
}

function positiveInteger(value: unknown, path: string): number {
  const n = expectNumber(value, path);
  if (!Number.isInteger(n) || n < 1) throw new ContentValidationError(path, 'must be a positive whole number');
  return n;
}

export function parseEndless(raw: unknown, knownStats: ReadonlySet<string>): EndlessData {
  const root = expectObject(raw, FILE);

  const unlock = expectObject(field(root, 'unlock', FILE), `${FILE}.unlock`);
  const statsPath = `${FILE}.statsPerDepth`;
  const statsPerDepth: Record<string, number> = {};
  for (const [stat, growth] of Object.entries(expectObject(field(root, 'statsPerDepth', FILE), statsPath))) {
    if (stat.startsWith('$')) continue;
    if (!knownStats.has(stat)) {
      throw new ContentValidationError(`${statsPath}.${stat}`, 'no monster has this stat, so scaling it would change nothing');
    }
    statsPerDepth[stat] = nonNegative(growth, `${statsPath}.${stat}`);
  }
  if (!Object.values(statsPerDepth).some((growth) => growth > 0)) {
    throw new ContentValidationError(statsPath, 'an endless run must get harder as it goes deeper');
  }

  const objectivesPath = `${FILE}.objectives`;
  const objectives = expectArray(field(root, 'objectives', FILE), objectivesPath).map((value, i): EndlessObjectiveDef => {
    const p = `${objectivesPath}[${i}]`;
    const o = expectObject(value, p);
    const scalePath = `${p}.rewardScale`;
    const scale = expectObject(field(o, 'rewardScale', p), scalePath);
    const rewardScale: EndlessRewardScale = {
      gold: nonNegative(field(scale, 'gold', scalePath), `${scalePath}.gold`),
      food: nonNegative(field(scale, 'food', scalePath), `${scalePath}.food`),
      materials: nonNegative(field(scale, 'materials', scalePath), `${scalePath}.materials`),
      loot: nonNegative(field(scale, 'loot', scalePath), `${scalePath}.loot`),
    };
    if (Object.values(rewardScale).every((n) => n === 0)) {
      throw new ContentValidationError(scalePath, 'an objective that pays nothing at all is not an objective');
    }
    const extrasPerDepth: Record<string, number> = {};
    const extrasRaw = optionalField(o, 'extrasPerDepth');
    if (extrasRaw !== undefined) {
      for (const [id, amount] of Object.entries(expectObject(extrasRaw, `${p}.extrasPerDepth`))) {
        const n = expectNumber(amount, `${p}.extrasPerDepth.${id}`);
        if (n <= 0) throw new ContentValidationError(`${p}.extrasPerDepth.${id}`, 'must be positive');
        extrasPerDepth[id] = n;
      }
    }
    return {
      id: expectString(field(o, 'id', p), `${p}.id`),
      name: expectString(field(o, 'name', p), `${p}.name`),
      description: expectString(field(o, 'description', p), `${p}.description`),
      baseObjective: expectEnum(field(o, 'baseObjective', p), `${p}.baseObjective`, ENDLESS_BASE_OBJECTIVES),
      rewardScale,
      extrasPerDepth,
    };
  });
  assertUniqueIds(objectives.map((objective) => objective.id), objectivesPath);
  if (objectives.length === 0) throw new ContentValidationError(objectivesPath, 'must offer at least one objective');

  return {
    unlock: { guildMasteryLevel: positiveInteger(field(unlock, 'guildMasteryLevel', `${FILE}.unlock`), `${FILE}.unlock.guildMasteryLevel`) },
    maxDepth: positiveInteger(field(root, 'maxDepth', FILE), `${FILE}.maxDepth`),
    statsPerDepth,
    rewardPerDepth: nonNegative(field(root, 'rewardPerDepth', FILE), `${FILE}.rewardPerDepth`),
    lootRollsPerDepth: nonNegative(field(root, 'lootRollsPerDepth', FILE), `${FILE}.lootRollsPerDepth`),
    recordMilestone: positiveInteger(field(root, 'recordMilestone', FILE), `${FILE}.recordMilestone`),
    objectives,
  };
}
