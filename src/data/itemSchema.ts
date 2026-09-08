/**
 * Content types and validators for equipment, cards, sets and refinement.
 *
 * Split out of schema.ts so neither file becomes the sort of module nobody wants to open.
 * The validation primitives are shared, so error messages stay in the same format
 * ("path.to.field: what was wrong").
 */

import {
  ATTRIBUTE_KEYS,
  RANGE_BANDS,
  ROLES,
  ContentValidationError,
  assertUniqueIds,
  expectArray,
  expectBoolean,
  expectEnum,
  expectNumber,
  expectNumberRecord,
  expectObject,
  expectString,
  expectStringArray,
  expectWeights,
  field,
  optionalField,
  type RangeWeights,
  type RoleWeights,
} from './schema.js';

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export const EQUIPMENT_SLOTS = [
  'weapon',
  'offhand',
  'head',
  'body',
  'hands',
  'feet',
  'trinket',
] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

/**
 * Declarative effect. Items, cards, sets and unique effects all speak this language, so
 * Phase 4 combat and AI consume one vocabulary rather than four.
 */
export const ITEM_EFFECT_TYPES = [
  'skillTagPower',
  'skillTagCost',
  'threatGeneration',
  'aiWeightShift',
  'statusChance',
  'overhealConversion',
  'downedTimerBonus',
  'interruptReadiness',
] as const;
export type ItemEffectType = (typeof ITEM_EFFECT_TYPES)[number];

export interface ItemEffect {
  readonly type: ItemEffectType;
  readonly value: number;
  /** Skill tag the effect applies to; '*' means every tag. */
  readonly tag: string | undefined;
  /** Named AI utility consideration, for aiWeightShift. */
  readonly key: string | undefined;
  /** Status id, for statusChance. */
  readonly status: string | undefined;
}

/** The build-identity contribution an item source declares (REQ-BLD-001). */
export interface IdentityContributionData {
  readonly roleLean: RoleWeights;
  readonly rangeBand: RangeWeights;
  readonly riskPostureShift: number;
  readonly skillAffinity: Readonly<Record<string, number>>;
}

export const EMPTY_IDENTITY_DATA: IdentityContributionData = {
  roleLean: {},
  rangeBand: {},
  riskPostureShift: 0,
  skillAffinity: {},
};

function parseEffect(raw: unknown, path: string): ItemEffect {
  const o = expectObject(raw, path);
  const type = expectEnum(field(o, 'type', path), `${path}.type`, ITEM_EFFECT_TYPES);
  const tagRaw = optionalField(o, 'tag');
  const keyRaw = optionalField(o, 'key');
  const statusRaw = optionalField(o, 'status');

  const effect: ItemEffect = {
    type,
    value: expectNumber(field(o, 'value', path), `${path}.value`),
    tag: tagRaw === undefined ? undefined : expectString(tagRaw, `${path}.tag`),
    key: keyRaw === undefined ? undefined : expectString(keyRaw, `${path}.key`),
    status: statusRaw === undefined ? undefined : expectString(statusRaw, `${path}.status`),
  };

  // Each effect type needs its own qualifier, or it is silently meaningless at runtime.
  if ((type === 'skillTagPower' || type === 'skillTagCost') && effect.tag === undefined) {
    throw new ContentValidationError(path, `${type} requires a "tag"`);
  }
  if (type === 'aiWeightShift' && effect.key === undefined) {
    throw new ContentValidationError(path, 'aiWeightShift requires a "key"');
  }
  if (type === 'statusChance' && effect.status === undefined) {
    throw new ContentValidationError(path, 'statusChance requires a "status"');
  }
  return effect;
}

function parseEffects(raw: unknown, path: string): readonly ItemEffect[] {
  return expectArray(raw, path).map((e, i) => parseEffect(e, `${path}[${i}]`));
}

function parseIdentity(raw: unknown, path: string): IdentityContributionData {
  if (raw === undefined) return EMPTY_IDENTITY_DATA;
  const o = expectObject(raw, path);
  const riskRaw = optionalField(o, 'riskPostureShift');
  return {
    roleLean: expectWeights(optionalField(o, 'roleLean') ?? {}, `${path}.roleLean`, ROLES),
    rangeBand: expectWeights(
      optionalField(o, 'rangeBand') ?? {},
      `${path}.rangeBand`,
      RANGE_BANDS,
    ),
    riskPostureShift:
      riskRaw === undefined ? 0 : expectNumber(riskRaw, `${path}.riskPostureShift`),
    skillAffinity: expectNumberRecord(
      optionalField(o, 'skillAffinity') ?? {},
      `${path}.skillAffinity`,
    ),
  };
}

// ---------------------------------------------------------------------------
// Rarities
// ---------------------------------------------------------------------------

export interface RarityDef {
  readonly id: string;
  readonly name: string;
  readonly colour: string;
  readonly substatCount: number;
  readonly sockets: { readonly min: number; readonly max: number };
  readonly mainStatMultiplier: number;
  readonly lootWeight: number;
  readonly canCarrySet: boolean;
  readonly canCarryUniqueEffect: boolean;
  readonly dismantleValue: number;
}

export interface RarityData {
  readonly rarities: readonly RarityDef[];
  readonly order: readonly string[];
}

export function parseRarities(raw: unknown, path = 'rarities.json'): RarityData {
  const o = expectObject(raw, path);
  const rarities = expectArray(field(o, 'rarities', path), `${path}.rarities`).map((entry, i) => {
    const p = `${path}.rarities[${i}]`;
    const e = expectObject(entry, p);
    const sockets = expectObject(field(e, 'sockets', p), `${p}.sockets`);
    const def: RarityDef = {
      id: expectString(field(e, 'id', p), `${p}.id`),
      name: expectString(field(e, 'name', p), `${p}.name`),
      colour: expectString(field(e, 'colour', p), `${p}.colour`),
      substatCount: expectNumber(field(e, 'substatCount', p), `${p}.substatCount`),
      sockets: {
        min: expectNumber(field(sockets, 'min', `${p}.sockets`), `${p}.sockets.min`),
        max: expectNumber(field(sockets, 'max', `${p}.sockets`), `${p}.sockets.max`),
      },
      mainStatMultiplier: expectNumber(
        field(e, 'mainStatMultiplier', p),
        `${p}.mainStatMultiplier`,
      ),
      lootWeight: expectNumber(field(e, 'lootWeight', p), `${p}.lootWeight`),
      canCarrySet: expectBoolean(field(e, 'canCarrySet', p), `${p}.canCarrySet`),
      canCarryUniqueEffect: expectBoolean(
        field(e, 'canCarryUniqueEffect', p),
        `${p}.canCarryUniqueEffect`,
      ),
      dismantleValue: expectNumber(field(e, 'dismantleValue', p), `${p}.dismantleValue`),
    };
    if (def.sockets.max < def.sockets.min) {
      throw new ContentValidationError(`${p}.sockets`, 'max must be >= min');
    }
    if (def.substatCount < 0) {
      throw new ContentValidationError(`${p}.substatCount`, 'must not be negative');
    }
    return def;
  });

  assertUniqueIds(rarities.map((r) => r.id), `${path}.rarities`);
  const order = expectStringArray(field(o, 'order', path), `${path}.order`);

  const ids = new Set(rarities.map((r) => r.id));
  for (const id of order) {
    if (!ids.has(id)) {
      throw new ContentValidationError(`${path}.order`, `"${id}" is not a defined rarity`);
    }
  }
  if (order.length !== rarities.length) {
    throw new ContentValidationError(`${path}.order`, 'must list every rarity exactly once');
  }

  return { rarities, order };
}

// ---------------------------------------------------------------------------
// Item types
// ---------------------------------------------------------------------------

export interface ItemTypeDef {
  readonly id: string;
  readonly name: string;
  readonly slot: EquipmentSlot;
  /** Main stat per item level. Fixed by type (REQ-EQP-002). */
  readonly mainStats: Readonly<Record<string, number>>;
  readonly roleLean: RoleWeights;
  readonly rangeBand: RangeWeights;
  readonly riskPostureShift: number;
  readonly skillAffinity: Readonly<Record<string, number>>;
  readonly substatPool: string;
}

export interface ItemTypeData {
  readonly slots: readonly EquipmentSlot[];
  readonly types: readonly ItemTypeDef[];
}

export function parseItemTypes(raw: unknown, path = 'item-types.json'): ItemTypeData {
  const o = expectObject(raw, path);
  const slots = expectArray(field(o, 'slots', path), `${path}.slots`).map((s, i) =>
    expectEnum(s, `${path}.slots[${i}]`, EQUIPMENT_SLOTS),
  );

  const types = expectArray(field(o, 'types', path), `${path}.types`).map((entry, i) => {
    const p = `${path}.types[${i}]`;
    const e = expectObject(entry, p);
    const mainStats = expectNumberRecord(field(e, 'mainStats', p), `${p}.mainStats`);
    if (Object.keys(mainStats).length === 0) {
      throw new ContentValidationError(`${p}.mainStats`, 'an item type needs at least one main stat');
    }
    return {
      id: expectString(field(e, 'id', p), `${p}.id`),
      name: expectString(field(e, 'name', p), `${p}.name`),
      slot: expectEnum(field(e, 'slot', p), `${p}.slot`, EQUIPMENT_SLOTS),
      mainStats,
      roleLean: expectWeights(field(e, 'roleLean', p), `${p}.roleLean`, ROLES),
      rangeBand: expectWeights(field(e, 'rangeBand', p), `${p}.rangeBand`, RANGE_BANDS),
      riskPostureShift: expectNumber(field(e, 'riskPostureShift', p), `${p}.riskPostureShift`),
      skillAffinity: expectNumberRecord(field(e, 'skillAffinity', p), `${p}.skillAffinity`),
      substatPool: expectString(field(e, 'substatPool', p), `${p}.substatPool`),
    };
  });

  assertUniqueIds(types.map((t) => t.id), `${path}.types`);

  // Every slot must have at least one item type, or a slot can never be filled.
  for (const slot of slots) {
    if (!types.some((t) => t.slot === slot)) {
      throw new ContentValidationError(
        `${path}.types`,
        `no item type fills the "${slot}" slot, so it could never be equipped`,
      );
    }
  }

  return { slots, types };
}

// ---------------------------------------------------------------------------
// Substats
// ---------------------------------------------------------------------------

export interface SubstatDef {
  readonly stat: string;
  readonly min: number;
  readonly max: number;
  readonly weight: number;
}

export interface SubstatData {
  readonly perfectThreshold: number;
  readonly pools: Readonly<Record<string, readonly SubstatDef[]>>;
}

export function parseSubstats(raw: unknown, path = 'substats.json'): SubstatData {
  const o = expectObject(raw, path);
  const poolsRaw = expectObject(field(o, 'pools', path), `${path}.pools`);

  const pools: Record<string, readonly SubstatDef[]> = {};
  for (const [name, value] of Object.entries(poolsRaw)) {
    if (name.startsWith('$')) continue;
    const poolPath = `${path}.pools.${name}`;
    const entries = expectArray(value, poolPath).map((entry, i) => {
      const p = `${poolPath}[${i}]`;
      const e = expectObject(entry, p);
      const def: SubstatDef = {
        stat: expectString(field(e, 'stat', p), `${p}.stat`),
        min: expectNumber(field(e, 'min', p), `${p}.min`),
        max: expectNumber(field(e, 'max', p), `${p}.max`),
        weight: expectNumber(field(e, 'weight', p), `${p}.weight`),
      };
      if (def.max < def.min) throw new ContentValidationError(p, 'max must be >= min');
      if (def.weight <= 0) throw new ContentValidationError(`${p}.weight`, 'must be positive');
      return def;
    });
    if (entries.length === 0) {
      throw new ContentValidationError(poolPath, 'a substat pool cannot be empty');
    }
    pools[name] = entries;
  }

  return {
    perfectThreshold: expectNumber(
      field(o, 'perfectThreshold', path),
      `${path}.perfectThreshold`,
    ),
    pools,
  };
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export interface CardSource {
  readonly kind: 'common' | 'boss';
  readonly bossId: string | undefined;
}

export interface CardDef {
  readonly id: string;
  readonly name: string;
  readonly rarity: string;
  readonly source: CardSource;
  /** Empty means universal (REQ-CRD-001 — cards have compatibility tags). */
  readonly compatibleTags: readonly string[];
  readonly compatibleSlots: readonly EquipmentSlot[];
  readonly description: string;
  readonly effects: readonly ItemEffect[];
  readonly identity: IdentityContributionData;
}

export function parseCards(raw: unknown, path = 'cards.json'): readonly CardDef[] {
  const o = expectObject(raw, path);
  const cards = expectArray(field(o, 'cards', path), `${path}.cards`).map((entry, i) => {
    const p = `${path}.cards[${i}]`;
    const e = expectObject(entry, p);
    const sourceRaw = expectObject(field(e, 'source', p), `${p}.source`);
    const kind = expectEnum(field(sourceRaw, 'kind', `${p}.source`), `${p}.source.kind`, [
      'common',
      'boss',
    ] as const);
    const bossIdRaw = optionalField(sourceRaw, 'bossId');
    if (kind === 'boss' && bossIdRaw === undefined) {
      throw new ContentValidationError(
        `${p}.source`,
        'a boss card must name its boss — each boss has its own pool (REQ-CRD-002)',
      );
    }

    const def: CardDef = {
      id: expectString(field(e, 'id', p), `${p}.id`),
      name: expectString(field(e, 'name', p), `${p}.name`),
      rarity: expectString(field(e, 'rarity', p), `${p}.rarity`),
      source: {
        kind,
        bossId: bossIdRaw === undefined ? undefined : expectString(bossIdRaw, `${p}.source.bossId`),
      },
      compatibleTags: expectStringArray(field(e, 'compatibleTags', p), `${p}.compatibleTags`),
      compatibleSlots: expectArray(field(e, 'compatibleSlots', p), `${p}.compatibleSlots`).map(
        (s, si) => expectEnum(s, `${p}.compatibleSlots[${si}]`, EQUIPMENT_SLOTS),
      ),
      description: expectString(field(e, 'description', p), `${p}.description`),
      effects: parseEffects(field(e, 'effects', p), `${p}.effects`),
      identity: parseIdentity(field(e, 'identity', p), `${p}.identity`),
    };

    if (def.effects.length === 0) {
      throw new ContentValidationError(
        `${p}.effects`,
        'a card with no effects is not build-changing (REQ-CRD-001)',
      );
    }
    if (def.compatibleSlots.length === 0) {
      throw new ContentValidationError(`${p}.compatibleSlots`, 'a card must fit somewhere');
    }
    return def;
  });

  assertUniqueIds(cards.map((c) => c.id), `${path}.cards`);
  return cards;
}

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

export interface SetTierDef {
  readonly pieces: number;
  readonly description: string;
  readonly effects: readonly ItemEffect[];
  readonly identity: IdentityContributionData;
}

export interface SetDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tiers: readonly SetTierDef[];
}

export function parseSets(raw: unknown, path = 'sets.json'): readonly SetDef[] {
  const o = expectObject(raw, path);
  const sets = expectArray(field(o, 'sets', path), `${path}.sets`).map((entry, i) => {
    const p = `${path}.sets[${i}]`;
    const e = expectObject(entry, p);

    const tiers = expectArray(field(e, 'tiers', p), `${p}.tiers`).map((tierRaw, ti) => {
      const tp = `${p}.tiers[${ti}]`;
      const t = expectObject(tierRaw, tp);
      const pieces = expectNumber(field(t, 'pieces', tp), `${tp}.pieces`);
      if (pieces < 2 || pieces > 4) {
        // REQ-EQP-006 fixes the tiers at 2, 3 and 4 pieces.
        throw new ContentValidationError(`${tp}.pieces`, 'set tiers are 2, 3 or 4 pieces');
      }
      return {
        pieces,
        description: expectString(field(t, 'description', tp), `${tp}.description`),
        effects: parseEffects(field(t, 'effects', tp), `${tp}.effects`),
        identity: parseIdentity(field(t, 'identity', tp), `${tp}.identity`),
      };
    });

    for (let ti = 1; ti < tiers.length; ti++) {
      if ((tiers[ti]?.pieces ?? 0) <= (tiers[ti - 1]?.pieces ?? 0)) {
        throw new ContentValidationError(`${p}.tiers`, 'piece counts must strictly increase');
      }
    }

    return {
      id: expectString(field(e, 'id', p), `${p}.id`),
      name: expectString(field(e, 'name', p), `${p}.name`),
      description: expectString(field(e, 'description', p), `${p}.description`),
      tiers,
    };
  });

  assertUniqueIds(sets.map((s) => s.id), `${path}.sets`);
  return sets;
}

// ---------------------------------------------------------------------------
// Unique (legendary) effects
// ---------------------------------------------------------------------------

export interface UniqueEffectDef {
  readonly id: string;
  readonly name: string;
  readonly slots: readonly EquipmentSlot[];
  readonly description: string;
  readonly effects: readonly ItemEffect[];
  readonly identity: IdentityContributionData;
}

export function parseUniqueEffects(
  raw: unknown,
  path = 'unique-effects.json',
): readonly UniqueEffectDef[] {
  const o = expectObject(raw, path);
  const effects = expectArray(field(o, 'effects', path), `${path}.effects`).map((entry, i) => {
    const p = `${path}.effects[${i}]`;
    const e = expectObject(entry, p);
    const def: UniqueEffectDef = {
      id: expectString(field(e, 'id', p), `${p}.id`),
      name: expectString(field(e, 'name', p), `${p}.name`),
      slots: expectArray(field(e, 'slots', p), `${p}.slots`).map((s, si) =>
        expectEnum(s, `${p}.slots[${si}]`, EQUIPMENT_SLOTS),
      ),
      description: expectString(field(e, 'description', p), `${p}.description`),
      effects: parseEffects(field(e, 'effects', p), `${p}.effects`),
      identity: parseIdentity(field(e, 'identity', p), `${p}.identity`),
    };
    if (def.slots.length === 0) {
      throw new ContentValidationError(`${p}.slots`, 'a unique effect must fit somewhere');
    }
    // REQ-EQP-007: a legendary must change how the build works, which means it needs a
    // behavioural effect, not only a numeric one.
    const behavioural = def.effects.some(
      (fx) => fx.type === 'aiWeightShift' || fx.type === 'downedTimerBonus' || fx.type === 'interruptReadiness',
    );
    if (!behavioural) {
      throw new ContentValidationError(
        `${p}.effects`,
        'a legendary unique effect must change behaviour, not only numbers (REQ-EQP-007)',
      );
    }
    return def;
  });

  assertUniqueIds(effects.map((e) => e.id), `${path}.effects`);
  return effects;
}

// ---------------------------------------------------------------------------
// Refinement and loot balance
// ---------------------------------------------------------------------------

export type RefinementFailure = 'nothing' | 'downgrade' | 'destroy';

export interface RefinementStep {
  readonly level: number;
  readonly successChance: number;
  readonly onFailure: RefinementFailure;
}

export interface RefinementBalance {
  readonly maxLevel: number;
  readonly safeLimit: number;
  readonly mainStatBonusPerLevel: number;
  readonly riskZone: readonly RefinementStep[];
  readonly downgradeLevels: number;
  readonly protection: { readonly resourceId: string; readonly costPerAttempt: number };
  readonly costPerAttempt: {
    readonly base: number;
    readonly perRefineLevel: number;
    readonly perItemLevel: number;
  };
}

export function parseRefinementBalance(
  raw: unknown,
  path = 'refinement.json',
): RefinementBalance {
  const o = expectObject(raw, path);
  const maxLevel = expectNumber(field(o, 'maxLevel', path), `${path}.maxLevel`);
  const safeLimit = expectNumber(field(o, 'safeLimit', path), `${path}.safeLimit`);
  if (safeLimit < 0 || safeLimit > maxLevel) {
    throw new ContentValidationError(`${path}.safeLimit`, 'must be between 0 and maxLevel');
  }

  const riskZone = expectArray(field(o, 'riskZone', path), `${path}.riskZone`).map((entry, i) => {
    const p = `${path}.riskZone[${i}]`;
    const e = expectObject(entry, p);
    const chance = expectNumber(field(e, 'successChance', p), `${p}.successChance`);
    if (chance <= 0 || chance > 1) {
      throw new ContentValidationError(`${p}.successChance`, 'must be in (0, 1]');
    }
    return {
      level: expectNumber(field(e, 'level', p), `${p}.level`),
      successChance: chance,
      onFailure: expectEnum(field(e, 'onFailure', p), `${p}.onFailure`, [
        'nothing',
        'downgrade',
        'destroy',
      ] as const),
    };
  });

  // Every level above the safe limit needs a defined step, or refinement silently stalls.
  for (let level = safeLimit + 1; level <= maxLevel; level++) {
    if (!riskZone.some((step) => step.level === level)) {
      throw new ContentValidationError(
        `${path}.riskZone`,
        `no step defined for refine level ${level}`,
      );
    }
  }

  const protection = expectObject(field(o, 'protection', path), `${path}.protection`);
  const cost = expectObject(field(o, 'costPerAttempt', path), `${path}.costPerAttempt`);

  return {
    maxLevel,
    safeLimit,
    mainStatBonusPerLevel: expectNumber(
      field(o, 'mainStatBonusPerLevel', path),
      `${path}.mainStatBonusPerLevel`,
    ),
    riskZone,
    downgradeLevels: expectNumber(field(o, 'downgradeLevels', path), `${path}.downgradeLevels`),
    protection: {
      resourceId: expectString(
        field(protection, 'resourceId', `${path}.protection`),
        `${path}.protection.resourceId`,
      ),
      costPerAttempt: expectNumber(
        field(protection, 'costPerAttempt', `${path}.protection`),
        `${path}.protection.costPerAttempt`,
      ),
    },
    costPerAttempt: {
      base: expectNumber(field(cost, 'base', `${path}.costPerAttempt`), `${path}.costPerAttempt.base`),
      perRefineLevel: expectNumber(
        field(cost, 'perRefineLevel', `${path}.costPerAttempt`),
        `${path}.costPerAttempt.perRefineLevel`,
      ),
      perItemLevel: expectNumber(
        field(cost, 'perItemLevel', `${path}.costPerAttempt`),
        `${path}.costPerAttempt.perItemLevel`,
      ),
    },
  };
}

export interface LootBalance {
  readonly pity: {
    readonly tier: string;
    readonly threshold: number;
    readonly resetsOnTierOrBetter: boolean;
  };
  readonly bossCards: {
    readonly dropChance: number;
    readonly duplicateProtection: { readonly guaranteeAfterKills: number };
  };
  readonly conversion: {
    readonly dismantleResourceId: string;
    readonly duplicateCardResourceId: string;
    readonly duplicateCardValue: number;
    readonly cardPurchaseCost: number;
  };
}

export function parseLootBalance(raw: unknown, path = 'loot.json'): LootBalance {
  const o = expectObject(raw, path);
  const pity = expectObject(field(o, 'pity', path), `${path}.pity`);
  const bossCards = expectObject(field(o, 'bossCards', path), `${path}.bossCards`);
  const duplicate = expectObject(
    field(bossCards, 'duplicateProtection', `${path}.bossCards`),
    `${path}.bossCards.duplicateProtection`,
  );
  const conversion = expectObject(field(o, 'conversion', path), `${path}.conversion`);

  const dropChance = expectNumber(
    field(bossCards, 'dropChance', `${path}.bossCards`),
    `${path}.bossCards.dropChance`,
  );
  if (dropChance !== 0.005) {
    // REQ-CRD-002 fixes this at 0.5%. Failing loudly stops a well-meaning retune from
    // quietly overriding a locked design decision.
    throw new ContentValidationError(
      `${path}.bossCards.dropChance`,
      'REQ-CRD-002 locks the boss card drop rate at 0.005',
    );
  }

  return {
    pity: {
      tier: expectString(field(pity, 'tier', `${path}.pity`), `${path}.pity.tier`),
      threshold: expectNumber(field(pity, 'threshold', `${path}.pity`), `${path}.pity.threshold`),
      resetsOnTierOrBetter: expectBoolean(
        field(pity, 'resetsOnTierOrBetter', `${path}.pity`),
        `${path}.pity.resetsOnTierOrBetter`,
      ),
    },
    bossCards: {
      dropChance,
      duplicateProtection: {
        guaranteeAfterKills: expectNumber(
          field(duplicate, 'guaranteeAfterKills', `${path}.bossCards.duplicateProtection`),
          `${path}.bossCards.duplicateProtection.guaranteeAfterKills`,
        ),
      },
    },
    conversion: {
      dismantleResourceId: expectString(
        field(conversion, 'dismantleResourceId', `${path}.conversion`),
        `${path}.conversion.dismantleResourceId`,
      ),
      duplicateCardResourceId: expectString(
        field(conversion, 'duplicateCardResourceId', `${path}.conversion`),
        `${path}.conversion.duplicateCardResourceId`,
      ),
      duplicateCardValue: expectNumber(
        field(conversion, 'duplicateCardValue', `${path}.conversion`),
        `${path}.conversion.duplicateCardValue`,
      ),
      cardPurchaseCost: expectNumber(
        field(conversion, 'cardPurchaseCost', `${path}.conversion`),
        `${path}.conversion.cardPurchaseCost`,
      ),
    },
  };
}

/** Re-exported so item modules do not need to reach into schema.ts for the attribute list. */
export { ATTRIBUTE_KEYS };
