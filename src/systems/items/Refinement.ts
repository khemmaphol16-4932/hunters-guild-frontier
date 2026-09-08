/**
 * Refinement — Safe Zone plus Risk Zone.
 *
 * REQ-EQP-005 (§22). The safe zone always succeeds; the risk zone is a real gamble with a
 * real downside. Three properties make it a decision rather than a treadmill:
 *
 *  - Refinement scales **main stats only**, so it cannot rescue a badly-rolled item. The
 *    substat lottery and the refinement gamble stay separate games.
 *  - Failure at high levels can *destroy* the item. A protection charge downgrades that
 *    outcome by one step but never improves the odds — buying safety, not buying success.
 *  - Every roll comes from the injected `refine` stream, so an attempt is reproducible
 *    and the whole system is testable (REQ-TEC-005).
 */

import type { RefinementBalance, RefinementFailure, RefinementStep } from '../../data/itemSchema.js';
import type { Rng } from '../../core/rng.js';
import type { Item } from '../../core/items/Item.js';
import { withRefinement } from '../../core/items/Item.js';
import { err, ok, type Result } from '../../core/result.js';

export type RefineResult =
  | { readonly kind: 'success'; readonly item: Item; readonly level: number }
  | { readonly kind: 'nothing'; readonly item: Item }
  | { readonly kind: 'downgrade'; readonly item: Item; readonly from: number; readonly to: number }
  | { readonly kind: 'destroyed'; readonly itemId: Item['id'] };

export interface AttemptCost {
  readonly gold: number;
  readonly protection: { readonly resourceId: string; readonly amount: number } | undefined;
}

export interface AttemptOptions {
  /** Spend a protection charge: destroy becomes downgrade, downgrade becomes nothing. */
  readonly useProtection?: boolean;
}

export class Refinement {
  constructor(private readonly balance: RefinementBalance) {}

  get maxLevel(): number {
    return this.balance.maxLevel;
  }

  get safeLimit(): number {
    return this.balance.safeLimit;
  }

  isInSafeZone(currentLevel: number): boolean {
    return currentLevel < this.balance.safeLimit;
  }

  isAtMax(item: Item): boolean {
    return item.refinement >= this.balance.maxLevel;
  }

  /** The step that governs the next attempt, or undefined while still in the safe zone. */
  stepFor(currentLevel: number): RefinementStep | undefined {
    return this.balance.riskZone.find((step) => step.level === currentLevel + 1);
  }

  /** Success chance of the next attempt. 1 inside the safe zone. */
  successChance(item: Item): number {
    if (this.isAtMax(item)) return 0;
    if (this.isInSafeZone(item.refinement)) return 1;
    return this.stepFor(item.refinement)?.successChance ?? 0;
  }

  /** What failure would do, after any protection is applied. */
  failureOutcome(item: Item, options: AttemptOptions = {}): RefinementFailure {
    if (this.isInSafeZone(item.refinement)) return 'nothing';
    const raw = this.stepFor(item.refinement)?.onFailure ?? 'nothing';
    return options.useProtection ? Refinement.softenFailure(raw) : raw;
  }

  cost(item: Item, options: AttemptOptions = {}): AttemptCost {
    const { base, perRefineLevel, perItemLevel } = this.balance.costPerAttempt;
    const nextLevel = item.refinement + 1;
    return {
      gold: Math.round(base + perRefineLevel * nextLevel + perItemLevel * item.itemLevel),
      protection: options.useProtection
        ? {
            resourceId: this.balance.protection.resourceId,
            amount: this.balance.protection.costPerAttempt,
          }
        : undefined,
    };
  }

  /**
   * Attempt one refinement.
   *
   * The caller is responsible for having already paid `cost()` — this system decides
   * outcomes, not affordability, so the economy can change without touching the gamble.
   */
  attempt(rng: Rng, item: Item, options: AttemptOptions = {}): Result<RefineResult, string> {
    if (this.isAtMax(item)) {
      return err(`${item.name} is already at maximum refinement`);
    }

    if (this.isInSafeZone(item.refinement)) {
      const level = item.refinement + 1;
      return ok({ kind: 'success', item: withRefinement(item, level), level });
    }

    const step = this.stepFor(item.refinement);
    if (!step) {
      return err(`no refinement step defined for level ${item.refinement + 1}`);
    }

    if (rng.bool(step.successChance)) {
      const level = item.refinement + 1;
      return ok({ kind: 'success', item: withRefinement(item, level), level });
    }

    const outcome = options.useProtection
      ? Refinement.softenFailure(step.onFailure)
      : step.onFailure;

    switch (outcome) {
      case 'nothing':
        return ok({ kind: 'nothing', item });
      case 'downgrade': {
        const to = Math.max(0, item.refinement - this.balance.downgradeLevels);
        return ok({ kind: 'downgrade', item: withRefinement(item, to), from: item.refinement, to });
      }
      case 'destroy':
        return ok({ kind: 'destroyed', itemId: item.id });
    }
  }

  /** Plain-language summary of the next attempt, for the UI (REQ-UX-002). */
  describeNextAttempt(item: Item, options: AttemptOptions = {}): string {
    if (this.isAtMax(item)) return 'Already fully refined.';
    const level = item.refinement + 1;

    if (this.isInSafeZone(item.refinement)) {
      return `+${level} is inside the safe zone and cannot fail.`;
    }

    const chance = Math.round(this.successChance(item) * 100);
    const failure = this.failureOutcome(item, options);
    const consequence =
      failure === 'destroy'
        ? 'the item is destroyed'
        : failure === 'downgrade'
          ? `it drops to +${Math.max(0, item.refinement - this.balance.downgradeLevels)}`
          : 'nothing happens';

    return `+${level} succeeds ${chance}% of the time; otherwise ${consequence}.`;
  }

  private static softenFailure(failure: RefinementFailure): RefinementFailure {
    switch (failure) {
      case 'destroy':
        return 'downgrade';
      case 'downgrade':
        return 'nothing';
      case 'nothing':
        return 'nothing';
    }
  }
}
