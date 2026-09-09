/**
 * Hunter combat AI.
 *
 * This is where risk R2 is settled. REQ-BLD-003 promises that different builds produce
 * different AI *decisions*, not just different damage numbers, and the mechanism is that
 * every utility consideration below reads the hunter's `BuildProfile` rather than their raw
 * stats. A cautious healer and a reckless duelist facing an identical board score the same
 * candidate actions differently, because role lean, risk posture, resource profile, skill
 * affinity and mastery all enter the score.
 *
 * Structure follows v1.0 §7 and REQ-AI-002:
 *   1. enumerate candidate actions
 *   2. filter — hard constraints first, then capability (REQ-SKL-007: unusable skills are
 *      removed *before* scoring, so a forbidden action never receives a score to win on)
 *   3. weigh — objective, then build identity, then urgency
 *   4. choose, and record a reason code (REQ-AI-011, v1.0 §14)
 *
 * There is deliberately no god class here: the pipeline is `ai/policy/pipeline.ts`, and this
 * file supplies considerations to it (REQ-TEC-010 forbids a giant HunterAI).
 */

import type { CombatBalance } from '../../data/combatSchema.js';
import type { SkillDef } from '../../data/schema.js';
import type { Combatant } from '../../core/combat/Combatant.js';
import {
  distanceBetween,
  healthFraction,
  isActive,
  resourceFraction,
  stat,
} from '../../core/combat/Combatant.js';
import { REASON } from '../../core/audit.js';
import {
  DecisionPipeline,
  hardConstraintStage,
  type Candidate,
  type FilterStage,
  type HardConstraint,
  type WeightStage,
} from '../policy/pipeline.js';
import type {
  EmergencyContext,
  EmergencyPolicy,
  EmergencyTrigger,
  OverrideDecision,
} from '../policy/emergency.js';

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type ActionKind = 'skill' | 'attack' | 'approach' | 'rescue' | 'wait';

export interface CombatAction extends Candidate {
  readonly id: string;
  readonly kind: ActionKind;
  readonly skill: SkillDef | undefined;
  readonly targetId: string | undefined;
  readonly basePriority: number;
}

/** Everything the AI is allowed to know. REQ-AI-009 — no omniscience beyond the encounter. */
export interface CombatView {
  readonly self: Combatant;
  readonly allies: readonly Combatant[];
  readonly enemies: readonly Combatant[];
  readonly elapsedSeconds: number;
  /** Enemy wind-ups the hunter can see (REQ-BOS-001 telegraphs, REQ-AI-008 prediction). */
  readonly incomingTelegraphs: readonly { casterId: string; secondsRemaining: number; aoe: boolean }[];
  /** Player policy compiled into hard constraints (REQ-POL-005). */
  readonly constraints: readonly HardConstraint<CombatAction, CombatView>[];
  readonly emergency: EmergencyPolicy | undefined;
}

export interface Decision {
  readonly action: CombatAction;
  readonly reasonCodes: readonly string[];
  /** Player-readable, for the decision log (REQ-AI-011). */
  readonly explanation: string;
  readonly overrides: readonly OverrideDecision[];
}

// ---------------------------------------------------------------------------
// Candidate enumeration
// ---------------------------------------------------------------------------

export interface HunterAIDeps {
  readonly balance: CombatBalance;
  readonly skillOf: (skillId: string) => SkillDef | undefined;
  readonly masteryOf: (hunterId: string, skillId: string) => number;
  readonly rangeDistance: (band: SkillDef['rangeBand']) => number;
}

export class HunterAI {
  constructor(private readonly deps: HunterAIDeps) {}

  /**
   * Enumerate every action worth considering.
   *
   * Conditions are evaluated here rather than in the scorer, because REQ-SKL-006/007 make a
   * skill's condition part of whether it is *usable at all* — a ready cooldown alone never
   * makes a skill available, and unusable skills must not reach the utility layer.
   */
  candidates(view: CombatView): readonly CombatAction[] {
    const { self } = view;
    const actions: CombatAction[] = [{ id: 'wait', kind: 'wait', skill: undefined, targetId: undefined, basePriority: 0 }];

    const livingEnemies = view.enemies.filter((e) => !e.dead);
    const downedAllies = view.allies.filter((a) => a.downed && !a.dead);

    // Rescue is its own action rather than a skill, because REQ-CBT-013 makes rescue
    // viability a tactical question every hunter faces, not only those holding the skill.
    for (const ally of downedAllies) {
      actions.push({
        id: `rescue:${ally.id}`,
        kind: 'rescue',
        skill: undefined,
        targetId: ally.id,
        basePriority: 80,
      });
    }

    for (const skillId of self.loadout) {
      const skill = this.deps.skillOf(skillId);
      if (!skill) continue;
      if ((self.cooldowns.get(skillId) ?? 0) > 0) continue;
      if (self.resource < skill.resourceCost) continue;
      if (!this.conditionsMet(skill, view)) continue;

      for (const target of this.targetsFor(skill, view)) {
        actions.push({
          id: `skill:${skillId}:${target.id}`,
          kind: 'skill',
          skill,
          targetId: target.id,
          basePriority: skill.basePriority,
        });
      }
    }

    // A basic attack is always available against a reachable enemy — a hunter out of
    // resource must still be able to contribute.
    const target = this.currentOrNearestEnemy(view, livingEnemies);
    if (target) {
      const inRange = distanceBetween(self, target) <= this.deps.balance.movement.rangeBands.melee;
      actions.push(
        inRange
          ? { id: `attack:${target.id}`, kind: 'attack', skill: undefined, targetId: target.id, basePriority: 20 }
          : { id: `approach:${target.id}`, kind: 'approach', skill: undefined, targetId: target.id, basePriority: 15 },
      );
    }

    return actions;
  }

  /** REQ-SKL-006: resource + cooldown + condition. Cooldown and resource checked by caller. */
  private conditionsMet(skill: SkillDef, view: CombatView): boolean {
    const { self } = view;

    return skill.conditions.every((condition) => {
      switch (condition.type) {
        case 'resourceAtLeast':
          return self.resource >= condition.value;
        case 'selfHpBelow':
          return healthFraction(self) < condition.value;
        case 'allyHpBelow':
          return view.allies.some((a) => isActive(a) && healthFraction(a) < condition.value);
        case 'allyDowned':
          return view.allies.some((a) => a.downed && !a.dead);
        case 'allyThreatenedWithin':
          return view.allies.some(
            (a) => isActive(a) && a.id !== self.id && distanceBetween(self, a) <= condition.value,
          );
        case 'wasAttackedWithin':
          // REQ-SKL-004: this is how a counter-attack exists without a reaction-skill
          // category. `riposte` is an ordinary skill whose condition is recency of harm.
          return self.secondsSinceAttacked <= condition.value;
        case 'enemiesWithinRadiusAtLeast':
          return (
            view.enemies.filter(
              (e) => !e.dead && distanceBetween(self, e) <= this.deps.balance.movement.rangeBands.mid,
            ).length >= condition.value
          );
        case 'partySizeAtLeast':
          return view.allies.filter(isActive).length >= condition.value;
        case 'targetHasStatus':
          return view.enemies.some((e) => e.statuses.length > 0);
      }
    });
  }

  private targetsFor(skill: SkillDef, view: CombatView): readonly Combatant[] {
    switch (skill.targeting) {
      case 'self':
        return [view.self];
      case 'ally':
        // The most hurt living ally is the only sensible single-ally target; offering all of
        // them would flood the candidate list with near-identical options.
        return [
          [...view.allies.filter(isActive)].sort(
            (a, b) => healthFraction(a) - healthFraction(b),
          )[0],
        ].filter((c): c is Combatant => c !== undefined);
      case 'allies':
        return [view.self];
      case 'downed_ally':
        return view.allies.filter((a) => a.downed && !a.dead);
      case 'enemy': {
        const target = this.currentOrNearestEnemy(view, view.enemies.filter((e) => !e.dead));
        return target ? [target] : [];
      }
      case 'enemies': {
        const target = this.currentOrNearestEnemy(view, view.enemies.filter((e) => !e.dead));
        return target ? [target] : [];
      }
    }
  }

  /**
   * REQ-AI-006 / DL-004: a hunter holds its target. Retargeting happens only when the
   * current target dies or becomes invalid — never because a better one appeared.
   */
  private currentOrNearestEnemy(
    view: CombatView,
    living: readonly Combatant[],
  ): Combatant | undefined {
    const locked = living.find((e) => e.id === view.self.targetId);
    if (locked) return locked;

    return [...living].sort(
      (a, b) => distanceBetween(view.self, a) - distanceBetween(view.self, b),
    )[0];
  }

  // -------------------------------------------------------------------------
  // Decision
  // -------------------------------------------------------------------------

  decide(view: CombatView): Decision | undefined {
    const overrides: OverrideDecision[] = [];

    const capability: FilterStage<CombatAction, CombatView> = {
      name: 'capability',
      permits: (action, ctx) => this.isPerformable(action, ctx),
      reason: (action) => `${action.id} is not performable from here`,
    };

    const pipeline = new DecisionPipeline<CombatAction, CombatView>({
      filters: [
        hardConstraintStage(
          view.constraints,
          view.emergency
            ? {
                policy: view.emergency,
                contextFor: (ctx) => emergencyContext(ctx),
                onOverride: (decision) => overrides.push(decision),
              }
            : undefined,
        ),
        capability,
      ],
      weights: this.weightStages(),
    });

    const decision = pipeline.evaluate(this.candidates(view), view);
    const chosen = decision.chosen;
    if (!chosen) return undefined;

    const reasonCodes: string[] = [REASON.utilityBestScore];
    if (overrides.length > 0) reasonCodes.push(REASON.emergencyOverrideApplied);
    if (chosen.kind === 'rescue') reasonCodes.push('rescue_attempted');
    if (decision.allRejected) reasonCodes.push(REASON.noLegalAction);

    return {
      action: chosen,
      reasonCodes,
      explanation: this.explain(chosen, view),
      overrides,
    };
  }

  private isPerformable(action: CombatAction, view: CombatView): boolean {
    const { self } = view;
    if (action.kind === 'wait') return true;

    const target = [...view.allies, ...view.enemies].find((c) => c.id === action.targetId);
    if (action.targetId !== undefined && !target) return false;

    if (action.kind === 'approach') return true;

    if (action.kind === 'rescue') {
      return target !== undefined && target.downed && !target.dead;
    }

    if (action.kind === 'attack') {
      return (
        target !== undefined &&
        distanceBetween(self, target) <= this.deps.balance.movement.rangeBands.melee
      );
    }

    // A skill needs its target inside the skill's own range band.
    if (action.skill && target) {
      const reach = this.deps.rangeDistance(action.skill.rangeBand);
      return distanceBetween(self, target) <= reach;
    }
    return true;
  }

  /**
   * The weight stages — the heart of build differentiation.
   *
   * Each stage reads the build profile. Two hunters with identical stats but different
   * profiles score the same board differently, which is what makes §140-K and §140-L
   * (identical builds differing only in personality, then only in mastery) produce
   * different decisions.
   */
  private weightStages(): readonly WeightStage<CombatAction, CombatView>[] {
    const w = this.deps.balance.ai.weights;

    return [
      {
        name: 'basePriority',
        weigh: (action) => action.basePriority * (w['basePriority'] ?? 0.01),
      },
      {
        // Role lean: a healer weighs healing highly, a tank weighs threat highly.
        name: 'roleAffinity',
        weigh: (action, view) => {
          const profile = view.self.profile;
          if (!profile || !action.skill) return 0;

          let score = 0;
          for (const [role, contribution] of Object.entries(action.skill.roleContribution)) {
            score += (profile.roleLean[role as keyof typeof profile.roleLean] ?? 0) * contribution;
          }
          return score * (w['roleAffinity'] ?? 1);
        },
      },
      {
        // Skill affinity: what this hunter gravitates toward, including via mastery.
        name: 'skillAffinity',
        weigh: (action, view) => {
          const profile = view.self.profile;
          if (!profile || !action.skill) return 0;

          let score = 0;
          for (const tag of action.skill.tags) score += profile.skillAffinity[tag] ?? 0;
          return score * (w['skillAffinity'] ?? 1);
        },
      },
      {
        // REQ-PRIME-004: what a hunter has actually done shapes what they reach for.
        name: 'masteryPreference',
        weigh: (action, view) => {
          if (!action.skill || !view.self.hunterId) return 0;
          const points = this.deps.masteryOf(String(view.self.hunterId), action.skill.id);
          // Saturating, so a heavily-practised skill is preferred without becoming the
          // only thing the hunter ever does.
          return (points / (points + 300)) * (w['masteryPreference'] ?? 1);
        },
      },
      {
        // Risk posture: an aggressive hunter discounts retreat and defensive play.
        name: 'riskPosture',
        weigh: (action, view) => {
          const profile = view.self.profile;
          if (!profile) return 0;
          const weight = w['riskPosture'] ?? 1;

          if (action.kind === 'attack' || action.skill?.roleContribution.damage) {
            return profile.riskPosture * weight;
          }
          if (action.skill?.tags.includes('defensive')) {
            return (1 - profile.riskPosture) * weight;
          }
          if (action.kind === 'rescue') {
            // A bold hunter attempts rescues a cautious one declines (REQ-CBT-013).
            return profile.riskPosture * weight * 0.5;
          }
          return 0;
        },
      },
      {
        // Resource profile: a burst build hoards, a sustain build spends freely.
        name: 'resourceProfile',
        weigh: (action, view) => {
          const profile = view.self.profile;
          if (!profile || !action.skill) return 0;

          const costShare = action.skill.resourceCost / Math.max(1, view.self.maxResource);
          const remaining = resourceFraction(view.self);
          // Sustain builds care little about cost; burst builds want to be near full before
          // committing something expensive.
          const willingness = profile.resourceProfile + remaining - 1;
          return -costShare * (1 - willingness) * (w['resourceProfile'] ?? 1);
        },
      },
      {
        // Urgency: the situation, weighted the same for everyone. This is what stops build
        // identity from overriding an emergency — a glass cannon still heals a dying ally
        // if nothing else can, because urgency outweighs preference.
        name: 'urgency',
        weigh: (action, view) => this.urgency(action, view) * (w['urgency'] ?? 2),
      },
    ];
  }

  private urgency(action: CombatAction, view: CombatView): number {
    const { balance } = this.deps;
    const target = [...view.allies, ...view.enemies].find((c) => c.id === action.targetId);

    if (action.kind === 'rescue' && target) {
      // More urgent the closer the downed timer is to expiring.
      const remaining = target.downedRemaining / Math.max(1, balance.downed.timerSeconds);
      return 1.2 * (1 - remaining);
    }

    if (action.skill?.tags.includes('restorative') && target) {
      const health = healthFraction(target);
      if (health <= balance.ai.criticalHealthFraction) return 1.5;
      if (health <= balance.ai.lowHealthFraction) return 0.8;
      return 0.1;
    }

    if (action.skill?.tags.includes('defensive')) {
      // Bracing matters when the hunter is hurt, or when something is winding up.
      const hurt = healthFraction(view.self) <= balance.ai.lowHealthFraction ? 0.7 : 0;
      const incoming = view.incomingTelegraphs.length > 0 ? 0.6 : 0;
      return hurt + incoming;
    }

    if (action.skill?.tags.includes('threat')) {
      // Taunting matters when a fragile ally is being hit — Tank Peel (REQ-AI-005).
      const endangered = view.allies.some(
        (a) => isActive(a) && a.id !== view.self.id && healthFraction(a) <= balance.ai.lowHealthFraction,
      );
      return endangered ? 0.9 : 0.1;
    }

    return 0;
  }

  /** REQ-AI-011: readable language, never raw scores. */
  private explain(action: CombatAction, view: CombatView): string {
    const name = view.self.name;
    const target = [...view.allies, ...view.enemies].find((c) => c.id === action.targetId);

    switch (action.kind) {
      case 'rescue':
        return `${name} moved to pull ${target?.name ?? 'a fallen ally'} clear.`;
      case 'approach':
        return `${name} closed on ${target?.name ?? 'the enemy'}.`;
      case 'attack':
        return `${name} attacked ${target?.name ?? 'the enemy'}.`;
      case 'wait':
        return `${name} held position — nothing worth doing.`;
      case 'skill': {
        const skill = action.skill?.name ?? 'a skill';
        if (action.skill?.tags.includes('restorative') && target) {
          return `${name} used ${skill} on ${target.name}, who was at ${Math.round(healthFraction(target) * 100)}% health.`;
        }
        if (action.skill?.tags.includes('threat')) {
          return `${name} used ${skill} to pull attention off the party.`;
        }
        return `${name} used ${skill}${target ? ` on ${target.name}` : ''}.`;
      }
    }
  }
}

function emergencyContext(view: CombatView): EmergencyContext {
  const triggers: EmergencyTrigger[] = [];

  if (view.allies.some((a) => a.downed && !a.dead)) triggers.push('allyDowned');
  if (view.allies.some((a) => isActive(a) && healthFraction(a) < 0.15)) {
    triggers.push('allyAboutToDie');
  }
  if (healthFraction(view.self) < 0.15) triggers.push('selfAboutToDie');
  if (view.allies.filter(isActive).length <= 1) triggers.push('partyWipeImminent');

  return { activeTriggers: triggers };
}

/** Stat helper re-export so the encounter can share the same accessor. */
export { stat };
