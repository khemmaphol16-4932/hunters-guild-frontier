/**
 * Skill mastery — permanent, unbounded, saturating.
 *
 * REQ-MAS-001/002/003 and DL-005. The spec asks for "no practical hard cap" *and*
 * "diminishing returns" at once. The resolution: points grow forever, effects saturate.
 * effect(points) = maxBonus * points / (points + halfPoint), so a hunter with 2000 points
 * in Counter is meaningfully better than one with 500, without the number becoming absurd.
 *
 * This is the mechanical expression of REQ-PRIME-004: what a hunter actually does shapes
 * what they become. Mastery is earned by *use*, not by spending a currency, which is why
 * gainFromUse takes a significance — a skill used to survive a boss teaches more than the
 * same skill used on a rat.
 */

import type { MasteryBalance, MasteryEffectType } from '../../data/schema.js';
import type { SkillId } from '../../core/ids.js';
import type { Hunter } from '../../core/hunter/Hunter.js';
import { masteryOf, withMastery } from '../../core/hunter/Hunter.js';
import type { EventBus } from '../../core/events.js';
import type { SkillRegistry } from './SkillRegistry.js';

export type UseSignificance = 'routine' | 'difficult' | 'decisive';

export interface MasteryGain {
  readonly hunter: Hunter;
  readonly points: number;
  readonly total: number;
  /** The milestone crossed by this gain, if any. Drives chronicle entries (REQ-CHR-001). */
  readonly milestoneReached: number | undefined;
}

export interface SkillMasteryDeps {
  readonly balance: MasteryBalance;
  readonly registry: SkillRegistry;
  readonly events: EventBus;
}

export class SkillMastery {
  private readonly balance: MasteryBalance;
  private readonly registry: SkillRegistry;
  private readonly events: EventBus;

  constructor(deps: SkillMasteryDeps) {
    this.balance = deps.balance;
    this.registry = deps.registry;
    this.events = deps.events;
  }

  points(hunter: Hunter, skillId: SkillId): number {
    return masteryOf(hunter, skillId);
  }

  /**
   * Award mastery for using a skill.
   * `aptitudeMultiplier` carries the hunter's masteryAptitude potential facet and any
   * trait multipliers — this is where "learns faster than most" becomes real.
   */
  gainFromUse(
    hunter: Hunter,
    skillId: SkillId,
    significance: UseSignificance = 'routine',
    aptitudeMultiplier = 1,
  ): MasteryGain {
    const significanceMultiplier =
      this.balance.gainMultiplierBySignificance[significance] ?? 1;
    const points = this.balance.gainPerUse * significanceMultiplier * aptitudeMultiplier;

    const before = masteryOf(hunter, skillId);
    const after = before + points;

    const updated = withMastery(hunter, { ...hunter.mastery, [skillId]: after });

    this.events.emit('mastery.gained', {
      hunterId: hunter.id,
      skillId,
      points,
      total: after,
    });

    const milestoneReached = this.milestoneCrossed(before, after);
    if (milestoneReached !== undefined) {
      this.events.emit('mastery.milestone', {
        hunterId: hunter.id,
        skillId,
        milestone: milestoneReached,
      });
    }

    return { hunter: updated, points, total: after, milestoneReached };
  }

  /**
   * The saturating bonus for one effect type at a given point total.
   * Returns a fraction, e.g. 0.18 meaning +18%.
   */
  effectBonus(points: number, effect: MasteryEffectType): number {
    const curve = this.balance.effectCurves[effect];
    const p = Math.max(0, points);
    return (curve.maxBonus * p) / (p + curve.halfPoint);
  }

  /**
   * Every mastery effect currently active on a hunter's use of a skill.
   * Only effects the skill actually declares are returned — mastery in Mend does not
   * shorten a cooldown Mend does not care about (REQ-MAS-003: the effect is per-skill).
   */
  activeEffects(
    hunter: Hunter,
    skillId: SkillId,
  ): Readonly<Partial<Record<MasteryEffectType, number>>> {
    const def = this.registry.get(skillId);
    if (!def) return {};
    const points = masteryOf(hunter, skillId);
    const out: Partial<Record<MasteryEffectType, number>> = {};
    for (const effect of def.masteryEffects) {
      out[effect] = this.effectBonus(points, effect);
    }
    return out;
  }

  /**
   * 0..1 weight describing how strongly this skill has shaped the hunter.
   * Consumed by BuildIdentity: a hunter who has used Riposte ten thousand times *is* a
   * counter-fighter, whatever their class says.
   */
  identityWeight(points: number): number {
    const { maxWeight, halfPoint } = this.balance.buildIdentityInfluence;
    const p = Math.max(0, points);
    return (maxWeight * p) / (p + halfPoint);
  }

  /** The skill a hunter has invested the most in — the "favorite skill" of §19. */
  favouriteSkill(hunter: Hunter): { skillId: string; points: number } | undefined {
    let best: { skillId: string; points: number } | undefined;
    for (const [skillId, points] of Object.entries(hunter.mastery)) {
      if (!best || points > best.points) best = { skillId, points };
    }
    return best;
  }

  private milestoneCrossed(before: number, after: number): number | undefined {
    for (const milestone of this.balance.milestones) {
      if (before < milestone && after >= milestone) return milestone;
    }
    return undefined;
  }
}
