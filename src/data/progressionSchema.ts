/**
 * Phase 8 progression content: Guild Mastery, capability readings, the Monument, Legacy,
 * retirement, mentors and New Game+.
 *
 * All of this was TypeScript constants when Phase 8 landed, against the project's first rule
 * (DL-002: zero balance constants in code). Moving it here is not tidiness — two of the
 * values were the Legacy-farming bug. Points per Monument kind with no per-cycle limit let
 * routine contracts mint unlimited Legacy (DL-047), and a cap is a number a designer needs
 * to be able to see and change.
 *
 * The New Game+ block is validated like everything else but is a *pending-approval default*:
 * v1.0 §12 and §20 reserve carry-over and cycle rules for the design owner.
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

/** REQ-CAP-001's seven readings. Here, in the data layer, so content can name an axis. */
export const CAPABILITY_AXES = [
  'combat',
  'expedition',
  'crafting',
  'resource',
  'defense',
  'research',
  'economic',
] as const;
export type CapabilityAxis = (typeof CAPABILITY_AXES)[number];

export const MONUMENT_KINDS = [
  'worldBossVictory',
  'frontierDiscovery',
  'legendaryFind',
  'historicContract',
  'legendaryHunter',
  'townMilestone',
  'researchBreakthrough',
  'foundersFacade',
  'endlessRecord',
] as const;
export type MonumentKind = (typeof MONUMENT_KINDS)[number];

export const LEGACY_CATEGORIES = [
  'startingChoice',
  'archetype',
  'convenience',
  'system',
  'worldVariant',
  'prestige',
] as const;
export type LegacyUnlockCategory = (typeof LEGACY_CATEGORIES)[number];

export const GUILD_ACTIVITY_POINTS = [
  'expeditionPerNode',
  'craftStarted',
  'recruitHired',
  'defenseHeld',
  'defenseBreached',
  'researchCompleted',
  'contractCompleted',
  'contractFailed',
] as const;
export type GuildActivityPointKey = (typeof GUILD_ACTIVITY_POINTS)[number];

export interface LegacyUnlockDef {
  readonly id: string;
  readonly name: string;
  readonly category: LegacyUnlockCategory;
  readonly cost: number;
  readonly description: string;
}

export interface LegacyAward { readonly points: number; readonly maxPerCycle: number }

export interface WorldVariantDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly foodConsumptionScale: number;
}

export interface MentorBalance {
  readonly experiencePerLevel: number;
  readonly experienceCap: number;
  readonly masteryPerPeakPoint: number;
  readonly masteryCap: number;
  readonly trainingPerGrowthRate: number;
  readonly trainingCap: number;
  readonly guildWideCap: number;
  readonly practiceCap: number;
}

export interface CapabilityBalance {
  readonly expeditionFromCombat: number;
  readonly expeditionFromReputation: number;
  readonly armouryGoldPerPoint: number;
  readonly researchPerCompletedNode: number;
  readonly economicLogScale: number;
}

export interface ProgressionData {
  readonly guildMastery: {
    readonly pointsPerLevelCurve: number;
    readonly activityPoints: Readonly<Record<GuildActivityPointKey, number>>;
  };
  readonly capability: CapabilityBalance;
  readonly monument: { readonly legendaryHunterLevel: number };
  readonly legacy: {
    /** Kinds absent here are recorded on the Monument and award nothing (e.g. the founders' facade). */
    readonly awards: Readonly<Partial<Record<MonumentKind, LegacyAward>>>;
    readonly unlocks: readonly LegacyUnlockDef[];
  };
  readonly retirement: { readonly minLevel: number };
  readonly apprentices: { readonly perMentor: number; readonly goldCost: number };
  readonly mentors: MentorBalance;
  readonly newGamePlus: {
    readonly openings: Readonly<Record<string, Readonly<Record<string, number>>>>;
    readonly archetypes: Readonly<Record<string, { readonly archetype: string; readonly preferredDepartment: string }>>;
    readonly worldVariants: Readonly<Record<string, WorldVariantDef>>;
  };
}

const FILE = 'balance/progression.json';

function positive(value: unknown, path: string): number {
  const n = expectNumber(value, path);
  if (n <= 0) throw new ContentValidationError(path, 'must be positive');
  return n;
}

function nonNegative(value: unknown, path: string): number {
  const n = expectNumber(value, path);
  if (n < 0) throw new ContentValidationError(path, 'must not be negative');
  return n;
}

function section(root: Record<string, unknown>, key: string, path: string): Record<string, unknown> {
  return expectObject(field(root, key, path), `${path}.${key}`);
}

export function parseProgression(raw: unknown): ProgressionData {
  const root = expectObject(raw, FILE);

  const gmPath = `${FILE}.guildMastery`;
  const gm = section(root, 'guildMastery', FILE);
  const apPath = `${gmPath}.activityPoints`;
  const apRaw = section(gm, 'activityPoints', gmPath);
  const activityPoints = {} as Record<GuildActivityPointKey, number>;
  for (const key of GUILD_ACTIVITY_POINTS) {
    activityPoints[key] = nonNegative(field(apRaw, key, apPath), `${apPath}.${key}`);
  }

  const capPath = `${FILE}.capability`;
  const cap = section(root, 'capability', FILE);
  const capNumber = (key: keyof CapabilityBalance, strict = false): number =>
    (strict ? positive : nonNegative)(field(cap, key, capPath), `${capPath}.${key}`);

  const monument = section(root, 'monument', FILE);

  const legacyPath = `${FILE}.legacy`;
  const legacy = section(root, 'legacy', FILE);
  const awardsPath = `${legacyPath}.awards`;
  const awards: Partial<Record<MonumentKind, LegacyAward>> = {};
  for (const [kind, value] of Object.entries(section(legacy, 'awards', legacyPath))) {
    if (kind.startsWith('$')) continue;
    const p = `${awardsPath}.${kind}`;
    const k = expectEnum(kind, p, MONUMENT_KINDS);
    const award = expectObject(value, p);
    const maxPerCycle = expectNumber(field(award, 'maxPerCycle', p), `${p}.maxPerCycle`);
    if (!Number.isInteger(maxPerCycle) || maxPerCycle < 1) {
      throw new ContentValidationError(
        `${p}.maxPerCycle`,
        'must be a positive whole number — an unbounded award is the farming bug DL-047 fixed',
      );
    }
    awards[k] = { points: positive(field(award, 'points', p), `${p}.points`), maxPerCycle };
  }

  const unlocksPath = `${legacyPath}.unlocks`;
  const unlocks = expectArray(field(legacy, 'unlocks', legacyPath), unlocksPath).map(
    (value, i): LegacyUnlockDef => {
      const p = `${unlocksPath}[${i}]`;
      const o = expectObject(value, p);
      return {
        id: expectString(field(o, 'id', p), `${p}.id`),
        name: expectString(field(o, 'name', p), `${p}.name`),
        category: expectEnum(field(o, 'category', p), `${p}.category`, LEGACY_CATEGORIES),
        cost: positive(field(o, 'cost', p), `${p}.cost`),
        description: expectString(field(o, 'description', p), `${p}.description`),
      };
    },
  );
  assertUniqueIds(unlocks.map((u) => u.id), unlocksPath);

  const retirement = section(root, 'retirement', FILE);
  const apprentices = section(root, 'apprentices', FILE);

  const mPath = `${FILE}.mentors`;
  const mentorsRaw = section(root, 'mentors', FILE);
  const m = (key: keyof MentorBalance): number =>
    nonNegative(field(mentorsRaw, key, mPath), `${mPath}.${key}`);

  const ngPath = `${FILE}.newGamePlus`;
  const ngp = section(root, 'newGamePlus', FILE);

  const openings: Record<string, Record<string, number>> = {};
  for (const [id, value] of Object.entries(section(ngp, 'openings', ngPath))) {
    if (id.startsWith('$')) continue;
    const grant: Record<string, number> = {};
    for (const [resource, amount] of Object.entries(expectObject(value, `${ngPath}.openings.${id}`))) {
      grant[resource] = positive(amount, `${ngPath}.openings.${id}.${resource}`);
    }
    openings[id] = grant;
  }

  const archetypes: Record<string, { archetype: string; preferredDepartment: string }> = {};
  for (const [id, value] of Object.entries(section(ngp, 'archetypes', ngPath))) {
    if (id.startsWith('$')) continue;
    const p = `${ngPath}.archetypes.${id}`;
    const o = expectObject(value, p);
    archetypes[id] = {
      archetype: expectString(field(o, 'archetype', p), `${p}.archetype`),
      preferredDepartment: expectString(field(o, 'preferredDepartment', p), `${p}.preferredDepartment`),
    };
  }

  const worldVariants: Record<string, WorldVariantDef> = {};
  const variantsRaw = expectObject(optionalField(ngp, 'worldVariants') ?? {}, `${ngPath}.worldVariants`);
  for (const [id, value] of Object.entries(variantsRaw)) {
    if (id.startsWith('$')) continue;
    const p = `${ngPath}.worldVariants.${id}`;
    const o = expectObject(value, p);
    worldVariants[id] = {
      id,
      name: expectString(field(o, 'name', p), `${p}.name`),
      description: expectString(field(o, 'description', p), `${p}.description`),
      foodConsumptionScale: positive(field(o, 'foodConsumptionScale', p), `${p}.foodConsumptionScale`),
    };
  }

  // Every unlock must *do* something. Three of the six shipped with no consumer at all — paid
  // for with Legacy points and read by nothing — which is the failure the content pipeline
  // exists to prevent. Starting choices, archetypes and world variants are checked against
  // the tables that give them effects; the other categories are consumed by id in code and
  // pinned by tests/legacy.test.ts.
  for (const unlock of unlocks) {
    const p = `${unlocksPath}:${unlock.id}`;
    if (unlock.category === 'startingChoice' && !(unlock.id in openings)) {
      throw new ContentValidationError(p, 'a starting choice needs an entry in newGamePlus.openings');
    }
    if (unlock.category === 'archetype' && !(unlock.id in archetypes)) {
      throw new ContentValidationError(p, 'an archetype unlock needs an entry in newGamePlus.archetypes');
    }
    if (unlock.category === 'worldVariant' && !(unlock.id in worldVariants)) {
      throw new ContentValidationError(p, 'a world variant needs an entry in newGamePlus.worldVariants');
    }
  }

  return {
    guildMastery: {
      pointsPerLevelCurve: positive(field(gm, 'pointsPerLevelCurve', gmPath), `${gmPath}.pointsPerLevelCurve`),
      activityPoints,
    },
    capability: {
      expeditionFromCombat: capNumber('expeditionFromCombat'),
      expeditionFromReputation: capNumber('expeditionFromReputation'),
      armouryGoldPerPoint: capNumber('armouryGoldPerPoint', true),
      researchPerCompletedNode: capNumber('researchPerCompletedNode'),
      economicLogScale: capNumber('economicLogScale', true),
    },
    monument: {
      legendaryHunterLevel: positive(
        field(monument, 'legendaryHunterLevel', `${FILE}.monument`),
        `${FILE}.monument.legendaryHunterLevel`,
      ),
    },
    legacy: { awards, unlocks },
    apprentices: {
      perMentor: positive(field(apprentices, 'perMentor', `${FILE}.apprentices`), `${FILE}.apprentices.perMentor`),
      goldCost: nonNegative(field(apprentices, 'goldCost', `${FILE}.apprentices`), `${FILE}.apprentices.goldCost`),
    },
    retirement: {
      minLevel: positive(field(retirement, 'minLevel', `${FILE}.retirement`), `${FILE}.retirement.minLevel`),
    },
    mentors: {
      experiencePerLevel: m('experiencePerLevel'),
      experienceCap: m('experienceCap'),
      masteryPerPeakPoint: m('masteryPerPeakPoint'),
      masteryCap: m('masteryCap'),
      trainingPerGrowthRate: m('trainingPerGrowthRate'),
      trainingCap: m('trainingCap'),
      guildWideCap: m('guildWideCap'),
      practiceCap: Math.max(1, m('practiceCap')),
    },
    newGamePlus: { openings, archetypes, worldVariants },
  };
}
