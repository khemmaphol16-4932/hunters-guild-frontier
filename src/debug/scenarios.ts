/**
 * Controlled behavioural scenarios (§118, §120, §140 A–M).
 *
 * REQ-TEC-008: the hunter AI is validated by *behavioural* scenarios, not by unit tests
 * alone. The distinction matters. A unit test proves a weight stage returns the number it
 * was written to return; a scenario proves that a healer standing in front of a bleeding
 * tank actually heals them. Only the second one is the requirement.
 *
 * So this file builds exact boards — precise health, precise positions, precise cooldowns —
 * and hands them to the real `HunterAI` through the real pipeline. Nothing is stubbed. If
 * a scenario fails it is because the AI would genuinely behave that way in a fight.
 *
 * It lives in `debug/` because it constructs states that the game itself would never
 * produce: a hunter at exactly 12% health with a specific skill off cooldown and one ally
 * downed three metres away. That is the point — §120 asks for a scenario harness, and a
 * harness that can only build reachable states cannot isolate a behaviour.
 */

import type { Session } from '../app/Session.js';
import type { Hunter } from '../core/hunter/Hunter.js';
import type { Combatant } from '../core/combat/Combatant.js';
import type { HunterId } from '../core/ids.js';
import { asSkillId } from '../core/ids.js';
import { hunterCombatant, monsterCombatant } from '../systems/combat/combatants.js';
import {
  NEUTRAL_OBJECTIVE,
  SAFE_ENVIRONMENT,
  type CombatAction,
  type CombatEnvironment,
  type CombatObjective,
  type CombatView,
  type Decision,
} from '../ai/hunter/hunterAI.js';
import type { HardConstraint } from '../ai/policy/pipeline.js';
import { NEVER_RETREAT, WITHDRAW_NOW, forbidSkill } from '../ai/policy/orders.js';

export interface BoardActor {
  /** Roster hunter to place, by id. */
  readonly hunterId: HunterId;
  /** 0..1 of max. Defaults to full. */
  readonly health?: number;
  /** 0..1 of max. Defaults to full. */
  readonly resource?: number;
  readonly position?: number;
  readonly downed?: boolean;
  /** Seconds left on the downed timer. Defaults to the full timer. */
  readonly downedRemaining?: number;
  /** Skills to put on cooldown, so "has the ultimate ready" is expressible as its negation. */
  readonly onCooldown?: readonly string[];
  readonly secondsSinceAttacked?: number;
}

export interface BoardEnemy {
  readonly monsterId: string;
  readonly health?: number;
  readonly position?: number;
  /** Seconds until a telegraphed skill lands, and whether it is an area attack. */
  readonly telegraph?: { readonly skillId: string; readonly remaining: number };
}

export interface Board {
  readonly actors: readonly BoardActor[];
  readonly enemies: readonly BoardEnemy[];
  readonly environment?: CombatEnvironment;
  readonly objective?: CombatObjective;
  readonly constraints?: readonly HardConstraint<CombatAction, CombatView>[];
  readonly elapsedSeconds?: number;
}

export interface ScenarioResult {
  readonly combatants: ReadonlyMap<HunterId, Combatant>;
  readonly enemies: readonly Combatant[];
  /** What each hunter decided, keyed by hunter id. */
  readonly decisions: ReadonlyMap<HunterId, Decision | undefined>;
  /** The view each hunter saw, for asserting on candidate sets. */
  readonly views: ReadonlyMap<HunterId, CombatView>;
}

export class ScenarioHarness {
  constructor(private readonly session: Session) {}

  /**
   * Build a board and ask every hunter on it what they would do.
   *
   * Every hunter decides against the *same* frozen board rather than in sequence, because
   * a scenario asks "what does this situation produce", and letting the first hunter act
   * would change the situation the second one sees.
   */
  run(board: Board): ScenarioResult {
    const { session } = this;
    const balance = session.content.balance.combat;

    const combatants = new Map<HunterId, Combatant>();
    for (const actor of board.actors) {
      const hunter = session.roster.require(actor.hunterId);
      const combatant = this.combatantFor(hunter);

      combatant.health = Math.max(0, Math.round(combatant.maxHealth * (actor.health ?? 1)));
      combatant.resource = Math.round(combatant.maxResource * (actor.resource ?? 1));
      combatant.position = actor.position ?? 0;
      combatant.secondsSinceAttacked = actor.secondsSinceAttacked ?? 999;

      if (actor.downed) {
        combatant.downed = true;
        combatant.health = 0;
        combatant.downedRemaining = actor.downedRemaining ?? balance.downed.timerSeconds;
      }
      for (const skillId of actor.onCooldown ?? []) {
        combatant.cooldowns.set(skillId, 30);
      }

      combatants.set(actor.hunterId, combatant);
    }

    const enemies = board.enemies.map((spec, index) => {
      const def = session.content.monstersById.get(spec.monsterId);
      if (!def) throw new Error(`ScenarioHarness: unknown monster "${spec.monsterId}"`);

      const combatant = monsterCombatant(def, index, spec.position ?? 1);
      combatant.health = Math.max(1, Math.round(combatant.maxHealth * (spec.health ?? 1)));
      if (spec.telegraph) {
        combatant.telegraph = { skillId: spec.telegraph.skillId, remaining: spec.telegraph.remaining };
      }
      return combatant;
    });

    const allies = [...combatants.values()];
    const telegraphs = enemies
      .filter((e) => e.telegraph !== undefined)
      .map((e) => {
        const def = e.monsterId ? session.content.monstersById.get(e.monsterId) : undefined;
        const skill = def?.skills.find((s) => s.id === e.telegraph?.skillId);
        return {
          casterId: e.id,
          secondsRemaining: e.telegraph?.remaining ?? 0,
          aoe: skill?.aoe ?? false,
        };
      });

    const decisions = new Map<HunterId, Decision | undefined>();
    const views = new Map<HunterId, CombatView>();

    for (const [hunterId, self] of combatants) {
      // A downed hunter has no decision to make; including them would produce a
      // meaningless `undefined` that reads like a failure.
      if (self.downed || self.dead) continue;

      const view: CombatView = {
        self,
        allies,
        enemies,
        elapsedSeconds: board.elapsedSeconds ?? 10,
        incomingTelegraphs: telegraphs,
        environment: board.environment ?? SAFE_ENVIRONMENT,
        objective: board.objective ?? NEUTRAL_OBJECTIVE,
        constraints: board.constraints ?? [],
        emergency: session.emergency,
      };
      views.set(hunterId, view);
      decisions.set(hunterId, session.hunterAI.decide(view));
    }

    return { combatants, enemies, decisions, views };
  }

  /** Convenience: what one hunter decided, as a short string for a test message. */
  static describe(decision: Decision | undefined): string {
    if (!decision) return 'no decision';
    return `${decision.action.kind}${decision.action.skill ? `:${decision.action.skill.id}` : ''}`;
  }

  private combatantFor(hunter: Hunter): Combatant {
    const { session } = this;
    return hunterCombatant(hunter, {
      attributeBalance: session.content.balance.attributes,
      combatBalance: session.content.balance.combat,
      profileOf: (h) => session.buildIdentity.profileOf(h),
      conditionMultiplier: (h) => session.condition.statMultiplier(h),
      equipmentStats: (h) => session.equipment.aggregateStats(h),
    });
  }
}

/**
 * The constraints the scenarios use.
 *
 * Thin aliases over the real player-authorable catalogue in `ai/policy/orders.ts`, so a
 * scenario exercises the same predicate the UI puts in force rather than a look-alike
 * written for the test. When the two drift, the scenarios stop being evidence.
 */
export const SCENARIO_CONSTRAINTS = {
  /** §140-H: "hold this line" — the party may not break off, whatever it costs. */
  neverRetreat: NEVER_RETREAT.constraint,
  /** §140-I: "get out", expressed as a veto on everything except leaving. */
  mustRetreat: WITHDRAW_NOW.constraint,
  /** A skill ban, the most ordinary form of §29's prohibited actions. */
  forbidSkill: (skillId: string): HardConstraint<CombatAction, CombatView> =>
    forbidSkill(skillId).constraint,
};
/** Give a hunter mastery in one skill, for §140-L. */
export function practise(session: Session, hunterId: HunterId, skillId: string, points: number): void {
  const hunter = session.roster.require(hunterId);
  session.roster.update({
    ...hunter,
    mastery: { ...hunter.mastery, [asSkillId(skillId)]: points },
  });
}
