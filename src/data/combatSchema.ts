/**
 * Combat, monster, status and world content types.
 *
 * v1.0 §7 requires combat definitions — skills, effects, statuses, elements, reactions,
 * monsters, boss phases, targeting rules and AI considerations — to be *authored data*.
 * This file is the validation for that data.
 */

import {
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
  field,
  optionalField,
  type Element,
  type RangeBand,
} from './schema.js';
import { ELEMENTS, RANGE_BANDS } from './schema.js';

// ---------------------------------------------------------------------------
// Combat balance
// ---------------------------------------------------------------------------

export interface CombatBalance {
  readonly tickSeconds: number;
  readonly maxEncounterSeconds: number;
  readonly maxExpeditionSeconds: number;
  readonly damage: {
    readonly defenceScale: number;
    readonly minimumDamage: number;
    readonly varianceSpread: number;
  };
  readonly accuracy: {
    readonly base: number;
    readonly scale: number;
    readonly min: number;
    readonly max: number;
  };
  readonly critical: {
    readonly chanceScale: number;
    readonly damageScale: number;
    readonly maxChance: number;
  };
  readonly resource: { readonly regenPerSecond: number };
  readonly threat: {
    readonly perDamage: number;
    readonly perHealing: number;
    readonly tauntFlat: number;
    readonly decayPerSecond: number;
  };
  readonly downed: {
    readonly timerSeconds: number;
    readonly reviveHealthFraction: number;
    readonly rescueSeconds: number;
  };
  readonly movement: {
    readonly unitsPerSecond: number;
    readonly rangeBands: Readonly<Record<RangeBand, number>>;
    readonly startingSeparation: number;
    readonly disengageSeconds: number;
  };
  readonly ai: {
    readonly reevaluateEverySeconds: number;
    readonly weights: Readonly<Record<string, number>>;
    readonly lowHealthFraction: number;
    readonly criticalHealthFraction: number;
    readonly retreatUrgencyScale: number;
  };
}

export function parseCombatBalance(raw: unknown, path = 'combat.json'): CombatBalance {
  const o = expectObject(raw, path);
  const num = (obj: Record<string, unknown>, key: string, p: string): number =>
    expectNumber(field(obj, key, p), `${p}.${key}`);

  const damage = expectObject(field(o, 'damage', path), `${path}.damage`);
  const accuracy = expectObject(field(o, 'accuracy', path), `${path}.accuracy`);
  const critical = expectObject(field(o, 'critical', path), `${path}.critical`);
  const resource = expectObject(field(o, 'resource', path), `${path}.resource`);
  const threat = expectObject(field(o, 'threat', path), `${path}.threat`);
  const downed = expectObject(field(o, 'downed', path), `${path}.downed`);
  const movement = expectObject(field(o, 'movement', path), `${path}.movement`);
  const ai = expectObject(field(o, 'ai', path), `${path}.ai`);

  const bandsRaw = expectObject(
    field(movement, 'rangeBands', `${path}.movement`),
    `${path}.movement.rangeBands`,
  );
  const rangeBands = {} as Record<RangeBand, number>;
  for (const band of RANGE_BANDS) {
    if (!(band in bandsRaw)) {
      throw new ContentValidationError(
        `${path}.movement.rangeBands.${band}`,
        'every range band needs a distance',
      );
    }
    rangeBands[band] = expectNumber(bandsRaw[band], `${path}.movement.rangeBands.${band}`);
  }

  const variance = num(damage, 'varianceSpread', `${path}.damage`);
  if (variance !== 0.1) {
    // REQ-CBT-007 fixes damage variance at ±10%. Failing loudly stops a retune from
    // silently overriding a locked decision.
    throw new ContentValidationError(
      `${path}.damage.varianceSpread`,
      'REQ-CBT-007 locks damage variance at 0.1 (±10%)',
    );
  }

  return {
    tickSeconds: num(o, 'tickSeconds', path),
    maxEncounterSeconds: num(o, 'maxEncounterSeconds', path),
    maxExpeditionSeconds: num(o, 'maxExpeditionSeconds', path),
    damage: {
      defenceScale: num(damage, 'defenceScale', `${path}.damage`),
      minimumDamage: num(damage, 'minimumDamage', `${path}.damage`),
      varianceSpread: variance,
    },
    accuracy: {
      base: num(accuracy, 'base', `${path}.accuracy`),
      scale: num(accuracy, 'scale', `${path}.accuracy`),
      min: num(accuracy, 'min', `${path}.accuracy`),
      max: num(accuracy, 'max', `${path}.accuracy`),
    },
    critical: {
      chanceScale: num(critical, 'chanceScale', `${path}.critical`),
      damageScale: num(critical, 'damageScale', `${path}.critical`),
      maxChance: num(critical, 'maxChance', `${path}.critical`),
    },
    resource: { regenPerSecond: num(resource, 'regenPerSecond', `${path}.resource`) },
    threat: {
      perDamage: num(threat, 'perDamage', `${path}.threat`),
      perHealing: num(threat, 'perHealing', `${path}.threat`),
      tauntFlat: num(threat, 'tauntFlat', `${path}.threat`),
      decayPerSecond: num(threat, 'decayPerSecond', `${path}.threat`),
    },
    downed: {
      timerSeconds: num(downed, 'timerSeconds', `${path}.downed`),
      reviveHealthFraction: num(downed, 'reviveHealthFraction', `${path}.downed`),
      rescueSeconds: num(downed, 'rescueSeconds', `${path}.downed`),
    },
    movement: {
      unitsPerSecond: num(movement, 'unitsPerSecond', `${path}.movement`),
      rangeBands,
      startingSeparation: num(movement, 'startingSeparation', `${path}.movement`),
      disengageSeconds: num(movement, 'disengageSeconds', `${path}.movement`),
    },
    ai: {
      reevaluateEverySeconds: num(ai, 'reevaluateEverySeconds', `${path}.ai`),
      weights: expectNumberRecord(field(ai, 'weights', `${path}.ai`), `${path}.ai.weights`),
      lowHealthFraction: num(ai, 'lowHealthFraction', `${path}.ai`),
      retreatUrgencyScale: num(ai, 'retreatUrgencyScale', `${path}.ai`),
      criticalHealthFraction: num(ai, 'criticalHealthFraction', `${path}.ai`),
    },
  };
}

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

export const STATUS_KINDS = ['damageOverTime', 'movement', 'control', 'buff'] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

export const CC_TIERS = ['none', 'soft', 'hard'] as const;
export type CcTier = (typeof CC_TIERS)[number];

export interface StatusDef {
  readonly id: string;
  readonly name: string;
  readonly kind: StatusKind;
  readonly tier: CcTier;
  readonly durationSeconds: number;
  readonly tickSeconds: number | undefined;
  readonly magnitude: number;
  readonly stacking: 'refresh' | 'stack';
  readonly maxStacks: number;
  readonly diminishing:
    | {
        readonly windowSeconds: number;
        readonly reductionPerApplication: number;
        readonly immuneAfterApplications: number;
      }
    | undefined;
}

export function parseStatuses(raw: unknown, path = 'statuses.json'): readonly StatusDef[] {
  const o = expectObject(raw, path);
  const statuses = expectArray(field(o, 'statuses', path), `${path}.statuses`).map((entry, i) => {
    const p = `${path}.statuses[${i}]`;
    const e = expectObject(entry, p);
    const tickRaw = optionalField(e, 'tickSeconds');
    const dimRaw = optionalField(e, 'diminishing');

    const def: StatusDef = {
      id: expectString(field(e, 'id', p), `${p}.id`),
      name: expectString(field(e, 'name', p), `${p}.name`),
      kind: expectEnum(field(e, 'kind', p), `${p}.kind`, STATUS_KINDS),
      tier: expectEnum(field(e, 'tier', p), `${p}.tier`, CC_TIERS),
      durationSeconds: expectNumber(field(e, 'durationSeconds', p), `${p}.durationSeconds`),
      tickSeconds: tickRaw === undefined ? undefined : expectNumber(tickRaw, `${p}.tickSeconds`),
      magnitude: expectNumber(field(e, 'magnitude', p), `${p}.magnitude`),
      stacking: expectEnum(field(e, 'stacking', p), `${p}.stacking`, ['refresh', 'stack'] as const),
      maxStacks: expectNumber(field(e, 'maxStacks', p), `${p}.maxStacks`),
      diminishing:
        dimRaw === undefined
          ? undefined
          : (() => {
              const d = expectObject(dimRaw, `${p}.diminishing`);
              return {
                windowSeconds: expectNumber(
                  field(d, 'windowSeconds', `${p}.diminishing`),
                  `${p}.diminishing.windowSeconds`,
                ),
                reductionPerApplication: expectNumber(
                  field(d, 'reductionPerApplication', `${p}.diminishing`),
                  `${p}.diminishing.reductionPerApplication`,
                ),
                immuneAfterApplications: expectNumber(
                  field(d, 'immuneAfterApplications', `${p}.diminishing`),
                  `${p}.diminishing.immuneAfterApplications`,
                ),
              };
            })(),
    };

    if (def.kind === 'damageOverTime' && def.tickSeconds === undefined) {
      throw new ContentValidationError(p, 'a damage-over-time status needs a tick interval');
    }
    // REQ-CBT-009: hard CC must diminish, or a boss can be chain-locked.
    if (def.tier === 'hard' && def.diminishing === undefined) {
      throw new ContentValidationError(
        `${p}.diminishing`,
        'hard crowd control must define diminishing returns (REQ-CBT-009)',
      );
    }
    return def;
  });

  assertUniqueIds(statuses.map((s) => s.id), `${path}.statuses`);
  return statuses;
}

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------

export const MONSTER_TIERS = ['trash', 'elite', 'boss'] as const;
export type MonsterTier = (typeof MONSTER_TIERS)[number];

export interface MonsterSkillDef {
  readonly id: string;
  readonly name: string;
  readonly power: number;
  readonly healPower: number | undefined;
  readonly cooldown: number;
  readonly aoe: boolean;
  /** REQ-BOS-001: every important boss skill telegraphs before it lands. */
  readonly telegraphSeconds: number | undefined;
  readonly status: string | undefined;
  readonly statusChance: number | undefined;
}

export interface MonsterPhaseDef {
  readonly belowHealthFraction: number;
  readonly name: string;
  readonly attackMultiplier: number;
  readonly cooldownMultiplier: number;
}

export interface MonsterDef {
  readonly id: string;
  readonly name: string;
  readonly tier: MonsterTier;
  readonly level: number;
  readonly stats: Readonly<Record<string, number>>;
  readonly rangeBand: RangeBand;
  readonly element: Element | undefined;
  readonly attackCooldown: number;
  readonly skills: readonly MonsterSkillDef[];
  readonly phases: readonly MonsterPhaseDef[];
  readonly xp: number;
  readonly cardPool: readonly string[];
}

export function parseMonsters(raw: unknown, path = 'monsters.json'): readonly MonsterDef[] {
  const o = expectObject(raw, path);
  const monsters = expectArray(field(o, 'monsters', path), `${path}.monsters`).map((entry, i) => {
    const p = `${path}.monsters[${i}]`;
    const e = expectObject(entry, p);
    const elementRaw = optionalField(e, 'element');
    const phasesRaw = optionalField(e, 'phases');
    const cardPoolRaw = optionalField(e, 'cardPool');

    const skills = expectArray(field(e, 'skills', p), `${p}.skills`).map((s, si) => {
      const sp = `${p}.skills[${si}]`;
      const sk = expectObject(s, sp);
      const heal = optionalField(sk, 'healPower');
      const telegraph = optionalField(sk, 'telegraphSeconds');
      const status = optionalField(sk, 'status');
      const chance = optionalField(sk, 'statusChance');
      return {
        id: expectString(field(sk, 'id', sp), `${sp}.id`),
        name: expectString(field(sk, 'name', sp), `${sp}.name`),
        power: expectNumber(field(sk, 'power', sp), `${sp}.power`),
        healPower: heal === undefined ? undefined : expectNumber(heal, `${sp}.healPower`),
        cooldown: expectNumber(field(sk, 'cooldown', sp), `${sp}.cooldown`),
        aoe: optionalField(sk, 'aoe') === undefined ? false : expectBoolean(sk['aoe'], `${sp}.aoe`),
        telegraphSeconds:
          telegraph === undefined ? undefined : expectNumber(telegraph, `${sp}.telegraphSeconds`),
        status: status === undefined ? undefined : expectString(status, `${sp}.status`),
        statusChance: chance === undefined ? undefined : expectNumber(chance, `${sp}.statusChance`),
      };
    });

    const phases =
      phasesRaw === undefined
        ? []
        : expectArray(phasesRaw, `${p}.phases`).map((ph, pi) => {
            const pp = `${p}.phases[${pi}]`;
            const phase = expectObject(ph, pp);
            return {
              belowHealthFraction: expectNumber(
                field(phase, 'belowHealthFraction', pp),
                `${pp}.belowHealthFraction`,
              ),
              name: expectString(field(phase, 'name', pp), `${pp}.name`),
              attackMultiplier: expectNumber(
                field(phase, 'attackMultiplier', pp),
                `${pp}.attackMultiplier`,
              ),
              cooldownMultiplier: expectNumber(
                field(phase, 'cooldownMultiplier', pp),
                `${pp}.cooldownMultiplier`,
              ),
            };
          });

    for (let pi = 1; pi < phases.length; pi++) {
      if ((phases[pi]?.belowHealthFraction ?? 1) >= (phases[pi - 1]?.belowHealthFraction ?? 1)) {
        throw new ContentValidationError(
          `${p}.phases`,
          'phases must be ordered by descending health fraction',
        );
      }
    }

    const def: MonsterDef = {
      id: expectString(field(e, 'id', p), `${p}.id`),
      name: expectString(field(e, 'name', p), `${p}.name`),
      tier: expectEnum(field(e, 'tier', p), `${p}.tier`, MONSTER_TIERS),
      level: expectNumber(field(e, 'level', p), `${p}.level`),
      stats: expectNumberRecord(field(e, 'stats', p), `${p}.stats`),
      rangeBand: expectEnum(field(e, 'rangeBand', p), `${p}.rangeBand`, RANGE_BANDS),
      element:
        elementRaw === null || elementRaw === undefined
          ? undefined
          : expectEnum(elementRaw, `${p}.element`, ELEMENTS),
      attackCooldown: expectNumber(field(e, 'attackCooldown', p), `${p}.attackCooldown`),
      skills,
      phases,
      xp: expectNumber(field(e, 'xp', p), `${p}.xp`),
      cardPool: cardPoolRaw === undefined ? [] : expectStringArray(cardPoolRaw, `${p}.cardPool`),
    };

    if (def.stats['maxHp'] === undefined) {
      throw new ContentValidationError(`${p}.stats.maxHp`, 'every monster needs maxHp');
    }
    // REQ-CBT-010: generic resistance is a boss system.
    if (def.tier !== 'boss' && def.stats['statusResistance'] !== undefined) {
      throw new ContentValidationError(
        `${p}.stats.statusResistance`,
        'generic status resistance is a boss system (REQ-CBT-010)',
      );
    }
    return def;
  });

  assertUniqueIds(monsters.map((m) => m.id), `${path}.monsters`);
  return monsters;
}

// ---------------------------------------------------------------------------
// World regions
// ---------------------------------------------------------------------------

export const ZONE_TIERS = ['blue', 'yellow', 'red', 'black'] as const;
export type ZoneTier = (typeof ZONE_TIERS)[number];

export const KNOWLEDGE_TIERS = [
  'unknown',
  'rumor',
  'discovered',
  'experienced',
  'mastered',
] as const;
export type KnowledgeTier = (typeof KNOWLEDGE_TIERS)[number];

export interface ZoneTierDef {
  readonly name: string;
  readonly canInjure: boolean;
  readonly canKill: boolean;
  readonly lootBonus: number;
  readonly colour: string;
}

export interface EncounterDef {
  readonly monsters: readonly string[];
  readonly count: { readonly min: number; readonly max: number };
  readonly weight: number;
}

/**
 * What it takes before the guild may go somewhere (REQ-WLD-002).
 *
 * Every axis is optional and they combine with AND, because §50 lists "level, reputation,
 * story, capability and player choice" as *combinations* rather than alternatives. The
 * fields the prototype cannot yet evaluate — reputation, story, capability — are parsed and
 * carried rather than dropped, so authoring a region that needs them is possible now and
 * enforcing it is a Phase 6/8 wiring job rather than a schema change.
 */
export interface RegionUnlockDef {
  /** Highest-level hunter the guild must have. */
  readonly guildLevel: number | undefined;
  /** A region whose warden must be dead first — the ordinary story gate. */
  readonly afterBoss: string | undefined;
  /** A region the guild must know at least this well. */
  readonly afterKnowing: { readonly regionId: string; readonly tier: KnowledgeTier } | undefined;
  readonly reputation: number | undefined;
  readonly capability: string | undefined;
}

export interface RegionDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly zoneTier: ZoneTier;
  readonly knowledgeTier: KnowledgeTier;
  readonly recommendedLevel: number;
  readonly itemLevel: number;
  readonly routeLength: { readonly min: number; readonly max: number };
  readonly encounters: readonly EncounterDef[];
  readonly boss: string | undefined;
  /** Absent means "always available" — the starting region needs no gate. */
  readonly unlock: RegionUnlockDef | undefined;
  /**
   * REQ-ZON-002: zones must differ in environment as well as in monsters and loot. A
   * hazard is a named, authored property of the place, not a stat modifier.
   */
  readonly hazards: readonly string[];
}

export interface WorldData {
  readonly zoneTiers: Readonly<Record<ZoneTier, ZoneTierDef>>;
  readonly regions: readonly RegionDef[];
  readonly nodeKinds: Readonly<Record<string, { weight: number; [key: string]: number }>>;
}

function parseUnlock(raw: unknown, path: string): RegionUnlockDef | undefined {
  if (raw === undefined || raw === null) return undefined;
  const o = expectObject(raw, path);

  const level = optionalField(o, 'guildLevel');
  const afterBoss = optionalField(o, 'afterBoss');
  const afterKnowing = optionalField(o, 'afterKnowing');
  const reputation = optionalField(o, 'reputation');
  const capability = optionalField(o, 'capability');

  return {
    guildLevel: level === undefined ? undefined : expectNumber(level, `${path}.guildLevel`),
    afterBoss: afterBoss === undefined ? undefined : expectString(afterBoss, `${path}.afterBoss`),
    afterKnowing:
      afterKnowing === undefined
        ? undefined
        : (() => {
            const k = expectObject(afterKnowing, `${path}.afterKnowing`);
            return {
              regionId: expectString(
                field(k, 'regionId', `${path}.afterKnowing`),
                `${path}.afterKnowing.regionId`,
              ),
              tier: expectEnum(
                field(k, 'tier', `${path}.afterKnowing`),
                `${path}.afterKnowing.tier`,
                KNOWLEDGE_TIERS,
              ),
            };
          })(),
    reputation: reputation === undefined ? undefined : expectNumber(reputation, `${path}.reputation`),
    capability: capability === undefined ? undefined : expectString(capability, `${path}.capability`),
  };
}

export function parseWorld(raw: unknown, path = 'regions.json'): WorldData {
  const o = expectObject(raw, path);

  const tiersRaw = expectObject(field(o, 'zoneTiers', path), `${path}.zoneTiers`);
  const zoneTiers = {} as Record<ZoneTier, ZoneTierDef>;
  for (const tier of ZONE_TIERS) {
    if (!(tier in tiersRaw)) {
      throw new ContentValidationError(`${path}.zoneTiers.${tier}`, 'missing zone tier');
    }
    const t = expectObject(tiersRaw[tier], `${path}.zoneTiers.${tier}`);
    zoneTiers[tier] = {
      name: expectString(field(t, 'name', `${path}.zoneTiers.${tier}`), `${path}.zoneTiers.${tier}.name`),
      canInjure: expectBoolean(
        field(t, 'canInjure', `${path}.zoneTiers.${tier}`),
        `${path}.zoneTiers.${tier}.canInjure`,
      ),
      canKill: expectBoolean(
        field(t, 'canKill', `${path}.zoneTiers.${tier}`),
        `${path}.zoneTiers.${tier}.canKill`,
      ),
      lootBonus: expectNumber(
        field(t, 'lootBonus', `${path}.zoneTiers.${tier}`),
        `${path}.zoneTiers.${tier}.lootBonus`,
      ),
      colour: expectString(
        field(t, 'colour', `${path}.zoneTiers.${tier}`),
        `${path}.zoneTiers.${tier}.colour`,
      ),
    };
  }

  // REQ-ZON-001 fixes the semantics of the four tiers; content must not redefine them.
  if (zoneTiers.blue.canKill || zoneTiers.blue.canInjure) {
    throw new ContentValidationError(`${path}.zoneTiers.blue`, 'BLUE cannot injure or kill');
  }
  if (!zoneTiers.black.canKill) {
    throw new ContentValidationError(`${path}.zoneTiers.black`, 'BLACK must be able to kill');
  }
  if (zoneTiers.yellow.canKill || zoneTiers.red.canKill) {
    throw new ContentValidationError(
      `${path}.zoneTiers`,
      'only BLACK may kill (REQ-ZON-001)',
    );
  }

  const regions = expectArray(field(o, 'regions', path), `${path}.regions`).map((entry, i) => {
    const p = `${path}.regions[${i}]`;
    const e = expectObject(entry, p);
    const bossRaw = optionalField(e, 'boss');
    const routeRaw = expectObject(field(e, 'routeLength', p), `${p}.routeLength`);
    const countOf = (obj: Record<string, unknown>, cp: string): { min: number; max: number } => {
      const c = expectObject(obj, cp);
      const range = {
        min: expectNumber(field(c, 'min', cp), `${cp}.min`),
        max: expectNumber(field(c, 'max', cp), `${cp}.max`),
      };
      if (range.max < range.min) throw new ContentValidationError(cp, 'max must be >= min');
      return range;
    };

    return {
      id: expectString(field(e, 'id', p), `${p}.id`),
      name: expectString(field(e, 'name', p), `${p}.name`),
      description: expectString(field(e, 'description', p), `${p}.description`),
      zoneTier: expectEnum(field(e, 'zoneTier', p), `${p}.zoneTier`, ZONE_TIERS),
      knowledgeTier: expectEnum(field(e, 'knowledgeTier', p), `${p}.knowledgeTier`, KNOWLEDGE_TIERS),
      recommendedLevel: expectNumber(field(e, 'recommendedLevel', p), `${p}.recommendedLevel`),
      itemLevel: expectNumber(field(e, 'itemLevel', p), `${p}.itemLevel`),
      routeLength: countOf(routeRaw, `${p}.routeLength`),
      encounters: expectArray(field(e, 'encounters', p), `${p}.encounters`).map((enc, ei) => {
        const ep = `${p}.encounters[${ei}]`;
        const en = expectObject(enc, ep);
        return {
          monsters: expectStringArray(field(en, 'monsters', ep), `${ep}.monsters`),
          count: countOf(expectObject(field(en, 'count', ep), `${ep}.count`), `${ep}.count`),
          weight: expectNumber(field(en, 'weight', ep), `${ep}.weight`),
        };
      }),
      boss: bossRaw === null || bossRaw === undefined ? undefined : expectString(bossRaw, `${p}.boss`),
      unlock: parseUnlock(optionalField(e, 'unlock'), `${p}.unlock`),
      hazards:
        optionalField(e, 'hazards') === undefined
          ? []
          : expectStringArray(e['hazards'], `${p}.hazards`),
    };
  });

  assertUniqueIds(regions.map((r) => r.id), `${path}.regions`);

  const kindsRaw = expectObject(field(o, 'nodeKinds', path), `${path}.nodeKinds`);
  const nodeKinds: Record<string, { weight: number; [key: string]: number }> = {};
  for (const [name, value] of Object.entries(kindsRaw)) {
    if (name.startsWith('$')) continue;
    const kp = `${path}.nodeKinds.${name}`;
    const record = expectNumberRecord(value, kp);
    if (record['weight'] === undefined) {
      throw new ContentValidationError(`${kp}.weight`, 'every node kind needs a weight');
    }
    nodeKinds[name] = record as { weight: number };
  }

  return { zoneTiers, regions, nodeKinds };
}

// ---------------------------------------------------------------------------
// Expedition events
// ---------------------------------------------------------------------------

/**
 * What choosing an event option does.
 *
 * Every field is optional and additive. Deliberately a flat record of *named effects*
 * rather than a script: an event that could run arbitrary logic would let content reach
 * into the simulation, and REQ-EXP-002 asks for authored events, not authored code.
 */
export interface EventEffects {
  readonly lootRolls: number | undefined;
  readonly fatigue: number | undefined;
  readonly morale: number | undefined;
  /** Fraction of max health restored to the whole party. */
  readonly heal: number | undefined;
  readonly reputation: number | undefined;
  /** Route nodes added or skipped — the branching in REQ-EXP-002. */
  readonly extraNodes: number | undefined;
  readonly skipNodes: number | undefined;
  /** Forces the next fight to start with the party out of position. */
  readonly ambush: boolean | undefined;
  /** Ends the run here, successfully. */
  readonly endsExpedition: boolean | undefined;
  /** Wall-clock cost against the 10-minute cap (REQ-EXP-003). */
  readonly seconds: number | undefined;
}

export interface EventOptionDef {
  readonly id: string;
  readonly label: string;
  /** Player-readable, and quoted verbatim in the route report. */
  readonly consequence: string;
  /** 0 = safe, 1 = a gamble. Weighed against the objective's risk preference. */
  readonly risk: number;
  readonly effects: EventEffects;
}

export interface EventDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly weight: number;
  readonly zoneTiers: readonly ZoneTier[];
  /** Empty means "anywhere"; otherwise the region must have one of these hazards. */
  readonly hazards: readonly string[];
  readonly options: readonly EventOptionDef[];
}

export function parseEvents(raw: unknown, path = 'events.json'): readonly EventDef[] {
  const o = expectObject(raw, path);
  const events = expectArray(field(o, 'events', path), `${path}.events`).map((entry, i) => {
    const p = `${path}.events[${i}]`;
    const e = expectObject(entry, p);

    const options = expectArray(field(e, 'options', p), `${p}.options`).map((opt, oi) => {
      const op = `${p}.options[${oi}]`;
      const option = expectObject(opt, op);
      const fx = expectObject(field(option, 'effects', op), `${op}.effects`);
      const num = (key: string): number | undefined =>
        fx[key] === undefined ? undefined : expectNumber(fx[key], `${op}.effects.${key}`);
      const bool = (key: string): boolean | undefined =>
        fx[key] === undefined ? undefined : expectBoolean(fx[key], `${op}.effects.${key}`);

      return {
        id: expectString(field(option, 'id', op), `${op}.id`),
        label: expectString(field(option, 'label', op), `${op}.label`),
        consequence: expectString(field(option, 'consequence', op), `${op}.consequence`),
        risk: expectNumber(field(option, 'risk', op), `${op}.risk`),
        effects: {
          lootRolls: num('lootRolls'),
          fatigue: num('fatigue'),
          morale: num('morale'),
          heal: num('heal'),
          reputation: num('reputation'),
          extraNodes: num('extraNodes'),
          skipNodes: num('skipNodes'),
          ambush: bool('ambush'),
          endsExpedition: bool('endsExpedition'),
          seconds: num('seconds'),
        },
      } satisfies EventOptionDef;
    });

    // An event with one option is not a decision, and REQ-EXP-002 lists decisions as a
    // thing expeditions contain. A single-option event would present the player's guild AI
    // with a choice it cannot make.
    if (options.length < 2) {
      throw new ContentValidationError(`${p}.options`, 'an event needs at least two options');
    }
    assertUniqueIds(options.map((opt) => opt.id), `${p}.options`);

    return {
      id: expectString(field(e, 'id', p), `${p}.id`),
      name: expectString(field(e, 'name', p), `${p}.name`),
      description: expectString(field(e, 'description', p), `${p}.description`),
      weight: expectNumber(field(e, 'weight', p), `${p}.weight`),
      zoneTiers: expectArray(field(e, 'zoneTiers', p), `${p}.zoneTiers`).map((tier, ti) =>
        expectEnum(tier, `${p}.zoneTiers[${ti}]`, ZONE_TIERS),
      ),
      hazards:
        optionalField(e, 'hazards') === undefined
          ? []
          : expectStringArray(e['hazards'], `${p}.hazards`),
      options,
    } satisfies EventDef;
  });

  assertUniqueIds(events.map((e) => e.id), `${path}.events`);
  return events;
}
