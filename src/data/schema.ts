/**
 * Content types and their validators.
 *
 * REQ-TEC-002: gameplay data lives in JSON, separate from logic. Validation happens once at
 * load, so a malformed skill definition fails loudly at startup with a path to the offending
 * field rather than surfacing as `undefined` in the middle of combat three hours later.
 *
 * Hand-rolled rather than schema-library-driven, per DL-002 (zero runtime dependencies).
 * The validators are deliberately boring; their job is precise error messages.
 */

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

export const ATTRIBUTE_KEYS = ['str', 'agi', 'vit', 'dex', 'int', 'luk'] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

export const ROLES = ['tank', 'healer', 'damage', 'support', 'control'] as const;
export type Role = (typeof ROLES)[number];

export const RANGE_BANDS = ['melee', 'mid', 'ranged'] as const;
export type RangeBand = (typeof RANGE_BANDS)[number];

export const SKILL_CATEGORIES = [
  'active',
  'passive',
  'buff',
  'debuff',
  'ultimate',
  'party',
  'weapon',
  'movement',
  'trigger',
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const ELEMENTS = ['fire', 'frost', 'storm', 'earth'] as const;
export type Element = (typeof ELEMENTS)[number];

export const TARGETING = [
  'self',
  'ally',
  'allies',
  'downed_ally',
  'enemy',
  'enemies',
] as const;
export type Targeting = (typeof TARGETING)[number];

export const MASTERY_EFFECT_TYPES = [
  'power',
  'efficiency',
  'cooldown',
  'reliability',
  'duration',
  'range',
] as const;
export type MasteryEffectType = (typeof MASTERY_EFFECT_TYPES)[number];

export const CLASS_STAGES = ['archetype', 'advanced', 'specialization'] as const;
export type ClassStage = (typeof CLASS_STAGES)[number];

export type RoleWeights = Readonly<Partial<Record<Role, number>>>;
export type RangeWeights = Readonly<Partial<Record<RangeBand, number>>>;
export type AttributeWeights = Readonly<Partial<Record<AttributeKey, number>>>;

// ---------------------------------------------------------------------------
// Validation primitives
// ---------------------------------------------------------------------------

export class ContentValidationError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'ContentValidationError';
  }
}

function fail(path: string, message: string): never {
  throw new ContentValidationError(path, message);
}

export function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, `expected an object, got ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

export function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, `expected an array, got ${describe(value)}`);
  return value;
}

export function expectNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, `expected a finite number, got ${describe(value)}`);
  }
  return value;
}

export function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(path, `expected a non-empty string, got ${describe(value)}`);
  }
  return value;
}

export function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, `expected a boolean, got ${describe(value)}`);
  return value;
}

export function expectEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  const s = expectString(value, path);
  if (!allowed.includes(s as T)) {
    fail(path, `expected one of [${allowed.join(', ')}], got "${s}"`);
  }
  return s as T;
}

/** A partial record of enum key -> number, e.g. role weights. Unknown keys are an error. */
export function expectWeights<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): Readonly<Partial<Record<T, number>>> {
  const obj = expectObject(value, path);
  const out: Partial<Record<T, number>> = {};
  for (const [key, raw] of Object.entries(obj)) {
    if (key.startsWith('$')) continue;
    if (!allowed.includes(key as T)) {
      fail(`${path}.${key}`, `unknown key; expected one of [${allowed.join(', ')}]`);
    }
    out[key as T] = expectNumber(raw, `${path}.${key}`);
  }
  return out;
}

/** Number record with free-form string keys, e.g. per-effect curves. */
export function expectNumberRecord(value: unknown, path: string): Readonly<Record<string, number>> {
  const obj = expectObject(value, path);
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(obj)) {
    if (key.startsWith('$')) continue;
    out[key] = expectNumber(raw, `${path}.${key}`);
  }
  return out;
}

export function expectStringArray(value: unknown, path: string): readonly string[] {
  return expectArray(value, path).map((v, i) => expectString(v, `${path}[${i}]`));
}

export function field(obj: Record<string, unknown>, key: string, path: string): unknown {
  if (!(key in obj)) fail(`${path}.${key}`, 'required field is missing');
  return obj[key];
}

export function optionalField(obj: Record<string, unknown>, key: string): unknown {
  return obj[key];
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

/** Reject duplicate ids in a content list — a silent duplicate would shadow content. */
export function assertUniqueIds(ids: readonly string[], path: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) fail(path, `duplicate id "${id}"`);
    seen.add(id);
  }
}

// ---------------------------------------------------------------------------
// Balance: attributes
// ---------------------------------------------------------------------------

export interface DerivedStatFormula {
  readonly base: number;
  readonly perLevel: number;
  readonly from: AttributeWeights;
}

export interface AttributeBalance {
  readonly startingValue: number;
  readonly pointsPerLevel: number;
  readonly startingPoints: number;
  readonly minLevel: number;
  readonly maxLevel: number;
  readonly xpCurve: { readonly base: number; readonly exponent: number };
  readonly respec: {
    readonly resourceId: string;
    readonly costPerPointMoved: number;
    readonly freeMovesPerLevel: number;
  };
  readonly derived: Readonly<Record<string, DerivedStatFormula>>;
  readonly caps: Readonly<Record<string, number>>;
}

export function parseAttributeBalance(raw: unknown, path = 'attributes.json'): AttributeBalance {
  const o = expectObject(raw, path);
  const xp = expectObject(field(o, 'xpCurve', path), `${path}.xpCurve`);
  const respec = expectObject(field(o, 'respec', path), `${path}.respec`);
  const derivedRaw = expectObject(field(o, 'derived', path), `${path}.derived`);

  const derived: Record<string, DerivedStatFormula> = {};
  for (const [key, value] of Object.entries(derivedRaw)) {
    if (key.startsWith('$')) continue;
    const p = `${path}.derived.${key}`;
    const d = expectObject(value, p);
    derived[key] = {
      base: expectNumber(field(d, 'base', p), `${p}.base`),
      perLevel: expectNumber(field(d, 'perLevel', p), `${p}.perLevel`),
      from: expectWeights(field(d, 'from', p), `${p}.from`, ATTRIBUTE_KEYS),
    };
  }

  const balance: AttributeBalance = {
    startingValue: expectNumber(field(o, 'startingValue', path), `${path}.startingValue`),
    pointsPerLevel: expectNumber(field(o, 'pointsPerLevel', path), `${path}.pointsPerLevel`),
    startingPoints: expectNumber(field(o, 'startingPoints', path), `${path}.startingPoints`),
    minLevel: expectNumber(field(o, 'minLevel', path), `${path}.minLevel`),
    maxLevel: expectNumber(field(o, 'maxLevel', path), `${path}.maxLevel`),
    xpCurve: {
      base: expectNumber(field(xp, 'base', `${path}.xpCurve`), `${path}.xpCurve.base`),
      exponent: expectNumber(field(xp, 'exponent', `${path}.xpCurve`), `${path}.xpCurve.exponent`),
    },
    respec: {
      resourceId: expectString(field(respec, 'resourceId', `${path}.respec`), `${path}.respec.resourceId`),
      costPerPointMoved: expectNumber(
        field(respec, 'costPerPointMoved', `${path}.respec`),
        `${path}.respec.costPerPointMoved`,
      ),
      freeMovesPerLevel: expectNumber(
        field(respec, 'freeMovesPerLevel', `${path}.respec`),
        `${path}.respec.freeMovesPerLevel`,
      ),
    },
    derived,
    caps: expectNumberRecord(field(o, 'caps', path), `${path}.caps`),
  };

  if (balance.minLevel < 1) fail(`${path}.minLevel`, 'must be at least 1');
  if (balance.maxLevel <= balance.minLevel) {
    fail(`${path}.maxLevel`, 'must be greater than minLevel');
  }
  for (const capKey of Object.keys(balance.caps)) {
    if (!(capKey in balance.derived)) {
      fail(`${path}.caps.${capKey}`, 'caps a derived stat that is not defined');
    }
  }
  return balance;
}

// ---------------------------------------------------------------------------
// Balance: mastery
// ---------------------------------------------------------------------------

export interface SaturatingCurve {
  readonly maxBonus: number;
  readonly halfPoint: number;
}

export interface MasteryBalance {
  readonly gainPerUse: number;
  readonly gainMultiplierBySignificance: Readonly<Record<string, number>>;
  readonly milestones: readonly number[];
  readonly effectCurves: Readonly<Record<MasteryEffectType, SaturatingCurve>>;
  readonly buildIdentityInfluence: { readonly maxWeight: number; readonly halfPoint: number };
}

function parseCurve(raw: unknown, path: string): SaturatingCurve {
  const o = expectObject(raw, path);
  const curve = {
    maxBonus: expectNumber(field(o, 'maxBonus', path), `${path}.maxBonus`),
    halfPoint: expectNumber(field(o, 'halfPoint', path), `${path}.halfPoint`),
  };
  if (curve.halfPoint <= 0) fail(`${path}.halfPoint`, 'must be positive');
  return curve;
}

export function parseMasteryBalance(raw: unknown, path = 'mastery.json'): MasteryBalance {
  const o = expectObject(raw, path);
  const curvesRaw = expectObject(field(o, 'effectCurves', path), `${path}.effectCurves`);

  const effectCurves = {} as Record<MasteryEffectType, SaturatingCurve>;
  for (const type of MASTERY_EFFECT_TYPES) {
    if (!(type in curvesRaw)) {
      fail(`${path}.effectCurves.${type}`, 'every mastery effect type needs a curve');
    }
    effectCurves[type] = parseCurve(curvesRaw[type], `${path}.effectCurves.${type}`);
  }

  const influence = expectObject(
    field(o, 'buildIdentityInfluence', path),
    `${path}.buildIdentityInfluence`,
  );
  const milestones = expectArray(field(o, 'milestones', path), `${path}.milestones`).map((v, i) =>
    expectNumber(v, `${path}.milestones[${i}]`),
  );
  for (let i = 1; i < milestones.length; i++) {
    if ((milestones[i] ?? 0) <= (milestones[i - 1] ?? 0)) {
      fail(`${path}.milestones`, 'must be strictly increasing');
    }
  }

  return {
    gainPerUse: expectNumber(field(o, 'gainPerUse', path), `${path}.gainPerUse`),
    gainMultiplierBySignificance: expectNumberRecord(
      field(o, 'gainMultiplierBySignificance', path),
      `${path}.gainMultiplierBySignificance`,
    ),
    milestones,
    effectCurves,
    buildIdentityInfluence: {
      maxWeight: expectNumber(
        field(influence, 'maxWeight', `${path}.buildIdentityInfluence`),
        `${path}.buildIdentityInfluence.maxWeight`,
      ),
      halfPoint: expectNumber(
        field(influence, 'halfPoint', `${path}.buildIdentityInfluence`),
        `${path}.buildIdentityInfluence.halfPoint`,
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Balance: build identity
// ---------------------------------------------------------------------------

export interface Clamp {
  readonly min: number;
  readonly max: number;
}

export interface BuildIdentityBalance {
  readonly sourceWeights: {
    readonly class: number;
    readonly attributes: number;
    readonly skills: number;
    readonly equipment: number;
    readonly cards: number;
    readonly skillBooks: number;
  };
  readonly attributeRoleAffinity: Readonly<Record<AttributeKey, RoleWeights>>;
  readonly attributeRangeAffinity: Readonly<Record<AttributeKey, RangeWeights>>;
  readonly riskPosture: {
    readonly base: number;
    readonly fromAttributeRatio: {
      readonly offensive: readonly AttributeKey[];
      readonly defensive: readonly AttributeKey[];
      readonly influence: number;
    };
    readonly fromRoleLean: RoleWeights;
    readonly clamp: Clamp;
  };
  readonly resourceProfile: {
    readonly base: number;
    readonly costInfluence: number;
    readonly cooldownInfluence: number;
    readonly clamp: Clamp;
  };
  readonly versatility: { readonly perUnequippedKnownSkill: number; readonly cap: number };
  readonly confidence: {
    readonly specialistThreshold: number;
    readonly generalistThreshold: number;
  };
}

function parseClamp(raw: unknown, path: string): Clamp {
  const o = expectObject(raw, path);
  const c = {
    min: expectNumber(field(o, 'min', path), `${path}.min`),
    max: expectNumber(field(o, 'max', path), `${path}.max`),
  };
  if (c.max < c.min) fail(path, 'max must be >= min');
  return c;
}

export function parseBuildIdentityBalance(
  raw: unknown,
  path = 'build-identity.json',
): BuildIdentityBalance {
  const o = expectObject(raw, path);
  const sw = expectObject(field(o, 'sourceWeights', path), `${path}.sourceWeights`);
  const risk = expectObject(field(o, 'riskPosture', path), `${path}.riskPosture`);
  const ratio = expectObject(
    field(risk, 'fromAttributeRatio', `${path}.riskPosture`),
    `${path}.riskPosture.fromAttributeRatio`,
  );
  const res = expectObject(field(o, 'resourceProfile', path), `${path}.resourceProfile`);
  const vers = expectObject(field(o, 'versatility', path), `${path}.versatility`);
  const conf = expectObject(field(o, 'confidence', path), `${path}.confidence`);

  const roleAffRaw = expectObject(
    field(o, 'attributeRoleAffinity', path),
    `${path}.attributeRoleAffinity`,
  );
  const rangeAffRaw = expectObject(
    field(o, 'attributeRangeAffinity', path),
    `${path}.attributeRangeAffinity`,
  );

  const attributeRoleAffinity = {} as Record<AttributeKey, RoleWeights>;
  const attributeRangeAffinity = {} as Record<AttributeKey, RangeWeights>;
  for (const key of ATTRIBUTE_KEYS) {
    if (!(key in roleAffRaw)) {
      fail(`${path}.attributeRoleAffinity.${key}`, 'every attribute needs a role affinity');
    }
    if (!(key in rangeAffRaw)) {
      fail(`${path}.attributeRangeAffinity.${key}`, 'every attribute needs a range affinity');
    }
    attributeRoleAffinity[key] = expectWeights(
      roleAffRaw[key],
      `${path}.attributeRoleAffinity.${key}`,
      ROLES,
    );
    attributeRangeAffinity[key] = expectWeights(
      rangeAffRaw[key],
      `${path}.attributeRangeAffinity.${key}`,
      RANGE_BANDS,
    );
  }

  const readAttrList = (value: unknown, p: string): readonly AttributeKey[] =>
    expectArray(value, p).map((v, i) => expectEnum(v, `${p}[${i}]`, ATTRIBUTE_KEYS));

  const num = (obj: Record<string, unknown>, key: string, p: string): number =>
    expectNumber(field(obj, key, p), `${p}.${key}`);

  return {
    sourceWeights: {
      class: num(sw, 'class', `${path}.sourceWeights`),
      attributes: num(sw, 'attributes', `${path}.sourceWeights`),
      skills: num(sw, 'skills', `${path}.sourceWeights`),
      equipment: num(sw, 'equipment', `${path}.sourceWeights`),
      cards: num(sw, 'cards', `${path}.sourceWeights`),
      skillBooks: num(sw, 'skillBooks', `${path}.sourceWeights`),
    },
    attributeRoleAffinity,
    attributeRangeAffinity,
    riskPosture: {
      base: num(risk, 'base', `${path}.riskPosture`),
      fromAttributeRatio: {
        offensive: readAttrList(
          field(ratio, 'offensive', `${path}.riskPosture.fromAttributeRatio`),
          `${path}.riskPosture.fromAttributeRatio.offensive`,
        ),
        defensive: readAttrList(
          field(ratio, 'defensive', `${path}.riskPosture.fromAttributeRatio`),
          `${path}.riskPosture.fromAttributeRatio.defensive`,
        ),
        influence: num(ratio, 'influence', `${path}.riskPosture.fromAttributeRatio`),
      },
      fromRoleLean: expectWeights(
        field(risk, 'fromRoleLean', `${path}.riskPosture`),
        `${path}.riskPosture.fromRoleLean`,
        ROLES,
      ),
      clamp: parseClamp(field(risk, 'clamp', `${path}.riskPosture`), `${path}.riskPosture.clamp`),
    },
    resourceProfile: {
      base: num(res, 'base', `${path}.resourceProfile`),
      costInfluence: num(res, 'costInfluence', `${path}.resourceProfile`),
      cooldownInfluence: num(res, 'cooldownInfluence', `${path}.resourceProfile`),
      clamp: parseClamp(
        field(res, 'clamp', `${path}.resourceProfile`),
        `${path}.resourceProfile.clamp`,
      ),
    },
    versatility: {
      perUnequippedKnownSkill: num(vers, 'perUnequippedKnownSkill', `${path}.versatility`),
      cap: num(vers, 'cap', `${path}.versatility`),
    },
    confidence: {
      specialistThreshold: num(conf, 'specialistThreshold', `${path}.confidence`),
      generalistThreshold: num(conf, 'generalistThreshold', `${path}.confidence`),
    },
  };
}

// ---------------------------------------------------------------------------
// Balance: potential
// ---------------------------------------------------------------------------

export interface PotentialFacetRange {
  readonly min: number;
  readonly max: number;
}

export interface PotentialBalance {
  readonly facets: Readonly<Record<string, PotentialFacetRange>>;
  readonly traitSlots: readonly { readonly value: number; readonly weight: number }[];
  readonly uniqueSkillChance: number;
  readonly tiers: {
    readonly order: readonly string[];
    readonly thresholds: Readonly<Record<string, number>>;
    readonly compositeWeights: Readonly<Record<string, number>>;
  };
}

export function parsePotentialBalance(raw: unknown, path = 'potential.json'): PotentialBalance {
  const o = expectObject(raw, path);
  const facetsRaw = expectObject(field(o, 'facets', path), `${path}.facets`);
  const facets: Record<string, PotentialFacetRange> = {};
  for (const [key, value] of Object.entries(facetsRaw)) {
    if (key.startsWith('$')) continue;
    const p = `${path}.facets.${key}`;
    const f = expectObject(value, p);
    const range = {
      min: expectNumber(field(f, 'min', p), `${p}.min`),
      max: expectNumber(field(f, 'max', p), `${p}.max`),
    };
    if (range.max < range.min) fail(p, 'max must be >= min');
    facets[key] = range;
  }

  const slotsRaw = expectObject(field(o, 'traitSlots', path), `${path}.traitSlots`);
  const traitSlots = expectArray(
    field(slotsRaw, 'weights', `${path}.traitSlots`),
    `${path}.traitSlots.weights`,
  ).map((v, i) => {
    const p = `${path}.traitSlots.weights[${i}]`;
    const e = expectObject(v, p);
    return {
      value: expectNumber(field(e, 'value', p), `${p}.value`),
      weight: expectNumber(field(e, 'weight', p), `${p}.weight`),
    };
  });

  const tiers = expectObject(field(o, 'tiers', path), `${path}.tiers`);
  const order = expectStringArray(field(tiers, 'order', `${path}.tiers`), `${path}.tiers.order`);
  const thresholds = expectNumberRecord(
    field(tiers, 'thresholds', `${path}.tiers`),
    `${path}.tiers.thresholds`,
  );
  for (const tier of order) {
    if (!(tier in thresholds)) fail(`${path}.tiers.thresholds.${tier}`, 'missing threshold');
  }

  return {
    facets,
    traitSlots,
    uniqueSkillChance: expectNumber(
      field(o, 'uniqueSkillChance', path),
      `${path}.uniqueSkillChance`,
    ),
    tiers: {
      order,
      thresholds,
      compositeWeights: expectNumberRecord(
        field(tiers, 'compositeWeights', `${path}.tiers`),
        `${path}.tiers.compositeWeights`,
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Balance: personality / condition
// ---------------------------------------------------------------------------

export interface PersonalityBalance {
  readonly clamp: {
    readonly riskPostureShift: Clamp;
    readonly roleLeanShift: Clamp;
    readonly utilityWeightShift: Clamp;
  };
  readonly moraleInfluence: {
    readonly riskPostureAtLowMorale: number;
    readonly riskPostureAtHighMorale: number;
  };
  readonly conditionInfluence: {
    readonly fatigue: { readonly statPenaltyAtMax: number; readonly riskPostureShiftAtMax: number };
    readonly hunger: { readonly statPenaltyAtMax: number; readonly riskPostureShiftAtMax: number };
  };
}

export function parsePersonalityBalance(
  raw: unknown,
  path = 'personality.json',
): PersonalityBalance {
  const o = expectObject(raw, path);
  const clamp = expectObject(field(o, 'clamp', path), `${path}.clamp`);
  const morale = expectObject(field(o, 'moraleInfluence', path), `${path}.moraleInfluence`);
  const cond = expectObject(field(o, 'conditionInfluence', path), `${path}.conditionInfluence`);

  const parsePenalty = (key: 'fatigue' | 'hunger') => {
    const p = `${path}.conditionInfluence.${key}`;
    const c = expectObject(field(cond, key, `${path}.conditionInfluence`), p);
    return {
      statPenaltyAtMax: expectNumber(field(c, 'statPenaltyAtMax', p), `${p}.statPenaltyAtMax`),
      riskPostureShiftAtMax: expectNumber(
        field(c, 'riskPostureShiftAtMax', p),
        `${p}.riskPostureShiftAtMax`,
      ),
    };
  };

  return {
    clamp: {
      riskPostureShift: parseClamp(
        field(clamp, 'riskPostureShift', `${path}.clamp`),
        `${path}.clamp.riskPostureShift`,
      ),
      roleLeanShift: parseClamp(
        field(clamp, 'roleLeanShift', `${path}.clamp`),
        `${path}.clamp.roleLeanShift`,
      ),
      utilityWeightShift: parseClamp(
        field(clamp, 'utilityWeightShift', `${path}.clamp`),
        `${path}.clamp.utilityWeightShift`,
      ),
    },
    moraleInfluence: {
      riskPostureAtLowMorale: expectNumber(
        field(morale, 'riskPostureAtLowMorale', `${path}.moraleInfluence`),
        `${path}.moraleInfluence.riskPostureAtLowMorale`,
      ),
      riskPostureAtHighMorale: expectNumber(
        field(morale, 'riskPostureAtHighMorale', `${path}.moraleInfluence`),
        `${path}.moraleInfluence.riskPostureAtHighMorale`,
      ),
    },
    conditionInfluence: { fatigue: parsePenalty('fatigue'), hunger: parsePenalty('hunger') },
  };
}

// ---------------------------------------------------------------------------
// Balance: chronicle
// ---------------------------------------------------------------------------

export interface ChronicleBalance {
  readonly counters: readonly string[];
  readonly notableRing: { readonly capacity: number; readonly minSignificance: number };
  readonly significance: Readonly<Record<string, number>>;
}

export function parseChronicleBalance(raw: unknown, path = 'chronicle.json'): ChronicleBalance {
  const o = expectObject(raw, path);
  const ring = expectObject(field(o, 'notableRing', path), `${path}.notableRing`);
  const capacity = expectNumber(
    field(ring, 'capacity', `${path}.notableRing`),
    `${path}.notableRing.capacity`,
  );
  if (capacity <= 0) fail(`${path}.notableRing.capacity`, 'must be positive');
  return {
    counters: expectStringArray(field(o, 'counters', path), `${path}.counters`),
    notableRing: {
      capacity,
      minSignificance: expectNumber(
        field(ring, 'minSignificance', `${path}.notableRing`),
        `${path}.notableRing.minSignificance`,
      ),
    },
    significance: expectNumberRecord(field(o, 'significance', path), `${path}.significance`),
  };
}

// ---------------------------------------------------------------------------
// Content: class chain
// ---------------------------------------------------------------------------

/** Shared shape across all three class stages — the chain is uniform by design (REQ-CLS-001). */
export interface ClassNodeDef {
  readonly id: string;
  readonly name: string;
  readonly stage: ClassStage;
  /** Parent node id; undefined for archetypes. */
  readonly parent: string | undefined;
  readonly requiredLevel: number;
  readonly description: string;
  readonly roleLean: RoleWeights;
  readonly rangeBand: RangeWeights;
  readonly attributeAffinity: AttributeWeights;
  readonly riskPostureShift: number;
  readonly skillTags: readonly string[];
}

function parseClassNodeBody(
  o: Record<string, unknown>,
  path: string,
  stage: ClassStage,
  parent: string | undefined,
  requiredLevel: number,
): ClassNodeDef {
  return {
    id: expectString(field(o, 'id', path), `${path}.id`),
    name: expectString(field(o, 'name', path), `${path}.name`),
    stage,
    parent,
    requiredLevel,
    description: expectString(field(o, 'description', path), `${path}.description`),
    roleLean: expectWeights(field(o, 'roleLean', path), `${path}.roleLean`, ROLES),
    rangeBand: expectWeights(field(o, 'rangeBand', path), `${path}.rangeBand`, RANGE_BANDS),
    attributeAffinity: expectWeights(
      field(o, 'attributeAffinity', path),
      `${path}.attributeAffinity`,
      ATTRIBUTE_KEYS,
    ),
    riskPostureShift: expectNumber(
      field(o, 'riskPostureShift', path),
      `${path}.riskPostureShift`,
    ),
    skillTags: expectStringArray(field(o, 'skillTags', path), `${path}.skillTags`),
  };
}

export function parseArchetypes(raw: unknown, path = 'archetypes.json'): readonly ClassNodeDef[] {
  const o = expectObject(raw, path);
  const list = expectArray(field(o, 'archetypes', path), `${path}.archetypes`);
  const parsed = list.map((entry, i) => {
    const p = `${path}.archetypes[${i}]`;
    return parseClassNodeBody(expectObject(entry, p), p, 'archetype', undefined, 1);
  });
  assertUniqueIds(parsed.map((a) => a.id), `${path}.archetypes`);
  return parsed;
}

// ---------------------------------------------------------------------------
// Content: skills
// ---------------------------------------------------------------------------

/**
 * Skill usability conditions (REQ-SKL-006/007). These are what make reactive behavior
 * possible without a reaction-skill category (REQ-SKL-004): `wasAttackedWithin` on an
 * ordinary active skill *is* a counter-attack.
 */
export const CONDITION_TYPES = [
  'resourceAtLeast',
  'selfHpBelow',
  'allyHpBelow',
  'allyDowned',
  'allyThreatenedWithin',
  'wasAttackedWithin',
  'enemiesWithinRadiusAtLeast',
  'partySizeAtLeast',
  'targetHasStatus',
] as const;
export type ConditionType = (typeof CONDITION_TYPES)[number];

export interface SkillCondition {
  readonly type: ConditionType;
  readonly value: number;
}

export interface SkillDef {
  readonly id: string;
  readonly name: string;
  readonly category: SkillCategory;
  readonly tags: readonly string[];
  readonly element: Element | undefined;
  readonly targeting: Targeting;
  readonly rangeBand: RangeBand;
  readonly resourceCost: number;
  readonly cooldownSeconds: number;
  readonly basePriority: number;
  readonly conditions: readonly SkillCondition[];
  readonly masteryEffects: readonly MasteryEffectType[];
  readonly roleContribution: RoleWeights;
  readonly description: string;
}

export function parseSkills(raw: unknown, path = 'skills.json'): readonly SkillDef[] {
  const o = expectObject(raw, path);
  const list = expectArray(field(o, 'skills', path), `${path}.skills`);
  const parsed = list.map((entry, i) => {
    const p = `${path}.skills[${i}]`;
    const e = expectObject(entry, p);
    const elementRaw = optionalField(e, 'element');
    const skill: SkillDef = {
      id: expectString(field(e, 'id', p), `${p}.id`),
      name: expectString(field(e, 'name', p), `${p}.name`),
      category: expectEnum(field(e, 'category', p), `${p}.category`, SKILL_CATEGORIES),
      tags: expectStringArray(field(e, 'tags', p), `${p}.tags`),
      element:
        elementRaw === null || elementRaw === undefined
          ? undefined
          : expectEnum(elementRaw, `${p}.element`, ELEMENTS),
      targeting: expectEnum(field(e, 'targeting', p), `${p}.targeting`, TARGETING),
      rangeBand: expectEnum(field(e, 'rangeBand', p), `${p}.rangeBand`, RANGE_BANDS),
      resourceCost: expectNumber(field(e, 'resourceCost', p), `${p}.resourceCost`),
      cooldownSeconds: expectNumber(field(e, 'cooldownSeconds', p), `${p}.cooldownSeconds`),
      basePriority: expectNumber(field(e, 'basePriority', p), `${p}.basePriority`),
      conditions: expectArray(field(e, 'conditions', p), `${p}.conditions`).map((c, ci) => {
        const cp = `${p}.conditions[${ci}]`;
        const co = expectObject(c, cp);
        return {
          type: expectEnum(field(co, 'type', cp), `${cp}.type`, CONDITION_TYPES),
          value: expectNumber(field(co, 'value', cp), `${cp}.value`),
        };
      }),
      masteryEffects: expectArray(field(e, 'masteryEffects', p), `${p}.masteryEffects`).map(
        (m, mi) => expectEnum(m, `${p}.masteryEffects[${mi}]`, MASTERY_EFFECT_TYPES),
      ),
      roleContribution: expectWeights(
        field(e, 'roleContribution', p),
        `${p}.roleContribution`,
        ROLES,
      ),
      description: expectString(field(e, 'description', p), `${p}.description`),
    };
    if (skill.resourceCost < 0) fail(`${p}.resourceCost`, 'must not be negative');
    if (skill.cooldownSeconds < 0) fail(`${p}.cooldownSeconds`, 'must not be negative');
    return skill;
  });
  assertUniqueIds(parsed.map((s) => s.id), `${path}.skills`);
  return parsed;
}

// ---------------------------------------------------------------------------
// Content: personalities and traits
// ---------------------------------------------------------------------------

export interface PersonalityDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly riskPostureShift: number;
  readonly roleLeanShift: RoleWeights;
  readonly utilityWeightShift: Readonly<Record<string, number>>;
  readonly moraleResilience: number;
}

export function parsePersonalities(
  raw: unknown,
  path = 'personalities.json',
): readonly PersonalityDef[] {
  const o = expectObject(raw, path);
  const parsed = expectArray(field(o, 'personalities', path), `${path}.personalities`).map(
    (entry, i) => {
      const p = `${path}.personalities[${i}]`;
      const e = expectObject(entry, p);
      return {
        id: expectString(field(e, 'id', p), `${p}.id`),
        name: expectString(field(e, 'name', p), `${p}.name`),
        description: expectString(field(e, 'description', p), `${p}.description`),
        riskPostureShift: expectNumber(
          field(e, 'riskPostureShift', p),
          `${p}.riskPostureShift`,
        ),
        roleLeanShift: expectWeights(field(e, 'roleLeanShift', p), `${p}.roleLeanShift`, ROLES),
        utilityWeightShift: expectNumberRecord(
          field(e, 'utilityWeightShift', p),
          `${p}.utilityWeightShift`,
        ),
        moraleResilience: expectNumber(
          field(e, 'moraleResilience', p),
          `${p}.moraleResilience`,
        ),
      };
    },
  );
  assertUniqueIds(parsed.map((x) => x.id), `${path}.personalities`);
  return parsed;
}

export interface NamePool {
  readonly id: string;
  readonly given: readonly string[];
  readonly family: readonly string[];
}

export function parseNamePools(raw: unknown, path = 'names.json'): readonly NamePool[] {
  const o = expectObject(raw, path);
  const parsed = expectArray(field(o, 'pools', path), `${path}.pools`).map((entry, i) => {
    const p = `${path}.pools[${i}]`;
    const e = expectObject(entry, p);
    const pool = {
      id: expectString(field(e, 'id', p), `${p}.id`),
      given: expectStringArray(field(e, 'given', p), `${p}.given`),
      family: expectStringArray(field(e, 'family', p), `${p}.family`),
    };
    if (pool.given.length === 0 || pool.family.length === 0) {
      fail(p, 'a name pool needs at least one given name and one family name');
    }
    return pool;
  });
  assertUniqueIds(parsed.map((p) => p.id), `${path}.pools`);
  return parsed;
}

export const TRAIT_ORIGINS = ['innate', 'legacy'] as const;
export type TraitOrigin = (typeof TRAIT_ORIGINS)[number];

export interface TraitDef {
  readonly id: string;
  readonly name: string;
  readonly origin: TraitOrigin;
  readonly description: string;
  readonly effects: Readonly<Record<string, number>>;
  /**
   * For a Legacy Trait (REQ-LEG-004): the historic Chronicle entry kind it grows out of.
   * History becomes mechanical only through an explicit conversion (REQ-CHR-003) — here, a
   * mentor passing the trait to an apprentice the player chose to take on.
   */
  readonly fromChronicle?: string;
}

export function parseTraits(raw: unknown, path = 'traits.json'): readonly TraitDef[] {
  const o = expectObject(raw, path);
  const parsed = expectArray(field(o, 'traits', path), `${path}.traits`).map((entry, i) => {
    const p = `${path}.traits[${i}]`;
    const e = expectObject(entry, p);
    return {
      id: expectString(field(e, 'id', p), `${p}.id`),
      name: expectString(field(e, 'name', p), `${p}.name`),
      origin: expectEnum(field(e, 'origin', p), `${p}.origin`, TRAIT_ORIGINS),
      description: expectString(field(e, 'description', p), `${p}.description`),
      effects: expectNumberRecord(field(e, 'effects', p), `${p}.effects`),
      ...(e['fromChronicle'] !== undefined
        ? { fromChronicle: expectString(e['fromChronicle'], `${p}.fromChronicle`) }
        : {}),
    };
  });
  assertUniqueIds(parsed.map((t) => t.id), `${path}.traits`);
  return parsed;
}
