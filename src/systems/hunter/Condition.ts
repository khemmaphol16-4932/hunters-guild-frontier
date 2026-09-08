/**
 * Hunger, fatigue and morale.
 *
 * REQ-HUN-011 (§48). Hunger and fatigue carry real stat and AI penalties; morale is
 * smaller but meaningful. Housing quality feeds recovery here in Phase 6 — the recovery
 * functions already take a quality multiplier so that system plugs in without a rewrite.
 *
 * Deliberately *not* a life simulator (§76): three scalars, no schedules, no needs tree.
 */

import type { PersonalityBalance } from '../../data/schema.js';
import type { Hunter, HunterCondition } from '../../core/hunter/Hunter.js';
import { withCondition } from '../../core/hunter/Hunter.js';
import { conditionMultiplier } from '../../core/hunter/attributes.js';
import type { EventBus } from '../../core/events.js';

export interface ConditionDeps {
  readonly balance: PersonalityBalance;
  readonly events: EventBus;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export class Condition {
  private readonly balance: PersonalityBalance;
  private readonly events: EventBus;

  constructor(deps: ConditionDeps) {
    this.balance = deps.balance;
    this.events = deps.events;
  }

  /** Multiplier applied to every derived stat, from hunger and fatigue combined. */
  statMultiplier(hunter: Hunter): number {
    const { fatigue, hunger } = this.balance.conditionInfluence;
    return conditionMultiplier(
      hunter.condition.fatigue,
      hunter.condition.hunger,
      fatigue.statPenaltyAtMax,
      hunger.statPenaltyAtMax,
    );
  }

  /** Risk-posture shift from hunger and fatigue. Tired hunters get careful. */
  riskPostureShift(hunter: Hunter): number {
    const { fatigue, hunger } = this.balance.conditionInfluence;
    return (
      clamp01(hunter.condition.fatigue) * fatigue.riskPostureShiftAtMax +
      clamp01(hunter.condition.hunger) * hunger.riskPostureShiftAtMax
    );
  }

  set(hunter: Hunter, condition: Partial<HunterCondition>): Hunter {
    const next: HunterCondition = {
      hunger: clamp01(condition.hunger ?? hunter.condition.hunger),
      fatigue: clamp01(condition.fatigue ?? hunter.condition.fatigue),
      morale: clamp01(condition.morale ?? hunter.condition.morale),
    };
    const updated = withCondition(hunter, next);
    this.events.emit('condition.changed', { hunterId: hunter.id, ...next });
    return updated;
  }

  /** Accumulate hunger and fatigue over a span of simulated activity. */
  exert(
    hunter: Hunter,
    seconds: number,
    hungerPerSecond: number,
    fatiguePerSecond: number,
    traitMultipliers: { hunger?: number; fatigue?: number } = {},
  ): Hunter {
    const hungerRate = hungerPerSecond * (traitMultipliers.hunger ?? 1);
    const fatigueRate = fatiguePerSecond * (traitMultipliers.fatigue ?? 1);
    return this.set(hunter, {
      hunger: hunter.condition.hunger + hungerRate * seconds,
      fatigue: hunter.condition.fatigue + fatigueRate * seconds,
    });
  }

  /**
   * Recover while resting. `housingQuality` is 1 at baseline and rises with better
   * housing (§48) — Phase 6 supplies the real value; until then callers pass 1.
   */
  rest(
    hunter: Hunter,
    seconds: number,
    fatigueRecoveryPerSecond: number,
    housingQuality = 1,
    traitMultiplier = 1,
  ): Hunter {
    const recovery = fatigueRecoveryPerSecond * housingQuality * traitMultiplier * seconds;
    return this.set(hunter, { fatigue: hunter.condition.fatigue - recovery });
  }

  feed(hunter: Hunter, amount: number): Hunter {
    return this.set(hunter, { hunger: hunter.condition.hunger - amount });
  }

  adjustMorale(hunter: Hunter, delta: number, volatility = 1): Hunter {
    return this.set(hunter, { morale: hunter.condition.morale + delta * volatility });
  }

  /** Plain-language state for the dashboard (REQ-UX-002 — the easy view avoids numbers). */
  describe(hunter: Hunter): string[] {
    const notes: string[] = [];
    const { hunger, fatigue, morale } = hunter.condition;

    if (fatigue > 0.7) notes.push('Exhausted — should not be sent out again yet.');
    else if (fatigue > 0.4) notes.push('Tired.');

    if (hunger > 0.7) notes.push('Starving.');
    else if (hunger > 0.4) notes.push('Hungry.');

    if (morale > 0.8) notes.push('In high spirits.');
    else if (morale < 0.3) notes.push('Morale is low.');

    if (notes.length === 0) notes.push('Rested and ready.');
    return notes;
  }
}
