/**
 * The standing orders a player can give.
 *
 * §29 lists what hard constraints may cover — prohibited actions, prohibited zones, retreat
 * thresholds, death policy, equipment and skill restrictions. This is the catalogue of the
 * ones the prototype exposes, each written as a single predicate over one candidate action.
 *
 * They live in `ai/policy/` rather than in `debug/` because they are a *player* instrument:
 * the UI offers them, the expedition enforces them, and the audit log quotes them. Keeping
 * them in the debug console would have made the game's most consequential player input
 * reachable only from a developer tool.
 *
 * Every order is phrased as what it *forbids*, because that is all a hard constraint can do.
 * "Withdraw immediately" is expressible only as "nothing except withdrawing is permitted" —
 * filters remove candidates and can never add one (REQ-POL-004), so a mandate and a total
 * prohibition of the alternatives are the same statement.
 */

import type { CombatAction, CombatView } from '../hunter/hunterAI.js';
import type { CombatConstraint } from './PolicyBook.js';

export interface StandingOrder {
  readonly id: string;
  /** What the player sees when choosing it. */
  readonly label: string;
  /** What it means, in a sentence, for the orders list and the audit log. */
  readonly detail: string;
  readonly constraint: CombatConstraint;
  /**
   * What the order means for the *route*, as distinct from a single fight.
   *
   * Abandoning an engagement and abandoning the expedition are two different decisions made
   * by two different systems, and an order that governed only the first was quietly ignored
   * by the second: a player who checked "Hold the line" watched their party turn back at the
   * next node anyway. From the player's side that is one instruction being disobeyed, and
   * they are right — so an order states its route meaning explicitly rather than leaving it
   * to whichever layer happens to read it.
   */
  readonly route?: 'forbidsRetreat' | 'requiresRetreat';
}

/** The route-level force of the orders currently in play. */
export interface RouteOrders {
  readonly mustPressOn: boolean;
  readonly mustTurnBack: boolean;
}

export function routeOrders(activeIds: readonly string[]): RouteOrders {
  const active = new Set(activeIds);
  const withRoute = STANDING_ORDERS.filter((o) => o.route && active.has(o.constraint.id));
  return {
    mustPressOn: withRoute.some((o) => o.route === 'forbidsRetreat'),
    mustTurnBack: withRoute.some((o) => o.route === 'requiresRetreat'),
  };
}

/** Hold the line: the party may not break off, whatever it costs (§140-H). */
export const NEVER_RETREAT: StandingOrder = {
  id: 'never_retreat',
  label: 'Hold the line',
  detail:
    'Hunters may not break off from a fight. They will win engagements a cautious party ' +
    'would abandon, and they will die in a Black Zone rather than withdraw.',
  constraint: {
    id: 'never_retreat',
    describe: 'Guild policy forbids breaking off from this fight.',
    permits: (action: CombatAction) => action.kind !== 'retreat',
  },
  route: 'forbidsRetreat',
};

/** Get out (§140-I). Expressed as a veto on everything except leaving. */
export const WITHDRAW_NOW: StandingOrder = {
  id: 'must_retreat',
  label: 'Withdraw immediately',
  detail:
    'Nothing except withdrawing is permitted. Hunters will abandon a fight they are ' +
    'winning and leave a downed companion behind.',
  constraint: {
    id: 'must_retreat',
    describe: 'Guild policy requires an immediate withdrawal.',
    permits: (action: CombatAction) => action.kind === 'retreat',
  },
  route: 'requiresRetreat',
};

/**
 * No rescues. A hard, unpleasant order that some players will want: rescues cost fights.
 */
export const NO_RESCUES: StandingOrder = {
  id: 'no_rescues',
  label: 'No rescues',
  detail:
    'Hunters will not go back for a downed companion. Fights are shorter and losses are ' +
    'higher.',
  constraint: {
    id: 'no_rescues',
    describe: 'Guild policy forbids attempting a rescue.',
    permits: (action: CombatAction) =>
      action.kind !== 'rescue' && !(action.skill?.tags.includes('rescue') ?? false),
  },
};

/** Conserve ultimates for the fights that need them. */
export const SAVE_ULTIMATES: StandingOrder = {
  id: 'save_ultimates',
  label: 'Save ultimates for bosses',
  detail: 'Ultimates may not be spent on ordinary encounters.',
  constraint: {
    id: 'save_ultimates',
    describe: 'Guild policy reserves ultimates for boss encounters.',
    permits: (action: CombatAction, view: CombatView) => {
      if (action.skill?.category !== 'ultimate') return true;
      // "Is this a boss fight" is answered from what the hunter can see, not from the
      // expedition's route — REQ-AI-009 gives the AI no knowledge beyond the encounter.
      return view.enemies.some((e) => !e.dead && e.phase > 0 || e.telegraph !== undefined);
    },
  },
};

/** A skill ban — the most ordinary form of §29's prohibited actions. */
export function forbidSkill(skillId: string, skillName = skillId): StandingOrder {
  return {
    id: `forbid_skill:${skillId}`,
    label: `Never use ${skillName}`,
    detail: `${skillName} is prohibited outright.`,
    constraint: {
      id: `forbid_skill:${skillId}`,
      describe: `Guild policy forbids using ${skillName}.`,
      permits: (action: CombatAction) => action.skill?.id !== skillId,
    },
  };
}

/**
 * The orders offered in the UI.
 *
 * `NEVER_RETREAT` and `WITHDRAW_NOW` contradict each other by construction — together they
 * permit nothing at all, and a hunter with no legal action does nothing rather than
 * improvising. That is the correct behaviour for a contradictory instruction, and the UI
 * points it out rather than silently resolving it, because resolving it would mean choosing
 * on the player's behalf which of their two orders they meant.
 */
export const STANDING_ORDERS: readonly StandingOrder[] = [
  NEVER_RETREAT,
  WITHDRAW_NOW,
  NO_RESCUES,
  SAVE_ULTIMATES,
];

/** Orders that cannot both be in force. */
export const CONTRADICTIONS: readonly (readonly [string, string])[] = [
  ['never_retreat', 'must_retreat'],
];

/** Which pairs of currently-active orders contradict each other. */
export function contradictionsIn(activeIds: readonly string[]): readonly (readonly [string, string])[] {
  const active = new Set(activeIds);
  return CONTRADICTIONS.filter(([a, b]) => active.has(a) && active.has(b));
}
