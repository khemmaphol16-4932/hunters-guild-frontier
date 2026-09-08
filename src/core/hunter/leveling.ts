/**
 * Levels, experience, attribute point budget and respec.
 *
 * REQ-HUN-002/003/004. Level 1–100, points generated from the hunter's own level,
 * allocated by the player, and respeccable relatively cheaply with an obtainable resource.
 *
 * Rebirth (§10) is intentionally left as an interface with no implementation — it belongs
 * to Phase 8 progression, and stubbing it here rather than inventing rules now avoids
 * locking in a design the spec deliberately left open (TECH_DEBT.md).
 */

import type { AttributeBalance, AttributeKey } from '../../data/schema.js';
import { ATTRIBUTE_KEYS } from '../../data/schema.js';
import { err, ok, type Result } from '../result.js';
import { allocatedPoints, type Attributes } from './attributes.js';

/** Experience required to advance from `level` to `level + 1`. */
export function xpToNextLevel(level: number, balance: AttributeBalance): number {
  if (level >= balance.maxLevel) return Infinity;
  const l = Math.max(balance.minLevel, Math.floor(level));
  return Math.round(balance.xpCurve.base * Math.pow(l, balance.xpCurve.exponent));
}

/** Cumulative experience required to reach `level` from level 1. */
export function totalXpToReach(level: number, balance: AttributeBalance): number {
  let total = 0;
  for (let l = balance.minLevel; l < Math.min(level, balance.maxLevel); l++) {
    total += xpToNextLevel(l, balance);
  }
  return total;
}

/**
 * Total attribute points a hunter of this level has been granted.
 * Points are generated from the *individual hunter's* level (REQ-HUN-002), which is what
 * makes a level-60 veteran meaningfully different from a freshly recruited prodigy.
 */
export function attributePointBudget(level: number, balance: AttributeBalance): number {
  const levels = Math.max(0, Math.min(level, balance.maxLevel) - balance.minLevel);
  return balance.startingPoints + levels * balance.pointsPerLevel;
}

export function unspentPoints(
  attributes: Attributes,
  level: number,
  balance: AttributeBalance,
): number {
  return attributePointBudget(level, balance) - allocatedPoints(attributes, balance);
}

export interface LevelProgress {
  readonly level: number;
  readonly xp: number;
  readonly levelsGained: number;
  readonly atCap: boolean;
}

/**
 * Apply experience, rolling over multiple levels if warranted.
 * Excess experience at the cap is discarded rather than banked — banking it would make
 * Rebirth (Phase 8) instantly refund a hoard, which is a balance decision not yet made.
 */
export function applyExperience(
  level: number,
  xp: number,
  gained: number,
  balance: AttributeBalance,
): LevelProgress {
  let currentLevel = Math.max(balance.minLevel, Math.floor(level));
  let currentXp = Math.max(0, xp) + Math.max(0, gained);
  let levelsGained = 0;

  while (currentLevel < balance.maxLevel) {
    const needed = xpToNextLevel(currentLevel, balance);
    if (currentXp < needed) break;
    currentXp -= needed;
    currentLevel += 1;
    levelsGained += 1;
  }

  const atCap = currentLevel >= balance.maxLevel;
  return {
    level: currentLevel,
    xp: atCap ? 0 : currentXp,
    levelsGained,
    atCap,
  };
}

export interface AllocationRequest {
  readonly attribute: AttributeKey;
  readonly amount: number;
}

/**
 * Allocate attribute points. Rejects over-spending and dropping below the starting value,
 * so the UI and the debug console share one rule rather than each enforcing their own.
 */
export function allocate(
  attributes: Attributes,
  level: number,
  requests: readonly AllocationRequest[],
  balance: AttributeBalance,
): Result<Attributes, string> {
  const next: Record<AttributeKey, number> = { ...attributes };

  for (const request of requests) {
    if (!ATTRIBUTE_KEYS.includes(request.attribute)) {
      return err(`unknown attribute "${request.attribute}"`);
    }
    if (!Number.isInteger(request.amount)) {
      return err('attribute allocation must be a whole number of points');
    }
    const updated = next[request.attribute] + request.amount;
    if (updated < balance.startingValue) {
      return err(
        `${request.attribute} cannot go below its starting value of ${balance.startingValue}`,
      );
    }
    next[request.attribute] = updated;
  }

  const remaining = unspentPoints(next, level, balance);
  if (remaining < 0) {
    return err(`allocation exceeds the point budget by ${-remaining}`);
  }
  return ok(next);
}

/**
 * Cost, in the respec resource, of moving from one allocation to another.
 * Counts only points *removed*, so redistributing 5 points costs 5 rather than 10.
 */
export function respecCost(
  from: Attributes,
  to: Attributes,
  balance: AttributeBalance,
): number {
  let removed = 0;
  for (const key of ATTRIBUTE_KEYS) {
    const delta = from[key] - to[key];
    if (delta > 0) removed += delta;
  }
  const chargeable = Math.max(0, removed - balance.respec.freeMovesPerLevel);
  return chargeable * balance.respec.costPerPointMoved;
}

/** Reset every attribute to its starting value, freeing the whole budget. */
export function respecToBase(balance: AttributeBalance): Attributes {
  const out = {} as Record<AttributeKey, number>;
  for (const key of ATTRIBUTE_KEYS) out[key] = balance.startingValue;
  return out;
}

export function isAtLevelCap(level: number, balance: AttributeBalance): boolean {
  return level >= balance.maxLevel;
}

/**
 * Rebirth (§10) — deliberately unimplemented.
 *
 * The spec locks in that rebirth exists at the level cap and that old hunters must remain
 * valuable (REQ-HUN-005), but not what rebirth costs or grants. Inventing those rules now
 * would violate §127's instruction to isolate ambiguity rather than resolve it prematurely.
 * Phase 8 implements this interface; until then `isAtLevelCap` is the only rebirth-adjacent
 * behavior the game needs.
 */
export interface RebirthRules {
  canRebirth(level: number): boolean;
  applyRebirth(attributes: Attributes): Attributes;
}
