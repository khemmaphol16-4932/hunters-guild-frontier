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
  type ScoredCandidate,
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

export type ActionKind = 'skill' | 'attack' | 'approach' | 'rescue' | 'retreat' | 'dodge' | 'wait';

/**
 * What the fight's surroundings mean, reduced to what a hunter could actually perceive.
 *
 * `lethal` is not "this looks dangerous" — it is REQ-ZON-001's fact that this zone is
 * permitted to kill, which the guild knows before it sets out and tells its hunters.
 */
export interface CombatEnvironment {
  readonly zoneTier: string;
  readonly lethal: boolean;
  readonly canInjure: boolean;
}

/** A BLUE-zone default, so a caller that has no zone still gets defined behaviour. */
export const SAFE_ENVIRONMENT: CombatEnvironment = {
  zoneTier: 'blue',
  lethal: false,
  canInjure: false,
};

/**
 * The guild's objective, as combat sees it.
 *
 * Deliberately only what combat can act on. The full `ObjectiveDef` lives in the party
 * system; passing it whole would let a future weight stage reach into party-planning
 * concepts that have no meaning once the fight has started.
 */
export interface CombatObjective {
  readonly id: string;
  /** 0 = the guild wants everyone home, 1 = the guild wants this thing dead. */
  readonly riskPreference: number;
}

/** A middling objective, for callers running a fight outside an expedition. */
export const NEUTRAL_OBJECTIVE: CombatObjective = { id: 'none', riskPreference: 0.5 };

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
  /**
   * Where this fight is happening (§140-M). The same party in a BLUE and a BLACK zone must
   * reach different decisions, and the only honest way to get that is to tell the AI where
   * it is — inferring danger from the monsters would make a hard zone and a hard fight
   * indistinguishable, which is exactly the distinction REQ-ZON-001 draws.
   */
  readonly environment: CombatEnvironment;
  /**
   * What the guild sent them to do (§28's ObjectiveWeights tier, REQ-POL-002).
   *
   * Without this the objective stopped at the party planner: a "bring everyone home" party
   * and a "kill the boss" party picked different members and then fought identically, which
   * makes the objective a recruitment filter rather than a strategy. It sits above personal
   * priority and below hard constraints, exactly where §28 puts it.
   */
  readonly objective: CombatObjective;
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
  /**
   * Per-stage score contributions for every candidate, best first.
   *
   * REQ-UX-002's advanced view, and the only honest way to debug a utility AI: when a
   * hunter does something surprising, the answer is always which stage outvoted which, and
   * reconstructing that by reasoning about the code is how you convince yourself of the
   * wrong cause. Player-facing text never shows these numbers (REQ-AI-011).
   */
  readonly trace: readonly ScoredCandidate<CombatAction>[];
}

// ---------------------------------------------------------------------------
// Candidate enumeration
// ---------------------------------------------------------------------------

export interface HunterAIDeps {
  readonly balance: CombatBalance;
  readonly skillOf: (skillId: string) => SkillDef | undefined;
  readonly masteryOf: (hunterId: string, skillId: string) => number;
  readonly rangeDistance: (band: SkillDef['rangeBand']) => number;
  /** Monster definitions, for estimating what a fight is about to cost (§140-F). */
  readonly monsterOf?: (id: string) => { attackCooldown: number; tier: string } | undefined;
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

    // Retreat is always a candidate while there is anything to retreat from. It is offered
    // unconditionally rather than only when the hunter is hurt, because §29 lets the player
    // *forbid* retreat and §140-I lets policy *require* it — both need the action to exist
    // in the candidate set for a filter to act on, and a candidate that is conditionally
    // absent cannot be vetoed or mandated (REQ-POL-004).
    if (livingEnemies.length > 0) {
      actions.push({
        id: 'retreat',
        kind: 'retreat',
        skill: undefined,
        targetId: undefined,
        basePriority: 10,
      });
    }

    // Dodging a telegraphed area attack (§140-C). Only worth offering to someone actually
    // in its path, so a ranged hunter already outside it is not asked to consider it.
    const aoeIncoming = view.incomingTelegraphs.some((t) => t.aoe);
    const inThreatenedSpace =
      livingEnemies.length > 0 &&
      livingEnemies.some(
        (e) => distanceBetween(self, e) <= this.deps.balance.movement.rangeBands.mid,
      );
    if (aoeIncoming && inThreatenedSpace) {
      actions.push({
        id: 'dodge',
        kind: 'dodge',
        skill: undefined,
        targetId: undefined,
        basePriority: 60,
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

  /**
   * How likely a rescue is to succeed, 0..1 (§140-F, REQ-CBT-013).
   *
   * This is deliberately an *estimate a hunter could make*, not a solved probability: can I
   * get there, will the timer still be running when I arrive, how much of the enemy's
   * attention is standing over them, and can I take that while I am channelling and unable
   * to defend myself.
   *
   * Without this the AI had only risk posture to go on, which meant a bold hunter would
   * walk into a hopeless rescue every time and a cautious one would decline a trivial one.
   * Posture should decide how much risk is *acceptable*, not substitute for knowing what
   * the risk is.
   */
  rescueViability(rescuer: Combatant, downed: Combatant, view: CombatView): number {
    const { balance } = this.deps;

    const travel =
      distanceBetween(rescuer, downed) / Math.max(0.01, balance.movement.unitsPerSecond);
    const needed = travel + balance.downed.rescueSeconds;

    // If the timer runs out mid-channel the rescue was never possible.
    if (downed.downedRemaining <= needed) return 0;
    const timeMargin = Math.min(1, (downed.downedRemaining - needed) / needed);

    // Enemies standing over the body are what makes a rescue expensive: the rescuer is
    // channelling, so everything in reach hits them uncontested.
    const guarding = view.enemies.filter(
      (e) => !e.dead && distanceBetween(e, downed) <= balance.movement.rangeBands.melee,
    );
    const incoming = guarding.reduce(
      (sum, e) => sum + stat(e, 'physicalAttack', 10) / Math.max(0.1, this.attackInterval(e)),
      0,
    );
    const mitigated = Math.max(0, incoming - stat(rescuer, 'physicalDefense', 0) * 0.5);
    const expectedDamage = mitigated * needed;

    // Survivability is what fraction of the channel the rescuer can absorb.
    const survivability =
      expectedDamage <= 0 ? 1 : Math.min(1, rescuer.health / Math.max(1, expectedDamage));

    // A tank being the one to go is meaningfully different from the healer going.
    const suitability = 0.6 + 0.4 * (rescuer.profile?.roleLean.tank ?? 0);

    return clamp01(timeMargin * survivability * suitability);
  }

  /** Rough seconds between an enemy's attacks, for threat estimation. */
  private attackInterval(enemy: Combatant): number {
    const def = enemy.monsterId ? this.deps.monsterOf?.(enemy.monsterId) : undefined;
    return def?.attackCooldown ?? 2;
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
      trace: decision.scored,
    };
  }

  private isPerformable(action: CombatAction, view: CombatView): boolean {
    const { self } = view;
    if (action.kind === 'wait' || action.kind === 'retreat' || action.kind === 'dodge') return true;

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
        /**
         * Skill affinity: what this hunter gravitates toward, including via mastery.
         *
         * Averaged over the skill's tags, not summed. Summing made the stage grow with tag
         * count, so a three-tag skill scored roughly triple a one-tag skill for reasons that
         * had nothing to do with the hunter or the fight. In practice it reached ~4.9 against
         * an urgency term of ~2.5, which meant preference silently outvoted *every*
         * situational consideration — the AI always reached for its favourite skill, and
         * telegraphs, zone danger and objective could not change a decision.
         *
         * That is precisely the R2 failure this whole design exists to prevent, and it
         * survived a green test suite because the Phase 3 test compared a tank with a healer,
         * whose favourite skills differ anyway.
         */
        name: 'skillAffinity',
        weigh: (action, view) => {
          const profile = view.self.profile;
          if (!profile || !action.skill || action.skill.tags.length === 0) return 0;

          let score = 0;
          for (const tag of action.skill.tags) score += profile.skillAffinity[tag] ?? 0;
          return (score / action.skill.tags.length) * (w['skillAffinity'] ?? 1);
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
          // Dodging and breaking off are defensive play without being defensive *skills*.
          // Leaving them out gave every skill a constant identity head start that no
          // situational stage could close (§140-C).
          if (action.skill?.tags.includes('defensive') || action.kind === 'dodge') {
            return (1 - profile.riskPosture) * weight;
          }
          if (action.kind === 'retreat') {
            // Scaled by injury, unlike the others. A flat preference for leaving made an
            // unharmed hunter with every skill on cooldown walk away rather than keep
            // swinging — caution is about how much danger you accept, and at full health
            // there is no danger yet to accept.
            return (1 - profile.riskPosture) * weight * (1 - healthFraction(view.self));
          }
          if (action.kind === 'rescue') {
            // A bold hunter attempts rescues a cautious one declines (REQ-CBT-013), and a
            // loyal one goes back for a friend a little more readily (allySafety, from traits).
            return (profile.riskPosture * 0.5 + (profile.allySafety ?? 0)) * weight;
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
        /**
         * What we were sent to do (§28 ObjectiveWeights, REQ-POL-002).
         *
         * Placed above the identity stages and below hard constraints. A high-risk objective
         * pushes the party through a fight a cautious objective would break off; it never
         * *forbids* breaking off, because that is a hard constraint's job and this is a
         * weight.
         */
        name: 'objectiveAlignment',
        weigh: (action, view) => {
          const preference = view.objective.riskPreference;
          const weight = w['objectiveAlignment'] ?? 2;

          switch (action.kind) {
            case 'retreat': {
              // The whole point: "bring everyone home" leaves early, "kill the boss" does
              // not. Scaled by how much trouble the hunter is actually in, because an
              // objective shifts the *threshold* for leaving — it does not make leaving
              // attractive on its own. Unscaled, a cautious objective produced a party that
              // withdrew at full health without throwing a punch.
              const hurt = 1 - healthFraction(view.self);
              return (0.5 - preference) * 2 * weight * hurt;
            }
            case 'attack':
              return (preference - 0.5) * weight;
            case 'rescue':
              // Getting people back is worth more the more the objective is about people.
              return (0.5 - preference) * weight * 0.6;
            default:
              if (action.skill?.tags.includes('restorative')) {
                return (0.5 - preference) * weight * 0.5;
              }
              if (action.skill?.roleContribution.damage) {
                return (preference - 0.5) * weight * 0.5;
              }
              return 0;
          }
        },
      },
      {
        /**
         * Where we are (§140-M).
         *
         * A lethal zone does not make every hunter cautious — it makes caution *worth
         * more*, and how much more depends on the hunter. A reckless duelist in a BLACK
         * zone still fights; they simply stop discounting the exit as hard. Scaling by
         * `1 - riskPosture` is what keeps this an interaction between build and place
         * rather than a global modifier that flattens everyone into the same hunter.
         */
        name: 'zoneCaution',
        weigh: (action, view) => {
          if (!view.environment.lethal) return 0;
          const caution = 1 - (view.self.profile?.riskPosture ?? 0.5);
          const weight = w['zoneCaution'] ?? 1;

          switch (action.kind) {
            case 'retreat':
              return caution * weight * (1 - healthFraction(view.self));
            case 'dodge':
              return caution * weight * 0.8;
            case 'rescue':
              // Losing someone here is permanent, which cuts both ways: the rescue matters
              // more and costs more. Viability decides which, so this only amplifies.
              return (this.viabilityOf(action, view) - 0.5) * weight;
            default: {
              const skill = action.skill;
              if (!skill) return 0;

              // Where death is permanent, keeping people alive is worth more than it is
              // anywhere else — that is the whole content of REQ-ZON-001's BLACK tier, and
              // an AI that only reacted to it by running away would be treating a lethal
              // zone as a scary zone. So preservation gains and commitment loses.
              if (skill.tags.includes('restorative')) {
                const target = view.allies.find((a) => a.id === action.targetId);
                const injury = target ? 1 - healthFraction(target) : 0;
                return caution * weight * injury * 1.6;
              }
              if (skill.tags.includes('defensive')) return caution * weight * 0.8;
              // Pulling a monster off a fragile ally, likewise.
              if (skill.tags.includes('threat')) return caution * weight * 0.9;

              // Spending a long cast or a big cooldown is how a hurt hunter dies here.
              // Scaled by injury, so a healthy party still fights normally.
              const committing =
                action.kind === 'attack' || (skill.roleContribution.damage ?? 0) >= 0.4;
              if (!committing) return 0;
              return -caution * weight * (1 - healthFraction(view.self));
            }
          }
        },
      },
      {
        /**
         * Is this rescue worth attempting (§140-F)?
         *
         * Viability enters as a signed term centred on a half-chance, so a good rescue is
         * promoted and a hopeless one actively pushed below the alternatives rather than
         * merely un-boosted. A hunter who charges a rescue they cannot complete dies for
         * nothing and the downed ally still bleeds out.
         */
        name: 'rescueViability',
        weigh: (action, view) => {
          if (action.kind !== 'rescue') return 0;
          const viability = this.viabilityOf(action, view);
          // How good the odds have to be before this hunter will go. A bold hunter accepts
          // a long shot; a cautious one wants a sure thing. Written as a *threshold* rather
          // than as a bonus because the previous form subtracted boldness directly, which
          // made braver hunters less likely to attempt a rescue — the opposite of
          // REQ-CBT-013 and of what the word means.
          const threshold = 0.75 - (view.self.profile?.riskPosture ?? 0.5) * 0.5;
          return (viability - threshold) * (w['rescueViability'] ?? 3);
        },
      },
      {
        /**
         * Spending an ultimate (§140-D).
         *
         * An ultimate is not "the highest-priority skill" — it is a resource that is wrong
         * to spend on a fight that was already won. Worth is the fight's significance: a
         * boss, a crowd, or a party in real trouble.
         */
        name: 'ultimateTiming',
        weigh: (action, view) => {
          if (action.skill?.category !== 'ultimate') return 0;
          const weight = w['ultimateTiming'] ?? 2;

          const enemies = view.enemies.filter((e) => !e.dead);
          const bossPresent = enemies.some(
            (e) => e.monsterId !== undefined && this.deps.monsterOf?.(e.monsterId)?.tier === 'boss',
          );
          const remaining =
            enemies.reduce((sum, e) => sum + healthFraction(e), 0) / Math.max(1, enemies.length);
          const partyPressure =
            1 -
            view.allies.filter(isActive).reduce((sum, a) => sum + healthFraction(a), 0) /
              Math.max(1, view.allies.filter(isActive).length);

          const significance = Math.max(
            bossPresent ? 1 : 0,
            enemies.length >= 3 ? 0.7 : 0,
            partyPressure,
          );
          // Held back against a nearly-dead enemy even when the fight was significant.
          return (significance * remaining - 0.35) * weight;
        },
      },
      {
        /**
         * What the rest of the party is already doing.
         *
         * Not a coordination *protocol* — nobody is issuing orders, and REQ-AI-009 gives
         * each hunter only what they can see. It is the ordinary thing a person does when a
         * teammate is already handling something: they go and do something else. Without it
         * two hunters channel a rescue on the same body and one of them is simply wasted,
         * and three focus a target the first was already going to kill.
         */
        name: 'partyCoordination',
        weigh: (action, view) => {
          const weight = w['partyCoordination'] ?? 1;
          const others = view.allies.filter((a) => a.id !== view.self.id && isActive(a));

          if (action.kind === 'rescue') {
            // A rescue in progress does not need a second pair of hands, and the timer runs
            // on whoever is already there rather than on how many came.
            const covered = others.some((a) => a.rescuingId === action.targetId);
            return covered ? -weight * 2 : 0;
          }

          if (action.skill?.tags.includes('restorative')) {
            // Overhealing is the most common waste: several healers converge on the lowest
            // ally, and everyone else keeps taking damage untreated.
            const alsoTreating = others.filter((a) => a.targetId === action.targetId).length;
            return -alsoTreating * weight * 0.8;
          }

          if (action.kind === 'attack' || (action.skill?.roleContribution.damage ?? 0) > 0) {
            // Mild the other way: focus fire is good, so agreeing with an ally's target is
            // rewarded rather than penalised — just not enough to override a build's own
            // judgement about what to cast.
            const focusing = others.filter((a) => a.targetId === action.targetId).length;
            return Math.min(focusing, 2) * weight * 0.25;
          }

          return 0;
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

  /** Viability of a rescue action, or 0 if the target is gone. */
  private viabilityOf(action: CombatAction, view: CombatView): number {
    const target = view.allies.find((a) => a.id === action.targetId);
    return target ? this.rescueViability(view.self, target, view) : 0;
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

    if (action.kind === 'dodge') {
      // The nearer the landing, the less anything else matters (§140-C). A hunter who is
      // holding threat has a reason to stay, so a tank weighs this less than a caster.
      const soonest = view.incomingTelegraphs
        .filter((t) => t.aoe)
        .reduce((min, t) => Math.min(min, t.secondsRemaining), Infinity);
      if (!Number.isFinite(soonest)) return 0;
      const imminence = 1 - Math.min(1, soonest / 3);
      const anchored = view.self.profile?.roleLean.tank ?? 0;
      return 3.0 * imminence * (1 - anchored);
    }

    if (action.kind === 'retreat') {
      /**
       * Continuous in health, deliberately.
       *
       * This was originally a step: nothing above the low-health threshold, a jump at it,
       * another at critical. A step means the *crossing point* is fixed, so no other stage
       * can move it — zone danger, guild objective and risk posture all became decorative,
       * shifting scores on either side of a cliff they could never relocate. A hunter broke
       * off at exactly 35% health whether they were a reckless duelist on a boss kill in a
       * safe zone or a cautious healer told to bring everyone home from a BLACK zone.
       *
       * Squared so that urgency stays low while the hunter is merely scuffed and climbs
       * sharply as they approach death, which is the shape the step was reaching for.
       */
      const health = healthFraction(view.self);
      const ramp = (1 - health) ** 2 * balance.ai.retreatUrgencyScale;
      // Below the critical threshold, leaving stops being a judgement call.
      return health <= balance.ai.criticalHealthFraction ? Math.max(ramp, 1.3) : ramp;
    }

    if (action.skill?.tags.includes('defensive')) {
      // Bracing matters when the hunter is hurt, or when something is winding up.
      // Bracing matters when the hunter is hurt, and matters most when something is
      // visibly winding up. A hunter holding a shield should raise it rather than run —
      // that is the difference between the tank's answer to a telegraph and everyone
      // else's (§140-C).
      const hurt = healthFraction(view.self) <= balance.ai.lowHealthFraction ? 0.7 : 0;
      const soonest = view.incomingTelegraphs.reduce(
        (min, t) => Math.min(min, t.secondsRemaining),
        Infinity,
      );
      const incoming = Number.isFinite(soonest) ? 1.6 * (1 - Math.min(1, soonest / 3)) : 0;
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
      case 'retreat':
        return view.environment.lethal
          ? `${name} broke off — this is not a place to be caught out.`
          : `${name} broke off and gave ground.`;
      case 'dodge':
        return `${name} moved clear of what was coming.`;
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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
