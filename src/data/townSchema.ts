/**
 * Town content types and their validators.
 *
 * REQ-TWN-001/002/003/005/006, REQ-DEP-001/004, and v1.0 §9. The town is authored data in
 * exactly the sense the rest of the project already is: a building is a footprint, a
 * category and a tier ladder, and every number the town reads comes from `balance/town.json`.
 *
 * Two validations here are worth naming, because both prevent a *silent* content bug rather
 * than a crash:
 *
 *   - a tier ladder must be contiguous from 1 upward, or "upgrade" would skip a tier and
 *     the player would pay for a level the content never described;
 *   - a stage ladder's requirements must be non-decreasing, or REQ-TWN-002's "no reset on
 *     progression" would be violated by the *content* rather than by the code — a town
 *     could satisfy Hunter City and fail Fortified Town.
 *
 * There is deliberately no budget field anywhere in this file. REQ-DEP-003 forbids a
 * Department Budget system and `tests/architecture.test.ts` fails the build if the name
 * reappears; not offering the field is the structural half of that.
 */

import {
  ContentValidationError,
  assertUniqueIds,
  expectArray,
  expectBoolean,
  expectEnum,
  expectNumber,
  expectObject,
  expectString,
  expectWeights,
  field,
  optionalField,
  ATTRIBUTE_KEYS,
  ROLES,
  type AttributeWeights,
  type RoleWeights,
} from './schema.js';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** REQ-TWN-005's functions, as the category vocabulary. A building declares exactly one. */
export const BUILDING_CATEGORIES = [
  'management',
  'housing',
  'services',
  'healing',
  'revival',
  'crafting',
  'economy',
  'research',
  'defense',
  'recruitment',
] as const;
export type BuildingCategory = (typeof BUILDING_CATEGORIES)[number];

/**
 * What a building adds to the town.
 *
 * Housing and food are *capacity*, counted against population demand. Service is a quality
 * input rather than a capacity — it is what recovery reads. Defence is held for the town
 * defense pass. None of these is a bonus to a hunter: a building changes what the guild can
 * support, and that is what changes hunters.
 */
export const CAPACITY_KEYS = ['housing', 'food', 'service', 'defence'] as const;
export type CapacityKey = (typeof CAPACITY_KEYS)[number];
export type Capacity = Readonly<Record<CapacityKey, number>>;

export const EMPTY_CAPACITY: Capacity = { housing: 0, food: 0, service: 0, defence: 0 };

/** REQ-DEP-001. Mirrors `DEPARTMENTS` in core/hunter/Hunter — validated against it in loader. */
export const DEPARTMENT_IDS = ['hunter', 'crafting', 'resource', 'defense', 'research'] as const;
export type TownDepartmentId = (typeof DEPARTMENT_IDS)[number];

/** Four-direction rotation (v1.0 §9). Degrees, because the UI needs to say which way it faces. */
export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export interface BuildCost {
  readonly gold: number;
  readonly materials: number;
}

export interface Footprint {
  readonly width: number;
  readonly height: number;
}

export interface BuildingTierDef {
  readonly tier: number;
  /** Tier-specific display name, where a building is renamed as it grows (Guild Hall). */
  readonly name: string | undefined;
  readonly cost: BuildCost;
  readonly capacity: Capacity;
  /** Job id -> how many people can do that work here. */
  readonly jobs: Readonly<Record<string, number>>;
  readonly note: string | undefined;
}

export interface BuildingUnlock {
  readonly stage: string | undefined;
  readonly population: number | undefined;
  readonly reputation: number | undefined;
}

export interface BuildingDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: BuildingCategory;
  /** At most one may stand — the Guild Hall (REQ-TWN-006). */
  readonly unique: boolean;
  /** Whether this building's tier *is* the guild hall tier the stage ladder reads. */
  readonly providesGuildHallTier: boolean;
  /** Pre-rotation. Rotating by 90 or 270 swaps the axes. */
  readonly footprint: Footprint;
  readonly unlock: BuildingUnlock | undefined;
  readonly tiers: readonly BuildingTierDef[];
}

export interface BuildingData {
  readonly categories: Readonly<Record<string, string>>;
  readonly buildings: readonly BuildingDef[];
}

function parseCapacity(raw: unknown, path: string): Capacity {
  if (raw === undefined) return EMPTY_CAPACITY;
  const obj = expectObject(raw, path);
  const out = { ...EMPTY_CAPACITY } as Record<CapacityKey, number>;
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('$')) continue;
    if (!(CAPACITY_KEYS as readonly string[]).includes(key)) {
      throw new ContentValidationError(
        `${path}.${key}`,
        `unknown capacity; expected one of [${CAPACITY_KEYS.join(', ')}]`,
      );
    }
    out[key as CapacityKey] = expectNumber(value, `${path}.${key}`);
  }
  return out;
}

function parseJobSlots(raw: unknown, path: string): Readonly<Record<string, number>> {
  if (raw === undefined) return {};
  const obj = expectObject(raw, path);
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('$')) continue;
    const slots = expectNumber(value, `${path}.${key}`);
    if (!Number.isInteger(slots) || slots < 1) {
      throw new ContentValidationError(`${path}.${key}`, 'job slots must be a positive integer');
    }
    out[key] = slots;
  }
  return out;
}

function parseCost(raw: unknown, path: string): BuildCost {
  const o = expectObject(raw, path);
  const gold = expectNumber(field(o, 'gold', path), `${path}.gold`);
  const materials = expectNumber(field(o, 'materials', path), `${path}.materials`);
  if (gold < 0 || materials < 0) {
    throw new ContentValidationError(path, 'a cost cannot be negative');
  }
  return { gold, materials };
}

function parseUnlock(raw: unknown, path: string): BuildingUnlock | undefined {
  if (raw === undefined) return undefined;
  const o = expectObject(raw, path);
  const stage = optionalField(o, 'stage');
  const population = optionalField(o, 'population');
  const reputation = optionalField(o, 'reputation');
  return {
    stage: stage === undefined ? undefined : expectString(stage, `${path}.stage`),
    population:
      population === undefined ? undefined : expectNumber(population, `${path}.population`),
    reputation:
      reputation === undefined ? undefined : expectNumber(reputation, `${path}.reputation`),
  };
}

export function parseBuildings(raw: unknown, path = 'buildings.json'): BuildingData {
  const o = expectObject(raw, path);
  const categoriesRaw = expectObject(field(o, 'categories', path), `${path}.categories`);

  const categories: Record<string, string> = {};
  for (const [key, value] of Object.entries(categoriesRaw)) {
    if (key.startsWith('$')) continue;
    if (!(BUILDING_CATEGORIES as readonly string[]).includes(key)) {
      throw new ContentValidationError(
        `${path}.categories.${key}`,
        `unknown category; expected one of [${BUILDING_CATEGORIES.join(', ')}]`,
      );
    }
    categories[key] = expectString(value, `${path}.categories.${key}`);
  }

  const buildings = expectArray(field(o, 'buildings', path), `${path}.buildings`).map(
    (entry, index): BuildingDef => {
      const p = `${path}.buildings[${index}]`;
      const b = expectObject(entry, p);
      const id = expectString(field(b, 'id', p), `${p}.id`);
      const bp = `${path}:${id}`;

      const footprintRaw = expectObject(field(b, 'footprint', bp), `${bp}.footprint`);
      const width = expectNumber(field(footprintRaw, 'width', `${bp}.footprint`), `${bp}.footprint.width`);
      const height = expectNumber(
        field(footprintRaw, 'height', `${bp}.footprint`),
        `${bp}.footprint.height`,
      );
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        throw new ContentValidationError(`${bp}.footprint`, 'must be whole cells, at least 1x1');
      }

      const tiers = expectArray(field(b, 'tiers', bp), `${bp}.tiers`).map(
        (tierEntry, tierIndex): BuildingTierDef => {
          const tp = `${bp}.tiers[${tierIndex}]`;
          const t = expectObject(tierEntry, tp);
          const name = optionalField(t, 'name');
          const note = optionalField(t, 'note');
          return {
            tier: expectNumber(field(t, 'tier', tp), `${tp}.tier`),
            name: name === undefined ? undefined : expectString(name, `${tp}.name`),
            cost: parseCost(field(t, 'cost', tp), `${tp}.cost`),
            capacity: parseCapacity(optionalField(t, 'capacity'), `${tp}.capacity`),
            jobs: parseJobSlots(optionalField(t, 'jobs'), `${tp}.jobs`),
            note: note === undefined ? undefined : expectString(note, `${tp}.note`),
          };
        },
      );

      if (tiers.length === 0) {
        throw new ContentValidationError(`${bp}.tiers`, 'a building needs at least one tier');
      }
      // A gap here would make "upgrade to the next tier" skip a level the content never
      // described, and the player would pay for something that does not exist.
      tiers.forEach((tier, i) => {
        if (tier.tier !== i + 1) {
          throw new ContentValidationError(
            `${bp}.tiers[${i}].tier`,
            `tiers must run contiguously from 1; expected ${i + 1}, got ${tier.tier}`,
          );
        }
      });

      const uniqueRaw = optionalField(b, 'unique');
      const hallRaw = optionalField(b, 'providesGuildHallTier');

      return {
        id,
        name: expectString(field(b, 'name', bp), `${bp}.name`),
        description: expectString(field(b, 'description', bp), `${bp}.description`),
        category: expectEnum(field(b, 'category', bp), `${bp}.category`, BUILDING_CATEGORIES),
        unique: uniqueRaw === undefined ? false : expectBoolean(uniqueRaw, `${bp}.unique`),
        providesGuildHallTier:
          hallRaw === undefined ? false : expectBoolean(hallRaw, `${bp}.providesGuildHallTier`),
        footprint: { width, height },
        unlock: parseUnlock(optionalField(b, 'unlock'), `${bp}.unlock`),
        tiers,
      };
    },
  );

  assertUniqueIds(
    buildings.map((b) => b.id),
    `${path}.buildings`,
  );

  // REQ-TWN-006 makes the Guild Hall the heart of town and the stage ladder reads its tier,
  // so exactly one building must claim it. Zero would leave every town stuck at stage one
  // with no way to progress; two would make the reading ambiguous.
  const halls = buildings.filter((b) => b.providesGuildHallTier);
  if (halls.length !== 1) {
    throw new ContentValidationError(
      `${path}.buildings`,
      `exactly one building must set providesGuildHallTier (REQ-TWN-006); found ${halls.length}`,
    );
  }
  if (!halls[0]?.unique) {
    throw new ContentValidationError(
      `${path}:${halls[0]?.id}`,
      'the guild hall must be unique — a town with two hearts has no stage',
    );
  }

  return { categories, buildings };
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export interface JobOutput {
  /** Contribution to the owning department's output metric. */
  readonly performance: number;
  /** Food capacity added while the job is staffed. Answers REQ-TWN-003's food pressure. */
  readonly food: number;
  /** Held for the Phase 7 economy; authored now so jobs do not need rewriting then. */
  readonly materials: number;
}

export interface JobDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly department: TownDepartmentId;
  /** What makes a hunter good at this work. An input to the score, never a gate. */
  readonly from: AttributeWeights;
  readonly roleLean: RoleWeights;
  readonly output: JobOutput;
}

export interface JobData {
  readonly jobs: readonly JobDef[];
}

export function parseJobs(raw: unknown, path = 'jobs.json'): JobData {
  const o = expectObject(raw, path);

  const jobs = expectArray(field(o, 'jobs', path), `${path}.jobs`).map((entry, index): JobDef => {
    const p = `${path}.jobs[${index}]`;
    const j = expectObject(entry, p);
    const id = expectString(field(j, 'id', p), `${p}.id`);
    const jp = `${path}:${id}`;

    const from = expectWeights(field(j, 'from', jp), `${jp}.from`, ATTRIBUTE_KEYS);
    // A job nothing makes anyone better at would be assigned by preference alone, which is
    // exactly the veto-by-default shape DL-008 rules out.
    const total = Object.values(from).reduce((sum, w) => sum + (w ?? 0), 0);
    if (total <= 0) {
      throw new ContentValidationError(`${jp}.from`, 'a job must weight at least one attribute');
    }

    const roleLeanRaw = optionalField(j, 'roleLean');
    const outputRaw = expectObject(field(j, 'output', jp), `${jp}.output`);
    const foodRaw = optionalField(outputRaw, 'food');
    const materialsRaw = optionalField(outputRaw, 'materials');

    return {
      id,
      name: expectString(field(j, 'name', jp), `${jp}.name`),
      description: expectString(field(j, 'description', jp), `${jp}.description`),
      department: expectEnum(field(j, 'department', jp), `${jp}.department`, DEPARTMENT_IDS),
      from,
      roleLean:
        roleLeanRaw === undefined ? {} : expectWeights(roleLeanRaw, `${jp}.roleLean`, ROLES),
      output: {
        performance: expectNumber(
          field(outputRaw, 'performance', `${jp}.output`),
          `${jp}.output.performance`,
        ),
        food: foodRaw === undefined ? 0 : expectNumber(foodRaw, `${jp}.output.food`),
        materials:
          materialsRaw === undefined ? 0 : expectNumber(materialsRaw, `${jp}.output.materials`),
      },
    };
  });

  assertUniqueIds(
    jobs.map((j) => j.id),
    `${path}.jobs`,
  );
  return { jobs };
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

export interface DepartmentDef {
  readonly id: TownDepartmentId;
  readonly name: string;
  readonly description: string;
  /**
   * Whether the department is open to a brand-new guild.
   *
   * REQ-DEP-001 unlocks departments through Research. Research is not built yet, so the
   * predicate that opens a locked department is *injected* into `Departments` rather than
   * decided here — the same interface-with-a-stand-in shape DL-009 used for equipment. When
   * Research lands it supplies the real predicate and this file does not change.
   */
  readonly unlockedFromStart: boolean;
}

export interface DepartmentPolicyDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Assignment-weight multipliers. A rank-4 preference may only reweight (v1.0 §2.1). */
  readonly modifies: Readonly<Record<string, number>>;
}

export interface DepartmentData {
  readonly departments: readonly DepartmentDef[];
  readonly metrics: Readonly<Record<string, string>>;
  readonly policies: readonly DepartmentPolicyDef[];
}

/**
 * Parse the department content, and enforce the one inequality DL-008 rests on.
 *
 * `assignment.weights` is needed to check it, which is why this takes the balance: a policy
 * preset that pushed the two preference weights to or past `attributeFit` would make a
 * hunter's stated preference decisive, and a preference that always wins is a veto wearing a
 * different hat. REQ-TWN-010 forbids exactly that. Checking it at load makes the rule
 * structural rather than a comment somebody will retune past.
 */
export function parseDepartments(
  raw: unknown,
  assignmentWeights: Readonly<Record<string, number>>,
  path = 'departments.json',
): DepartmentData {
  const o = expectObject(raw, path);

  const departments = expectArray(field(o, 'departments', path), `${path}.departments`).map(
    (entry, index): DepartmentDef => {
      const p = `${path}.departments[${index}]`;
      const d = expectObject(entry, p);
      return {
        id: expectEnum(field(d, 'id', p), `${p}.id`, DEPARTMENT_IDS),
        name: expectString(field(d, 'name', p), `${p}.name`),
        description: expectString(field(d, 'description', p), `${p}.description`),
        unlockedFromStart: expectBoolean(
          field(d, 'unlockedFromStart', p),
          `${p}.unlockedFromStart`,
        ),
      };
    },
  );

  assertUniqueIds(
    departments.map((d) => d.id),
    `${path}.departments`,
  );
  // REQ-DEP-001 fixes the five. A missing one would silently remove a whole branch of town
  // work; an extra one is impossible, since the id is validated against the enum.
  for (const id of DEPARTMENT_IDS) {
    if (!departments.some((d) => d.id === id)) {
      throw new ContentValidationError(
        `${path}.departments`,
        `REQ-DEP-001 fixes five departments; "${id}" is missing`,
      );
    }
  }
  if (!departments.some((d) => d.unlockedFromStart)) {
    throw new ContentValidationError(
      `${path}.departments`,
      'at least one department must be open from the start, or a new guild can assign nobody to anything',
    );
  }

  const metricsRaw = expectObject(field(o, 'metrics', path), `${path}.metrics`);
  const metrics: Record<string, string> = {};
  for (const [key, value] of Object.entries(metricsRaw)) {
    if (key.startsWith('$')) continue;
    metrics[key] = expectString(value, `${path}.metrics.${key}`);
  }
  // REQ-DEP-004 requires the dashboard to be multi-metric. One metric is a score.
  if (Object.keys(metrics).length < 2) {
    throw new ContentValidationError(
      `${path}.metrics`,
      'REQ-DEP-004 requires a multi-metric dashboard; a single metric is a score, not a dashboard',
    );
  }

  const fitWeight = assignmentWeights['attributeFit'] ?? 0;
  const preferenceKeys = ['departmentPreference', 'rolePreference'] as const;

  const policies = expectArray(field(o, 'policies', path), `${path}.policies`).map(
    (entry, index): DepartmentPolicyDef => {
      const p = `${path}.policies[${index}]`;
      const pol = expectObject(entry, p);
      const id = expectString(field(pol, 'id', p), `${p}.id`);
      const pp = `${path}:${id}`;

      const modifiesRaw = optionalField(pol, 'modifies');
      const modifies: Record<string, number> = {};
      if (modifiesRaw !== undefined) {
        const obj = expectObject(modifiesRaw, `${pp}.modifies`);
        for (const [key, value] of Object.entries(obj)) {
          if (key.startsWith('$')) continue;
          if (!(key in assignmentWeights)) {
            throw new ContentValidationError(
              `${pp}.modifies.${key}`,
              `no assignment weight is named "${key}"; a preset can only reweight terms that exist`,
            );
          }
          const multiplier = expectNumber(value, `${pp}.modifies.${key}`);
          if (multiplier < 0) {
            throw new ContentValidationError(
              `${pp}.modifies.${key}`,
              'a negative multiplier would invert the term rather than reweight it',
            );
          }
          modifies[key] = multiplier;
        }
      }

      // DL-008 / REQ-TWN-010, checked rather than trusted.
      const preferenceTotal = preferenceKeys.reduce(
        (sum, key) => sum + (assignmentWeights[key] ?? 0) * (modifies[key] ?? 1),
        0,
      );
      if (preferenceTotal >= fitWeight) {
        throw new ContentValidationError(
          `${pp}.modifies`,
          `preference weights total ${preferenceTotal.toFixed(3)} under this preset, which ` +
            `reaches attributeFit (${fitWeight}). REQ-TWN-010 makes preferences inputs, ` +
            'never vetoes, and a preference that always wins is a veto',
        );
      }

      return {
        id,
        name: expectString(field(pol, 'name', pp), `${pp}.name`),
        description: expectString(field(pol, 'description', pp), `${pp}.description`),
        modifies,
      };
    },
  );

  assertUniqueIds(
    policies.map((p) => p.id),
    `${path}.policies`,
  );
  if (policies.length === 0) {
    throw new ContentValidationError(
      `${path}.policies`,
      'REQ-DEP-005 requires policy presets to exist',
    );
  }

  return { departments, metrics, policies };
}

// ---------------------------------------------------------------------------
// Town balance
// ---------------------------------------------------------------------------

export interface StageDef {
  readonly id: string;
  readonly name: string;
  readonly requires: {
    readonly population: number;
    readonly buildings: number;
    readonly guildHallTier: number;
  };
}

export interface StabilityBand {
  readonly id: string;
  readonly atLeast: number;
  readonly label: string;
}

export interface TownBalance {
  readonly grid: { readonly width: number; readonly height: number };
  readonly population: {
    readonly starting: number;
    readonly perCapita: Readonly<Record<'housing' | 'food' | 'services', number>>;
    readonly growth: {
      readonly basePerStep: number;
      readonly perReputation: number;
      readonly prosperityScale: number;
      readonly maxPerStep: number;
    };
    readonly departure: {
      readonly pressureThreshold: number;
      readonly perStepAtFullPressure: number;
    };
  };
  readonly stability: {
    readonly weights: Readonly<Record<'housing' | 'food' | 'services', number>>;
    readonly bands: readonly StabilityBand[];
  };
  readonly recovery: {
    readonly baseFatigueClearedPerStep: number;
    readonly injuryStepsAtBaseline: number;
    readonly recoveryStepsAtBaseline: number;
    readonly minSteps: number;
    readonly maxSteps: number;
  };
  readonly quality: {
    readonly unbuiltHousingQuality: number;
    readonly unbuiltServiceQuality: number;
    readonly surplusQualityScale: number;
    readonly maxQuality: number;
  };
  readonly stages: readonly StageDef[];
  readonly reputation: {
    readonly starting: number;
    readonly max: number;
    readonly perExpedition: number;
    readonly perBossDefeated: number;
    readonly perWorldBossDefeated: number;
    readonly perZoneTier: Readonly<Record<string, number>>;
    readonly lossPerWipe: number;
    readonly lossPerDeath: number;
  };
  readonly assignment: {
    readonly weights: Readonly<Record<string, number>>;
    readonly maxFatigueForWork: number;
    /** Output at which a job counts as fully worth doing. Normalises the rank-3 term. */
    readonly outputReference: number;
  };
  readonly departments: {
    readonly headQualification: {
      readonly perLevel: number;
      readonly perAttributePoint: number;
      readonly maxBonus: number;
      readonly deputyScale: number;
      readonly guildAiFallback: number;
    };
    readonly performance: {
      readonly staffingTarget: number;
      readonly outputPerStaffPoint: number;
    };
    readonly priorities: {
      readonly min: number;
      readonly max: number;
      readonly default: number;
    };
  };
}

const DEMAND_KEYS = ['housing', 'food', 'services'] as const;

function numbersOf<K extends string>(
  raw: unknown,
  path: string,
  keys: readonly K[],
): Readonly<Record<K, number>> {
  const o = expectObject(raw, path);
  const out = {} as Record<K, number>;
  for (const key of keys) {
    out[key] = expectNumber(field(o, key, path), `${path}.${key}`);
  }
  return out;
}

export function parseTownBalance(raw: unknown, path = 'town.json'): TownBalance {
  const o = expectObject(raw, path);
  const num = (obj: Record<string, unknown>, key: string, p: string): number =>
    expectNumber(field(obj, key, p), `${p}.${key}`);

  const grid = expectObject(field(o, 'grid', path), `${path}.grid`);
  const gridWidth = num(grid, 'width', `${path}.grid`);
  const gridHeight = num(grid, 'height', `${path}.grid`);
  if (!Number.isInteger(gridWidth) || !Number.isInteger(gridHeight) || gridWidth < 1 || gridHeight < 1) {
    throw new ContentValidationError(`${path}.grid`, 'the town grid must be whole cells, at least 1x1');
  }

  const population = expectObject(field(o, 'population', path), `${path}.population`);
  const growth = expectObject(field(population, 'growth', `${path}.population`), `${path}.population.growth`);
  const departure = expectObject(
    field(population, 'departure', `${path}.population`),
    `${path}.population.departure`,
  );

  const stability = expectObject(field(o, 'stability', path), `${path}.stability`);
  const bands = expectArray(
    field(stability, 'bands', `${path}.stability`),
    `${path}.stability.bands`,
  ).map((entry, index): StabilityBand => {
    const p = `${path}.stability.bands[${index}]`;
    const b = expectObject(entry, p);
    return {
      id: expectString(field(b, 'id', p), `${p}.id`),
      atLeast: expectNumber(field(b, 'atLeast', p), `${p}.atLeast`),
      label: expectString(field(b, 'label', p), `${p}.label`),
    };
  });
  if (bands.length === 0) {
    throw new ContentValidationError(`${path}.stability.bands`, 'at least one band is required');
  }
  // Read top-down, so the first band whose floor is met wins. Out-of-order bands would
  // silently make a band unreachable.
  bands.forEach((band, i) => {
    const previous = bands[i - 1];
    if (previous && band.atLeast >= previous.atLeast) {
      throw new ContentValidationError(
        `${path}.stability.bands[${i}].atLeast`,
        'bands must descend, so the first satisfied band is the best one',
      );
    }
  });
  if (bands[bands.length - 1]?.atLeast !== 0) {
    throw new ContentValidationError(
      `${path}.stability.bands`,
      'the last band must have a floor of 0, or a failing town falls through every band',
    );
  }

  const recovery = expectObject(field(o, 'recovery', path), `${path}.recovery`);
  const quality = expectObject(field(o, 'quality', path), `${path}.quality`);

  const stagesRaw = expectObject(field(o, 'stages', path), `${path}.stages`);
  const stages = expectArray(field(stagesRaw, 'order', `${path}.stages`), `${path}.stages.order`).map(
    (entry, index): StageDef => {
      const p = `${path}.stages.order[${index}]`;
      const s = expectObject(entry, p);
      const requires = expectObject(field(s, 'requires', p), `${p}.requires`);
      return {
        id: expectString(field(s, 'id', p), `${p}.id`),
        name: expectString(field(s, 'name', p), `${p}.name`),
        requires: {
          population: num(requires, 'population', `${p}.requires`),
          buildings: num(requires, 'buildings', `${p}.requires`),
          guildHallTier: num(requires, 'guildHallTier', `${p}.requires`),
        },
      };
    },
  );

  if (stages.length === 0) {
    throw new ContentValidationError(`${path}.stages.order`, 'at least one stage is required');
  }
  assertUniqueIds(
    stages.map((s) => s.id),
    `${path}.stages.order`,
  );
  // REQ-TWN-002's "no reset on progression" has a content half: if a later stage were
  // *easier* on any axis, a growing town could satisfy Hunter City while failing Fortified
  // Town, and the ladder would read as a bug rather than as progress.
  stages.forEach((stage, i) => {
    const previous = stages[i - 1];
    if (!previous) return;
    for (const key of ['population', 'buildings', 'guildHallTier'] as const) {
      if (stage.requires[key] < previous.requires[key]) {
        throw new ContentValidationError(
          `${path}.stages.order[${i}].requires.${key}`,
          `stage requirements must not decrease (REQ-TWN-002): ${stage.id} asks for less ` +
            `${key} than ${previous.id}`,
        );
      }
    }
  });
  if (
    stages[0]?.requires.population !== 0 ||
    stages[0]?.requires.buildings !== 0
  ) {
    throw new ContentValidationError(
      `${path}.stages.order[0].requires`,
      'the first stage must be satisfiable by an empty town, or a new guild has no stage at all',
    );
  }

  const reputation = expectObject(field(o, 'reputation', path), `${path}.reputation`);
  const perZoneTierRaw = expectObject(
    field(reputation, 'perZoneTier', `${path}.reputation`),
    `${path}.reputation.perZoneTier`,
  );
  const perZoneTier: Record<string, number> = {};
  for (const [key, value] of Object.entries(perZoneTierRaw)) {
    if (key.startsWith('$')) continue;
    perZoneTier[key] = expectNumber(value, `${path}.reputation.perZoneTier.${key}`);
  }

  const assignment = expectObject(field(o, 'assignment', path), `${path}.assignment`);
  const assignmentWeightsRaw = expectObject(
    field(assignment, 'weights', `${path}.assignment`),
    `${path}.assignment.weights`,
  );
  const assignmentWeights: Record<string, number> = {};
  for (const [key, value] of Object.entries(assignmentWeightsRaw)) {
    if (key.startsWith('$')) continue;
    assignmentWeights[key] = expectNumber(value, `${path}.assignment.weights.${key}`);
  }

  const departments = expectObject(field(o, 'departments', path), `${path}.departments`);
  // REQ-DEP-003 / conflict A10. The architecture test bans the identifier; this bans the
  // data, so a budget cannot arrive through content either.
  for (const key of Object.keys(departments)) {
    if (/budget/i.test(key)) {
      throw new ContentValidationError(
        `${path}.departments.${key}`,
        'REQ-DEP-003 forbids a Department Budget system; it must not be reintroduced',
      );
    }
  }
  const headQualification = expectObject(
    field(departments, 'headQualification', `${path}.departments`),
    `${path}.departments.headQualification`,
  );
  const performance = expectObject(
    field(departments, 'performance', `${path}.departments`),
    `${path}.departments.performance`,
  );
  const priorities = expectObject(
    field(departments, 'priorities', `${path}.departments`),
    `${path}.departments.priorities`,
  );

  const priorityMin = num(priorities, 'min', `${path}.departments.priorities`);
  const priorityMax = num(priorities, 'max', `${path}.departments.priorities`);
  const priorityDefault = num(priorities, 'default', `${path}.departments.priorities`);
  if (priorityDefault < priorityMin || priorityDefault > priorityMax) {
    throw new ContentValidationError(
      `${path}.departments.priorities.default`,
      `the default priority must sit within [${priorityMin}, ${priorityMax}]`,
    );
  }

  return {
    grid: { width: gridWidth, height: gridHeight },
    population: {
      starting: num(population, 'starting', `${path}.population`),
      perCapita: numbersOf(
        field(population, 'perCapita', `${path}.population`),
        `${path}.population.perCapita`,
        DEMAND_KEYS,
      ),
      growth: {
        basePerStep: num(growth, 'basePerStep', `${path}.population.growth`),
        perReputation: num(growth, 'perReputation', `${path}.population.growth`),
        prosperityScale: num(growth, 'prosperityScale', `${path}.population.growth`),
        maxPerStep: num(growth, 'maxPerStep', `${path}.population.growth`),
      },
      departure: {
        pressureThreshold: num(departure, 'pressureThreshold', `${path}.population.departure`),
        perStepAtFullPressure: num(
          departure,
          'perStepAtFullPressure',
          `${path}.population.departure`,
        ),
      },
    },
    stability: {
      weights: numbersOf(
        field(stability, 'weights', `${path}.stability`),
        `${path}.stability.weights`,
        DEMAND_KEYS,
      ),
      bands,
    },
    recovery: {
      baseFatigueClearedPerStep: num(recovery, 'baseFatigueClearedPerStep', `${path}.recovery`),
      injuryStepsAtBaseline: num(recovery, 'injuryStepsAtBaseline', `${path}.recovery`),
      recoveryStepsAtBaseline: num(recovery, 'recoveryStepsAtBaseline', `${path}.recovery`),
      minSteps: num(recovery, 'minSteps', `${path}.recovery`),
      maxSteps: num(recovery, 'maxSteps', `${path}.recovery`),
    },
    quality: {
      unbuiltHousingQuality: num(quality, 'unbuiltHousingQuality', `${path}.quality`),
      unbuiltServiceQuality: num(quality, 'unbuiltServiceQuality', `${path}.quality`),
      surplusQualityScale: num(quality, 'surplusQualityScale', `${path}.quality`),
      maxQuality: num(quality, 'maxQuality', `${path}.quality`),
    },
    stages,
    reputation: {
      starting: num(reputation, 'starting', `${path}.reputation`),
      max: num(reputation, 'max', `${path}.reputation`),
      perExpedition: num(reputation, 'perExpedition', `${path}.reputation`),
      perBossDefeated: num(reputation, 'perBossDefeated', `${path}.reputation`),
      perWorldBossDefeated: num(reputation, 'perWorldBossDefeated', `${path}.reputation`),
      perZoneTier,
      lossPerWipe: num(reputation, 'lossPerWipe', `${path}.reputation`),
      lossPerDeath: num(reputation, 'lossPerDeath', `${path}.reputation`),
    },
    assignment: {
      weights: assignmentWeights,
      maxFatigueForWork: num(assignment, 'maxFatigueForWork', `${path}.assignment`),
      outputReference: num(assignment, 'outputReference', `${path}.assignment`),
    },
    departments: {
      headQualification: {
        perLevel: num(headQualification, 'perLevel', `${path}.departments.headQualification`),
        perAttributePoint: num(
          headQualification,
          'perAttributePoint',
          `${path}.departments.headQualification`,
        ),
        maxBonus: num(headQualification, 'maxBonus', `${path}.departments.headQualification`),
        deputyScale: num(headQualification, 'deputyScale', `${path}.departments.headQualification`),
        guildAiFallback: num(
          headQualification,
          'guildAiFallback',
          `${path}.departments.headQualification`,
        ),
      },
      performance: {
        staffingTarget: num(performance, 'staffingTarget', `${path}.departments.performance`),
        outputPerStaffPoint: num(
          performance,
          'outputPerStaffPoint',
          `${path}.departments.performance`,
        ),
      },
      priorities: { min: priorityMin, max: priorityMax, default: priorityDefault },
    },
  };
}

/** Sum a list of capacities. Used wherever "what does the town provide" is asked. */
export function addCapacity(a: Capacity, b: Capacity): Capacity {
  return {
    housing: a.housing + b.housing,
    food: a.food + b.food,
    service: a.service + b.service,
    defence: a.defence + b.defence,
  };
}

/** Everything a building provides at a given tier — tiers accumulate rather than replace. */
export function capacityThroughTier(building: BuildingDef, tier: number): Capacity {
  return building.tiers
    .filter((t) => t.tier <= tier)
    .reduce((total, t) => addCapacity(total, t.capacity), EMPTY_CAPACITY);
}

/** Job slots a building provides at a given tier. A later tier's count replaces an earlier one. */
export function jobSlotsThroughTier(
  building: BuildingDef,
  tier: number,
): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of building.tiers) {
    if (t.tier > tier) break;
    // Replaced rather than summed: "forge_work: 3" at tier 2 is the new total, not three more.
    for (const [job, slots] of Object.entries(t.jobs)) out[job] = slots;
  }
  return out;
}

/** The footprint a building actually occupies once rotated (v1.0 §9). */
export function rotatedFootprint(footprint: Footprint, rotation: Rotation): Footprint {
  return rotation === 90 || rotation === 270
    ? { width: footprint.height, height: footprint.width }
    : footprint;
}
