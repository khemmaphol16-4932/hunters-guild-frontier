/**
 * Personality — bounded weights, never filters.
 *
 * REQ-HUN-010 and DL-007. §18 gives personality real gameplay impact; §70 makes Guild
 * Policy authoritative. Both hold only if personality can *reorder* choices without being
 * able to *authorise* one. So this system exposes weight shifts only, every one clamped by
 * balance/personality.json, and it has no API that could remove or add a candidate action.
 *
 * "Personality changes HOW the Hunter executes a valid decision, not whether the Guild's
 * strategic policy exists" (§18) is therefore a structural property here, not a convention.
 */

import type { PersonalityBalance, PersonalityDef, Role } from '../../data/schema.js';
import type { GameContent } from '../../data/loader.js';
import type { PersonalityId } from '../../core/ids.js';
import type { Hunter } from '../../core/hunter/Hunter.js';

export interface PersonalityInfluence {
  readonly riskPostureShift: number;
  readonly roleLeanShift: Readonly<Partial<Record<Role, number>>>;
  readonly utilityWeightShift: Readonly<Record<string, number>>;
  readonly moraleResilience: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class Personality {
  private readonly content: GameContent;
  private readonly balance: PersonalityBalance;

  constructor(content: GameContent) {
    this.content = content;
    this.balance = content.balance.personality;
  }

  definition(id: PersonalityId | string): PersonalityDef | undefined {
    return this.content.personalitiesById.get(id);
  }

  all(): readonly PersonalityDef[] {
    return this.content.personalities;
  }

  /**
   * The clamped influence a hunter's personality exerts.
   * Clamping happens here, once, so no consumer can accidentally apply raw data values.
   */
  influenceOf(hunter: Hunter): PersonalityInfluence {
    const def = this.definition(hunter.personalityId);
    if (!def) {
      return {
        riskPostureShift: 0,
        roleLeanShift: {},
        utilityWeightShift: {},
        moraleResilience: 1,
      };
    }

    const { riskPostureShift, roleLeanShift, utilityWeightShift } = this.balance.clamp;

    const roles: Partial<Record<Role, number>> = {};
    for (const [role, value] of Object.entries(def.roleLeanShift)) {
      roles[role as Role] = clamp(value, roleLeanShift.min, roleLeanShift.max);
    }

    const utility: Record<string, number> = {};
    for (const [key, value] of Object.entries(def.utilityWeightShift)) {
      utility[key] = clamp(value, utilityWeightShift.min, utilityWeightShift.max);
    }

    return {
      riskPostureShift: clamp(def.riskPostureShift, riskPostureShift.min, riskPostureShift.max),
      roleLeanShift: roles,
      utilityWeightShift: utility,
      moraleResilience: def.moraleResilience,
    };
  }

  /**
   * Additional risk-posture shift from current morale (§48 — morale has a smaller but
   * meaningful effect). Scaled by the hunter's morale resilience: a Stoic barely notices.
   */
  moraleRiskShift(hunter: Hunter): number {
    const influence = this.influenceOf(hunter);
    const { riskPostureAtLowMorale, riskPostureAtHighMorale } = this.balance.moraleInfluence;
    const morale = clamp(hunter.condition.morale, 0, 1);

    // Morale 0.5 is neutral; below drags toward caution, above toward confidence.
    const raw =
      morale < 0.5
        ? riskPostureAtLowMorale * (1 - morale * 2)
        : riskPostureAtHighMorale * ((morale - 0.5) * 2);

    // Higher resilience means morale moves them less.
    const resilience = Math.max(0.1, influence.moraleResilience);
    return raw / resilience;
  }

  describe(hunter: Hunter): string {
    return this.definition(hunter.personalityId)?.description ?? 'Unremarkable.';
  }
}
