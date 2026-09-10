/**
 * Recruitment content and its validation.
 *
 * REQ-RCT-001: the pool is dynamic and depends on town, reputation and region, and refresh
 * is *both* paid and timed. REQ-RCT-002: different regions produce clearly different pools,
 * and an exceptional recruit is immediately legible as one.
 *
 * The design decision this file encodes is that **an origin biases, it never gates**. Every
 * bias is a multiplier on a weight, so a Marsh-born Vanguard is unusual and entirely
 * possible. Gating archetypes by origin would turn recruitment into a lookup table and
 * destroy the variety the system exists to produce — the same reasoning as DL-008's
 * preferences and DL-024's constellation affinity, both of which are costs rather than walls.
 *
 * Validation catches the two ways this content goes wrong silently: an origin whose bias
 * names an archetype or personality that does not exist (which would be ignored, so the pool
 * would quietly not differ), and an origin gated above the reputation ceiling (which could
 * never appear at all).
 */

import {
  ContentValidationError,
  assertUniqueIds,
  expectArray,
  expectNumber,
  expectObject,
  expectString,
  field,
  optionalField,
} from './schema.js';

export interface OriginDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** How often this origin appears at all, before reputation gating. */
  readonly weight: number;
  /** REQ-RCT-001 — the pool depends on the guild's standing. */
  readonly reputationAtLeast: number;
  readonly namePool: string;
  /** Multipliers on the archetype draw. Never a filter. */
  readonly archetypeBias: Readonly<Record<string, number>>;
  readonly personalityBias: Readonly<Record<string, number>>;
  /** Scales the potential roll. Where "some places produce better hunters" lives. */
  readonly potentialBias: number;
}

export interface RecruitPoolConfig {
  readonly size: number;
  readonly refreshEverySteps: number;
  readonly paidRefreshGold: number;
  readonly sizePerReputation: number;
  readonly maxSize: number;
}

export interface ExceptionalConfig {
  readonly potentialAtLeast: number;
  readonly label: string;
  readonly note: string;
}

export interface RecruitData {
  readonly origins: readonly OriginDef[];
  readonly pool: RecruitPoolConfig;
  readonly exceptional: ExceptionalConfig;
}

function parseBias(raw: unknown, path: string): Readonly<Record<string, number>> {
  if (raw === undefined) return {};
  const obj = expectObject(raw, path);
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('$')) continue;
    const multiplier = expectNumber(value, `${path}.${key}`);
    if (multiplier < 0) {
      throw new ContentValidationError(`${path}.${key}`, 'a bias cannot be negative');
    }
    out[key] = multiplier;
  }
  return out;
}

export function parseRecruitment(raw: unknown, path = 'origins.json'): RecruitData {
  const o = expectObject(raw, path);

  const origins = expectArray(field(o, 'origins', path), `${path}.origins`).map(
    (entry, index): OriginDef => {
      const p = `${path}.origins[${index}]`;
      const e = expectObject(entry, p);
      const id = expectString(field(e, 'id', p), `${p}.id`);
      const op = `${path}:${id}`;

      const weight = expectNumber(field(e, 'weight', op), `${op}.weight`);
      if (weight <= 0) {
        throw new ContentValidationError(
          `${op}.weight`,
          'an origin with no weight could never be drawn',
        );
      }

      const reputationRaw = optionalField(e, 'reputationAtLeast');
      const potentialBias = expectNumber(
        field(e, 'potentialBias', op),
        `${op}.potentialBias`,
      );
      if (potentialBias <= 0) {
        throw new ContentValidationError(`${op}.potentialBias`, 'must be a positive multiplier');
      }

      return {
        id,
        name: expectString(field(e, 'name', op), `${op}.name`),
        description: expectString(field(e, 'description', op), `${op}.description`),
        weight,
        reputationAtLeast:
          reputationRaw === undefined
            ? 0
            : expectNumber(reputationRaw, `${op}.reputationAtLeast`),
        namePool: expectString(field(e, 'namePool', op), `${op}.namePool`),
        archetypeBias: parseBias(optionalField(e, 'archetypeBias'), `${op}.archetypeBias`),
        personalityBias: parseBias(optionalField(e, 'personalityBias'), `${op}.personalityBias`),
        potentialBias,
      };
    },
  );

  assertUniqueIds(
    origins.map((o) => o.id),
    `${path}.origins`,
  );

  // REQ-RCT-001's pool has to be drawable by a brand-new guild, or recruitment simply does
  // not work until some unstated amount of progress has been made.
  if (!origins.some((origin) => origin.reputationAtLeast <= 0)) {
    throw new ContentValidationError(
      `${path}.origins`,
      'every origin is gated behind reputation, so a new guild could recruit nobody',
    );
  }

  const poolRaw = expectObject(field(o, 'pool', path), `${path}.pool`);
  const num = (obj: Record<string, unknown>, key: string, p: string): number =>
    expectNumber(field(obj, key, p), `${p}.${key}`);

  const pool: RecruitPoolConfig = {
    size: num(poolRaw, 'size', `${path}.pool`),
    refreshEverySteps: num(poolRaw, 'refreshEverySteps', `${path}.pool`),
    paidRefreshGold: num(poolRaw, 'paidRefreshGold', `${path}.pool`),
    sizePerReputation: num(poolRaw, 'sizePerReputation', `${path}.pool`),
    maxSize: num(poolRaw, 'maxSize', `${path}.pool`),
  };

  // REQ-RCT-001 asks for both refresh routes. A zero on either is a route that does not
  // exist, and it would be very easy to disable one by accident while retuning.
  if (pool.refreshEverySteps <= 0) {
    throw new ContentValidationError(
      `${path}.pool.refreshEverySteps`,
      'REQ-RCT-001 requires a timed refresh; a non-positive interval removes it',
    );
  }
  if (pool.paidRefreshGold <= 0) {
    throw new ContentValidationError(
      `${path}.pool.paidRefreshGold`,
      'REQ-RCT-001 requires a paid refresh; a free one is not a paid one',
    );
  }
  if (pool.size < 1 || pool.maxSize < pool.size) {
    throw new ContentValidationError(
      `${path}.pool`,
      'the pool needs at least one candidate, and maxSize must not be below size',
    );
  }

  const exceptionalRaw = expectObject(field(o, 'exceptional', path), `${path}.exceptional`);
  const exceptional: ExceptionalConfig = {
    potentialAtLeast: num(exceptionalRaw, 'potentialAtLeast', `${path}.exceptional`),
    label: expectString(
      field(exceptionalRaw, 'label', `${path}.exceptional`),
      `${path}.exceptional.label`,
    ),
    note: expectString(
      field(exceptionalRaw, 'note', `${path}.exceptional`),
      `${path}.exceptional.note`,
    ),
  };
  if (exceptional.potentialAtLeast <= 0 || exceptional.potentialAtLeast >= 1) {
    throw new ContentValidationError(
      `${path}.exceptional.potentialAtLeast`,
      'a threshold at or outside 0..1 would make every recruit exceptional or none of them',
    );
  }

  return { origins, pool, exceptional };
}

/**
 * Cross-file validation, called from the loader once everything else is parsed.
 *
 * The name-pool check is the important one: an origin pointing at a pool that does not exist
 * would silently fall back to the default, and REQ-RCT-002's "clearly different pools" would
 * quietly become one pool with different labels — which is exactly the state Phase 1 was in.
 */
export function crossValidateRecruitment(content: {
  readonly recruitment: RecruitData;
  readonly namePoolIds: ReadonlySet<string>;
  readonly archetypeIds: ReadonlySet<string>;
  readonly personalityIds: ReadonlySet<string>;
  readonly reputationMax: number;
}): void {
  for (const origin of content.recruitment.origins) {
    if (!content.namePoolIds.has(origin.namePool)) {
      throw new ContentValidationError(
        `origins.json:${origin.id}`,
        `draws names from "${origin.namePool}", which does not exist`,
      );
    }
    if (origin.reputationAtLeast > content.reputationMax) {
      throw new ContentValidationError(
        `origins.json:${origin.id}`,
        `needs ${origin.reputationAtLeast} reputation, above the maximum of ` +
          `${content.reputationMax}, so it could never appear`,
      );
    }
    for (const archetype of Object.keys(origin.archetypeBias)) {
      if (!content.archetypeIds.has(archetype)) {
        throw new ContentValidationError(
          `origins.json:${origin.id}.archetypeBias`,
          `biases "${archetype}", which is not an archetype`,
        );
      }
    }
    for (const personality of Object.keys(origin.personalityBias)) {
      if (!content.personalityIds.has(personality)) {
        throw new ContentValidationError(
          `origins.json:${origin.id}.personalityBias`,
          `biases "${personality}", which is not a personality`,
        );
      }
    }
  }

  // REQ-RCT-002 asks for *clearly* different pools. Two origins drawing the same names with
  // the same biases are one origin with two labels.
  const seen = new Map<string, string>();
  for (const origin of content.recruitment.origins) {
    const signature = JSON.stringify([
      origin.namePool,
      Object.entries(origin.archetypeBias).sort(),
      Object.entries(origin.personalityBias).sort(),
    ]);
    const twin = seen.get(signature);
    if (twin !== undefined) {
      throw new ContentValidationError(
        `origins.json:${origin.id}`,
        `is indistinguishable from "${twin}" — same names and same biases (REQ-RCT-002)`,
      );
    }
    seen.set(signature, origin.id);
  }
}
