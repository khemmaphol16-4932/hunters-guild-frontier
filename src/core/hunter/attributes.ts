/**
 * Attributes and derived combat statistics.
 *
 * REQ-HUN-001/002, REQ-TEC-002. Every coefficient lives in data/balance/attributes.json —
 * there are no magic numbers in this file, because balance will be retuned by simulation
 * (§121) and a retune must never require a code change.
 *
 * Derived stats are a linear model: base + perLevel*level + sum(coefficient * attribute),
 * optionally scaled by a condition multiplier (fatigue and hunger, §48) and capped.
 * "Externally understandable, internally multi-layered" (§42) starts here: a player can
 * read "VIT gives HP" off the dashboard while the AI consumes the full derived vector.
 */

import type { AttributeBalance, AttributeKey } from '../../data/schema.js';
import { ATTRIBUTE_KEYS } from '../../data/schema.js';

export type Attributes = Readonly<Record<AttributeKey, number>>;
export type DerivedStats = Readonly<Record<string, number>>;

export interface StatModifiers {
  /**
   * Multiplicative scale applied to every derived stat before caps.
   * 1 = unimpaired. Condition penalties (fatigue, hunger) arrive here.
   */
  readonly globalMultiplier?: number;
  /** Flat additions applied after the linear model, before the multiplier. */
  readonly flat?: Readonly<Record<string, number>>;
}

/** A fresh attribute block at the balance-defined starting value. */
export function baseAttributes(balance: AttributeBalance): Attributes {
  const out = {} as Record<AttributeKey, number>;
  for (const key of ATTRIBUTE_KEYS) out[key] = balance.startingValue;
  return out;
}

export function totalAttributePoints(attributes: Attributes): number {
  let sum = 0;
  for (const key of ATTRIBUTE_KEYS) sum += attributes[key];
  return sum;
}

/** Points the player has actually allocated above the starting baseline. */
export function allocatedPoints(attributes: Attributes, balance: AttributeBalance): number {
  return totalAttributePoints(attributes) - balance.startingValue * ATTRIBUTE_KEYS.length;
}

export function withAttribute(
  attributes: Attributes,
  key: AttributeKey,
  value: number,
): Attributes {
  return { ...attributes, [key]: value };
}

/**
 * Compute the full derived stat vector.
 *
 * Order matters and is deliberate: linear model → flat modifiers → global multiplier → caps.
 * Applying caps last means a fatigued hunter cannot exceed a cap that a rested one respects,
 * and applying the multiplier before caps means condition penalties are real rather than
 * being absorbed by headroom.
 */
export function computeDerivedStats(
  attributes: Attributes,
  level: number,
  balance: AttributeBalance,
  modifiers: StatModifiers = {},
): DerivedStats {
  const multiplier = modifiers.globalMultiplier ?? 1;
  const flat = modifiers.flat ?? {};
  const out: Record<string, number> = {};

  for (const [statName, formula] of Object.entries(balance.derived)) {
    let value = formula.base + formula.perLevel * level;
    for (const key of ATTRIBUTE_KEYS) {
      const coefficient = formula.from[key];
      if (coefficient !== undefined) value += coefficient * attributes[key];
    }

    value += flat[statName] ?? 0;
    value *= multiplier;

    const cap = balance.caps[statName];
    if (cap !== undefined) value = Math.min(value, cap);

    out[statName] = value;
  }

  return out;
}

/**
 * Condition multiplier from fatigue and hunger (§48).
 * Both are 0..1 where 1 is maximally fatigued/hungry. Kept here rather than in Condition
 * so that anything computing stats gets the penalty applied identically.
 */
export function conditionMultiplier(
  fatigue: number,
  hunger: number,
  fatiguePenaltyAtMax: number,
  hungerPenaltyAtMax: number,
): number {
  const clamped = (v: number) => Math.min(1, Math.max(0, v));
  const penalty = clamped(fatigue) * fatiguePenaltyAtMax + clamped(hunger) * hungerPenaltyAtMax;
  return Math.max(0.1, 1 - penalty);
}

/** Display order for the dashboard. Derived stats not listed here still exist in the vector. */
export const DERIVED_STAT_DISPLAY_ORDER = [
  'maxHp',
  'maxResource',
  'physicalAttack',
  'magicAttack',
  'physicalDefense',
  'magicDefense',
  'healingPower',
  'accuracy',
  'evasion',
  'critChance',
  'critDamage',
  'actionSpeed',
] as const;
