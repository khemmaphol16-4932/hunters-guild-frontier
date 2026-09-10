/**
 * Town hunting and town defense content.
 *
 * REQ-TWN-007 and REQ-TWN-008 are the same machinery pointed in two directions: hunters walk
 * out to a hunting ground, or something walks in to the walls. Both resolve through the real
 * combat system, which is the requirement's actual content — "town hunting is real" rules out
 * a resource tick with a fight-shaped name.
 *
 * The validations here guard the two silent failures. A hunting ground or threat naming a
 * monster that does not exist would produce an empty fight the party walks through untouched
 * — indistinguishable from an AI bug. And a threat gated above the reputation ceiling could
 * never fire, so the content would look present and never appear.
 */

import {
  ContentValidationError,
  assertUniqueIds,
  expectArray,
  expectNumber,
  expectObject,
  expectString,
  expectStringArray,
  field,
  optionalField,
} from './schema.js';

export interface CountRange {
  readonly min: number;
  readonly max: number;
}

export interface HuntingGroundDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly monsters: readonly string[];
  readonly count: CountRange;
  readonly itemLevel: number;
  /** Chance of a loot roll per successful outing. Town work is not an expedition haul. */
  readonly lootChance: number;
}

export interface HuntingConfig {
  readonly everySteps: number;
  readonly fatiguePerHunt: number;
  readonly grounds: readonly HuntingGroundDef[];
}

export interface ThreatDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** What the Guild AI weighs when the roster is away (REQ-TWN-008). */
  readonly severity: number;
  readonly weight: number;
  readonly reputationAtLeast: number;
  readonly monsters: readonly string[];
  readonly count: CountRange;
  /** Buildings damaged when the defense fails. */
  readonly buildingDamage: number;
  readonly populationLoss: number;
}

export interface GuardPolicyDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export interface DefenseConfig {
  readonly everySteps: number;
  /** Steps before the first threat can arrive. A new guild needs time to raise a wall. */
  readonly graceSteps: number;
  readonly threats: readonly ThreatDef[];
  /** REQ-TWN-008 — the player sets guard policy. Authored, not hardcoded. */
  readonly guardPolicies: readonly GuardPolicyDef[];
  readonly defaultPolicy: string;
}

export interface ThreatData {
  readonly hunting: HuntingConfig;
  readonly defense: DefenseConfig;
}

function parseCount(raw: unknown, path: string): CountRange {
  const o = expectObject(raw, path);
  const min = expectNumber(field(o, 'min', path), `${path}.min`);
  const max = expectNumber(field(o, 'max', path), `${path}.max`);
  if (min < 1 || max < min) {
    throw new ContentValidationError(path, 'a count must be at least 1, and max at least min');
  }
  return { min, max };
}

export function parseThreats(raw: unknown, path = 'threats.json'): ThreatData {
  const o = expectObject(raw, path);
  const num = (obj: Record<string, unknown>, key: string, p: string): number =>
    expectNumber(field(obj, key, p), `${p}.${key}`);

  const huntingRaw = expectObject(field(o, 'hunting', path), `${path}.hunting`);
  const grounds = expectArray(
    field(huntingRaw, 'grounds', `${path}.hunting`),
    `${path}.hunting.grounds`,
  ).map((entry, index): HuntingGroundDef => {
    const p = `${path}.hunting.grounds[${index}]`;
    const g = expectObject(entry, p);
    const id = expectString(field(g, 'id', p), `${p}.id`);
    const gp = `${path}:${id}`;

    const lootChance = num(g, 'lootChance', gp);
    if (lootChance < 0 || lootChance > 1) {
      throw new ContentValidationError(`${gp}.lootChance`, 'must be a probability in 0..1');
    }

    return {
      id,
      name: expectString(field(g, 'name', gp), `${gp}.name`),
      description: expectString(field(g, 'description', gp), `${gp}.description`),
      monsters: expectStringArray(field(g, 'monsters', gp), `${gp}.monsters`),
      count: parseCount(field(g, 'count', gp), `${gp}.count`),
      itemLevel: num(g, 'itemLevel', gp),
      lootChance,
    };
  });

  assertUniqueIds(
    grounds.map((g) => g.id),
    `${path}.hunting.grounds`,
  );
  if (grounds.length === 0) {
    throw new ContentValidationError(
      `${path}.hunting.grounds`,
      'REQ-TWN-007 needs somewhere for town hunters to actually go',
    );
  }

  const hunting: HuntingConfig = {
    everySteps: num(huntingRaw, 'everySteps', `${path}.hunting`),
    fatiguePerHunt: num(huntingRaw, 'fatiguePerHunt', `${path}.hunting`),
    grounds,
  };
  if (hunting.everySteps <= 0) {
    throw new ContentValidationError(
      `${path}.hunting.everySteps`,
      'a non-positive interval would run a hunt every step, or never',
    );
  }

  const defenseRaw = expectObject(field(o, 'defense', path), `${path}.defense`);
  const threats = expectArray(
    field(defenseRaw, 'threats', `${path}.defense`),
    `${path}.defense.threats`,
  ).map((entry, index): ThreatDef => {
    const p = `${path}.defense.threats[${index}]`;
    const t = expectObject(entry, p);
    const id = expectString(field(t, 'id', p), `${p}.id`);
    const tp = `${path}:${id}`;

    const weight = num(t, 'weight', tp);
    if (weight <= 0) {
      throw new ContentValidationError(`${tp}.weight`, 'a threat with no weight never arrives');
    }
    const reputationRaw = optionalField(t, 'reputationAtLeast');

    return {
      id,
      name: expectString(field(t, 'name', tp), `${tp}.name`),
      description: expectString(field(t, 'description', tp), `${tp}.description`),
      severity: num(t, 'severity', tp),
      weight,
      reputationAtLeast:
        reputationRaw === undefined ? 0 : expectNumber(reputationRaw, `${tp}.reputationAtLeast`),
      monsters: expectStringArray(field(t, 'monsters', tp), `${tp}.monsters`),
      count: parseCount(field(t, 'count', tp), `${tp}.count`),
      buildingDamage: num(t, 'buildingDamage', tp),
      populationLoss: num(t, 'populationLoss', tp),
    };
  });

  assertUniqueIds(
    threats.map((t) => t.id),
    `${path}.defense.threats`,
  );
  if (threats.length === 0) {
    throw new ContentValidationError(
      `${path}.defense.threats`,
      'REQ-TWN-008 needs something that can actually arrive',
    );
  }
  // A guild that has never done anything still has to be attackable, or defense is content
  // the early game never sees.
  if (!threats.some((t) => t.reputationAtLeast <= 0)) {
    throw new ContentValidationError(
      `${path}.defense.threats`,
      'every threat is gated behind reputation, so a new guild could never be attacked',
    );
  }

  const guardPolicies = expectArray(
    field(defenseRaw, 'guardPolicies', `${path}.defense`),
    `${path}.defense.guardPolicies`,
  ).map((entry, index): GuardPolicyDef => {
    const p = `${path}.defense.guardPolicies[${index}]`;
    const g = expectObject(entry, p);
    return {
      id: expectString(field(g, 'id', p), `${p}.id`),
      name: expectString(field(g, 'name', p), `${p}.name`),
      description: expectString(field(g, 'description', p), `${p}.description`),
    };
  });

  assertUniqueIds(
    guardPolicies.map((g) => g.id),
    `${path}.defense.guardPolicies`,
  );
  if (guardPolicies.length === 0) {
    throw new ContentValidationError(
      `${path}.defense.guardPolicies`,
      'REQ-TWN-008 requires a guard policy the player can set',
    );
  }

  const defaultPolicy = expectString(
    field(defenseRaw, 'defaultPolicy', `${path}.defense`),
    `${path}.defense.defaultPolicy`,
  );
  if (!guardPolicies.some((g) => g.id === defaultPolicy)) {
    throw new ContentValidationError(
      `${path}.defense.defaultPolicy`,
      `"${defaultPolicy}" is not one of the guard policies`,
    );
  }

  const defense: DefenseConfig = {
    everySteps: num(defenseRaw, 'everySteps', `${path}.defense`),
    graceSteps: num(defenseRaw, 'graceSteps', `${path}.defense`),
    threats,
    guardPolicies,
    defaultPolicy,
  };
  if (defense.everySteps <= 0) {
    throw new ContentValidationError(
      `${path}.defense.everySteps`,
      'a non-positive interval would attack the town every step, or never',
    );
  }

  return { hunting, defense };
}

/** Every monster named by a hunting ground or a threat has to exist. */
export function crossValidateThreats(content: {
  readonly threats: ThreatData;
  readonly monsterIds: ReadonlySet<string>;
  readonly reputationMax: number;
}): void {
  for (const ground of content.threats.hunting.grounds) {
    if (ground.monsters.length === 0) {
      throw new ContentValidationError(
        `threats.json:${ground.id}`,
        'a hunting ground with nothing in it produces an empty fight',
      );
    }
    for (const monster of ground.monsters) {
      if (!content.monsterIds.has(monster)) {
        throw new ContentValidationError(
          `threats.json:${ground.id}`,
          `spawns "${monster}", which does not exist`,
        );
      }
    }
  }

  for (const threat of content.threats.defense.threats) {
    if (threat.monsters.length === 0) {
      throw new ContentValidationError(
        `threats.json:${threat.id}`,
        'a threat with nothing in it would be a defense event with no attackers',
      );
    }
    for (const monster of threat.monsters) {
      if (!content.monsterIds.has(monster)) {
        throw new ContentValidationError(
          `threats.json:${threat.id}`,
          `attacks with "${monster}", which does not exist`,
        );
      }
    }
    if (threat.reputationAtLeast > content.reputationMax) {
      throw new ContentValidationError(
        `threats.json:${threat.id}`,
        `needs ${threat.reputationAtLeast} reputation, above the maximum of ` +
          `${content.reputationMax}, so it could never arrive`,
      );
    }
  }
}
