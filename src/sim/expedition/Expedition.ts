/**
 * Expeditions — the vertical slice's spine.
 *
 * A party leaves, walks a procedurally generated route through a fixed region
 * (REQ-EXP-001), fights, and either comes home or does not. This is the layer that turns a
 * combat encounter into a *consequence*: XP, loot, fatigue, injuries, chronicle entries.
 *
 * This lives in `sim/` rather than `systems/` because it *drives* systems and AI rather than
 * being one of them, and because it is the code path offline catch-up will reuse verbatim
 * (v1.0 §18). Nothing here reads a wall clock or `Math.random()`; the whole run is a pure
 * function of (party, region, seed).
 *
 * The continue-or-retreat decision at each node is the Guild AI's, made against the player's
 * objective and constraints, and audited (v1.0 §14) — because "why did my party turn back
 * with the boss one node away?" must have an answer.
 */

import type {
  EventDef,
  EventOptionDef,
  MonsterDef,
  RegionDef,
  WorldData,
  ZoneTierDef,
} from '../../data/combatSchema.js';
import type { CombatBalance, StatusDef } from '../../data/combatSchema.js';
import type { SkillDef } from '../../data/schema.js';
import type { Rng, RngState } from '../../core/rng.js';
import { rngFromState } from '../../core/rng.js';
import type { HunterId } from '../../core/ids.js';
import type { Combatant } from '../../core/combat/Combatant.js';
import { healthFraction } from '../../core/combat/Combatant.js';
import { REASON } from '../../core/audit.js';
import {
  CombatEncounter,
  type CombatEventSink,
  type CombatFacts,
  type CombatLogEntry,
  type EncounterResult,
} from '../combat/CombatEncounter.js';
import type { HunterAI } from '../../ai/hunter/hunterAI.js';
import type { CombatAction, CombatView } from '../../ai/hunter/hunterAI.js';
import type { HardConstraint } from '../../ai/policy/pipeline.js';
import type { EmergencyPolicy } from '../../ai/policy/emergency.js';
import type { RouteOrders } from '../../ai/policy/orders.js';
import type { ObjectiveDef, PartyProposal } from '../../systems/party/Party.js';
import { tellStory, type CombatStory } from '../combat/combatStory.js';

export type NodeKind = 'combat' | 'rest' | 'discovery' | 'event' | 'boss';

export interface RouteNode {
  readonly index: number;
  readonly kind: NodeKind;
  /** Monster ids and counts, for combat and boss nodes. */
  readonly monsters: readonly string[];
  readonly label: string;
  /** How deep into an endless expedition this node lies. Absent (0) on an ordinary route. */
  readonly depth?: number;
}

/**
 * How an endless expedition scales (REQ-END-002). Monster stats grow per depth by the given
 * fractions; item level never does, because v1.0 §12 forbids endgame collapsing into an
 * infinitely rising item level.
 */
export interface EndlessRunConfig {
  readonly maxDepth: number;
  readonly statsPerDepth: Readonly<Record<string, number>>;
}

export interface RunOptions {
  readonly endless?: EndlessRunConfig;
  /** The boss on this route is the world boss (REQ-BOS-003); its kill is reported as one. */
  readonly worldBossId?: string;
  /**
   * The guild's recall (REQ-CW-010): once the party has worked this many nodes it turns for home
   * before the next, whatever the Guild AI would have chosen. 0 turns it back before the first.
   */
  readonly recallAfterNodes?: number;
}

export interface NodeReport {
  readonly node: RouteNode;
  readonly outcome:
    | 'cleared'
    | 'wiped'
    | 'withdrew'
    | 'timeout'
    | 'rested'
    | 'found'
    | 'resolved'
    | 'skipped';
  readonly xp: number;
  readonly highlights: readonly CombatLogEntry[];
  readonly encounterSeconds: number;
  /** Party health fraction on leaving the node. */
  readonly partyHealth: number;
  /** For a fight: the replay's verdict, its "why", key skills and moments (REQ-UX-004). */
  readonly story?: CombatStory;
  /** Structured replay data retained for presentation; it never feeds back into combat. */
  readonly facts?: CombatFacts;
}

export interface HunterAftermath {
  readonly hunterId: HunterId;
  readonly survived: boolean;
  readonly downedCount: number;
  readonly died: boolean;
  readonly injured: boolean;
  readonly xp: number;
  readonly fatigueAdded: number;
  /** Morale swing from events the party lived through, before the run-level swing. */
  readonly moraleChange: number;
  readonly healthFraction: number;
}

export interface ExpeditionResult {
  readonly regionId: string;
  readonly objective: ObjectiveDef;
  readonly nodes: readonly NodeReport[];
  readonly reachedNode: number;
  /**
   * How many nodes the party actually worked. Not `reachedNode`, which is an index: a detour
   * appends nodes with later indices and a shortcut skips some, so only this counts time spent.
   */
  readonly nodesEntered: number;
  readonly routeLength: number;
  readonly completed: boolean;
  readonly retreated: boolean;
  readonly wiped: boolean;
  readonly bossDefeated: boolean;
  readonly totalXp: number;
  readonly lootRolls: number;
  readonly aftermath: readonly HunterAftermath[];
  /** Which events fired and what the guild chose (REQ-EXP-002). */
  readonly events: readonly ResolvedEvent[];
  /** Total expedition time, against REQ-EXP-003's ten-minute cap. */
  readonly elapsedSeconds: number;
  /** True when the run ended because the cap was reached rather than by choice. */
  readonly outOfTime: boolean;
  readonly reputation: number;
  /** What the guild learned, for REQ-WLD-001's permanent record. */
  readonly learned: {
    readonly nodeKinds: readonly string[];
    readonly monsters: readonly string[];
    readonly deepestNode: number;
  };
  /** The Guild AI's own account of the run, in order (v1.0 §14/§18). */
  readonly decisions: readonly ExpeditionDecision[];
  readonly summary: string;
  /** Present only for an endless run: how many full routes the party walked. */
  readonly endless?: { readonly depthsCleared: number; readonly deepestDepth: number };
}

export interface ResolvedEvent {
  readonly eventId: string;
  readonly optionId: string;
  readonly atNode: number;
}

/**
 * A party member's state as it carries between nodes. Everything else about a combatant —
 * threat, statuses, cooldowns, target, position — is reset at the start of each fight, so only
 * these fields survive a node boundary. The combatant is rebuilt by `combatantFor` on resume and
 * re-dressed with these, which is byte-identical to carrying the same object through.
 */
export interface RunCombatantState {
  readonly hunterId: HunterId;
  health: number;
  resource: number;
  dead: boolean;
  downed: boolean;
  downedRemaining: number;
}

/**
 * The full, serialisable state of an expedition suspended at a node boundary (DL-074). It holds
 * the RNG's four-word state, the route as walked so far (branches and detours included), the
 * cursor, the party's carried combatant state, and every accumulator the final result is built
 * from. `begin` produces it, `stepNode` advances it one stop, `finalize` turns it into an
 * `ExpeditionResult`. It is plain data throughout — Maps are stored as records keyed by hunter id —
 * so it round-trips through JSON and resumes on exactly the same sequence.
 */
export interface ExpeditionRunState {
  rng: RngState;
  walk: RouteNode[];
  cursor: number;
  readonly members: readonly HunterId[];
  combatants: RunCombatantState[];
  reports: NodeReport[];
  decisions: ExpeditionDecision[];
  events: ResolvedEvent[];
  downedCounts: Record<string, number>;
  xpEarned: Record<string, number>;
  lootRolls: number;
  retreated: boolean;
  wiped: boolean;
  bossDefeated: boolean;
  reached: number;
  entered: number;
  depth: number;
  depthsCleared: number;
  elapsedSeconds: number;
  outOfTime: boolean;
  endedByEvent: boolean;
  extraLoot: number;
  fatigueFromEvents: number;
  moraleFromEvents: number;
  reputation: number;
  ambushNext: boolean;
  /** Set once the route has ended — the party has turned for home. */
  done: boolean;
}

export interface ExpeditionDecision {
  readonly atNode: number;
  readonly choice: 'continue' | 'retreat' | 'commit';
  readonly explanation: string;
  readonly reasonCodes: readonly string[];
}

export interface ExpeditionDeps {
  readonly world: WorldData;
  readonly balance: CombatBalance;
  readonly ai: HunterAI;
  readonly skillOf: (id: string) => SkillDef | undefined;
  readonly statusOf: (id: string) => StatusDef | undefined;
  readonly monsterOf: (id: string) => MonsterDef | undefined;
  readonly constraints: readonly HardConstraint<CombatAction, CombatView>[];
  readonly emergency: EmergencyPolicy | undefined;
  /** Builds the per-encounter combatant for one party member, at its current health. */
  readonly combatantFor: (hunterId: HunterId) => Combatant;
  readonly monsterCombatant: (def: MonsterDef, index: number, position: number) => Combatant;
  /** The guild's memory (§19). Optional so balance runs can stay silent. */
  readonly chronicle?: CombatEventSink;
  /** Trait and friendship bonuses to a hunter's output, asked per action (systems/combat/outgoing). */
  readonly outgoingMultiplier?: (actor: Combatant, allies: readonly Combatant[], elapsedSeconds: number) => number;
  /** Route-level force of the player's standing orders (§29). */
  readonly routeOrders?: () => RouteOrders;
  /** The authored event catalogue (REQ-EXP-002). */
  readonly events?: readonly EventDef[];
}

/**
 * How an encounter outcome reads as a route node.
 *
 * A withdrawal and a timeout are both "the party stopped fighting and is still alive" —
 * they are not defeats, and the aftermath must not treat them as such.
 */
const NODE_OUTCOME: Readonly<Record<EncounterResult['outcome'], NodeReport['outcome']>> = {
  victory: 'cleared',
  defeat: 'wiped',
  withdrawal: 'withdrew',
  timeout: 'timeout',
  ongoing: 'timeout',
};

/** Fatigue added per node walked, before any objective or zone modifier. */
const FATIGUE_PER_NODE = 0.06;

export class Expedition {
  constructor(private readonly deps: ExpeditionDeps) {}

  /**
   * Generate the route.
   *
   * REQ-EXP-001: procedural routes inside a fixed world. The region defines the pool and the
   * length band; the seed picks the walk. A region with a boss always ends on it, so "clear
   * the route" and "kill the boss" are the same journey with a different stopping rule.
   */
  route(rng: Rng, region: RegionDef): readonly RouteNode[] {
    const length = rng.int(region.routeLength.min, region.routeLength.max + 1);
    const kinds = Object.entries(this.deps.world.nodeKinds).filter(
      ([name]) => name !== '$comment',
    );

    const nodes: RouteNode[] = [];
    for (let i = 0; i < length; i++) {
      // The first node is always combat: a route that opens on a rest node reads as the
      // expedition not having started.
      const kind = i === 0 ? 'combat' : (weightedPick(rng, kinds) as NodeKind);

      if (kind === 'event') {
        // The event id rides in `monsters[0]`. Not elegant, but a route node is a small
        // value type and giving it a second optional payload field for one kind would
        // widen it for every other — the resolver reads it back by name.
        const event = this.pickEvent(rng, region);
        nodes.push({
          index: i,
          kind: 'event',
          monsters: event ? [event.id] : [],
          label: event?.name ?? 'Something happens',
        });
        continue;
      }

      if (kind !== 'combat') {
        nodes.push({
          index: i,
          kind,
          monsters: [],
          label: kind === 'rest' ? 'A defensible camp' : 'Something left behind',
        });
        continue;
      }

      const encounter = weightedPickEncounter(rng, region);
      const count = rng.int(encounter.count.min, encounter.count.max + 1);
      const monsters: string[] = [];
      for (let m = 0; m < count; m++) {
        monsters.push(encounter.monsters[m % encounter.monsters.length] ?? '');
      }
      nodes.push({
        index: i,
        kind: 'combat',
        monsters: monsters.filter((id) => id !== ''),
        label: this.describeGroup(monsters),
      });
    }

    if (region.boss !== undefined) {
      nodes.push({
        index: nodes.length,
        kind: 'boss',
        monsters: [region.boss],
        label: this.deps.monsterOf(region.boss)?.name ?? region.boss,
      });
    }

    return nodes;
  }

  /**
   * Run the whole expedition.
   *
   * Party state carries between nodes — health does not reset — which is what makes the
   * continue-or-retreat decision real rather than cosmetic.
   */
  run(rng: Rng, region: RegionDef, party: PartyProposal, options: RunOptions = {}): ExpeditionResult {
    const state = this.begin(rng, region, party, options);
    while (this.stepNode(state, region, party, options) === 'continue') {
      // One node per step; the loop drives the whole route to its end.
    }
    return this.finalize(state, region, party, options);
  }

  /**
   * Draw the route and build the party, producing a run suspended before its first stop (DL-074).
   * Consumes `rng` for the route draw only; every later draw runs from the state stored in the
   * returned `ExpeditionRunState`, so the run can be stepped, saved and resumed on the same
   * sequence. A mutable `walk` (rather than a fixed array) is what lets REQ-EXP-002's branching
   * change the route while it is walked: an event may add nodes or skip some.
   */
  begin(rng: Rng, region: RegionDef, party: PartyProposal, _options: RunOptions = {}): ExpeditionRunState {
    const nodes = this.route(rng, region);
    const members = party.members.map((m) => m.hunterId);
    const combatants = members.map((id) => sliceOf(this.deps.combatantFor(id), id));
    return {
      rng: rng.state(),
      walk: [...nodes],
      cursor: 0,
      members,
      combatants,
      reports: [],
      decisions: [],
      events: [],
      downedCounts: {},
      xpEarned: {},
      lootRolls: 0,
      retreated: false,
      wiped: false,
      bossDefeated: false,
      reached: 0,
      entered: 0,
      depth: 0,
      depthsCleared: 0,
      elapsedSeconds: 0,
      outOfTime: false,
      endedByEvent: false,
      extraLoot: 0,
      fatigueFromEvents: 0,
      moraleFromEvents: 0,
      reputation: 0,
      ambushNext: false,
      done: false,
    };
  }

  /**
   * Advance a suspended run by exactly one stop — one iteration of the route walk. Returns
   * `'continue'` while there is more route to walk and `'done'` once the party has turned for
   * home (`state.done` is then set and `finalize` may be called). The RNG and the party's carried
   * combatant state are read from and written back to `state`, so the next call resumes on exactly
   * the same sequence, even across a save. This is one iteration of the former monolithic loop.
   */
  stepNode(state: ExpeditionRunState, region: RegionDef, party: PartyProposal, options: RunOptions = {}): 'continue' | 'done' {
    const tier = this.deps.world.zoneTiers[region.zoneTier];
    const endless = options.endless;
    const rng = rngFromState(state.rng);
    const combatants = this.rebuildCombatants(state);

    const save = (): void => {
      state.rng = rng.state();
      state.combatants = [...combatants.values()].map((c) => sliceOf(c, c.hunterId as HunterId));
    };
    const finish = (): 'done' => {
      save();
      state.done = true;
      return 'done';
    };
    const advance = (by: number): 'continue' => {
      save();
      state.cursor += by;
      return 'continue';
    };

    // REQ-END-002: an endless run does not end with its route. Each time one is behind the party,
    // the next is laid down one depth deeper; the same continue-or-retreat decision governs it.
    if (state.cursor >= state.walk.length) {
      if (!endless || state.depth + 1 >= endless.maxDepth) {
        if (endless) state.depthsCleared = state.depth + 1;
        return finish();
      }
      state.depth += 1;
      state.depthsCleared = state.depth;
      const deeper = this.route(rng, region).map((next, i) => ({
        ...next,
        index: state.walk.length + i,
        depth: state.depth,
        label: `Depth ${state.depth + 1}: ${next.label}`,
      }));
      state.walk.push(...deeper);
    }
    const node = state.walk[state.cursor];
    if (!node) return finish();

    const living = [...combatants.values()].filter((c) => !c.dead);
    if (living.length === 0) {
      state.wiped = true;
      return finish();
    }

    // REQ-EXP-003 caps an expedition at ten minutes, checked before entering a node so the party
    // is never sent into a fight it has no time to finish.
    if (state.elapsedSeconds >= this.deps.balance.maxExpeditionSeconds) {
      state.outOfTime = true;
      state.decisions.push({
        atNode: node.index,
        choice: 'retreat',
        explanation:
          `The party is out of daylight after ` +
          `${Math.round(state.elapsedSeconds / 60)} minutes and turns for home.`,
        reasonCodes: [`node:${node.kind}`, 'out_of_time'],
      });
      return finish();
    }

    // REQ-CW-010: the guild's recall overrides the Guild AI, checked at the same point as any
    // retreat — before entering — so everything up to here is the route it would have walked.
    if (options.recallAfterNodes !== undefined && state.entered >= options.recallAfterNodes) {
      state.retreated = true;
      state.decisions.push({
        atNode: node.index,
        choice: 'retreat',
        explanation: 'The guild has recalled the party, and it turns for home.',
        reasonCodes: [`node:${node.kind}`, 'order:recalled'],
      });
      state.reports.push({
        node,
        outcome: 'skipped',
        xp: 0,
        highlights: [],
        encounterSeconds: 0,
        partyHealth: partyHealthFraction([...combatants.values()]),
      });
      return finish();
    }

    // Decide before entering, not after — the party turns back at the edge of a fight, which is
    // the only point at which turning back saves anyone.
    const decision = this.decideAtNode(node, [...combatants.values()], party.objective, tier);
    state.decisions.push(decision);
    if (decision.choice === 'retreat') {
      state.retreated = true;
      state.reports.push({
        node,
        outcome: 'skipped',
        xp: 0,
        highlights: [],
        encounterSeconds: 0,
        partyHealth: partyHealthFraction([...combatants.values()]),
      });
      return finish();
    }

    state.reached = node.index + 1;
    state.entered += 1;

    if (node.kind === 'rest') {
      const relief = this.deps.world.nodeKinds['rest']?.['fatigueRelief'] ?? 0.1;
      for (const c of combatants.values()) {
        if (c.dead) continue;
        c.health = Math.min(c.maxHealth, c.health + Math.round(c.maxHealth * relief * 2));
        c.resource = c.maxResource;
      }
      state.reports.push({
        node,
        outcome: 'rested',
        xp: 0,
        highlights: [],
        encounterSeconds: 0,
        partyHealth: partyHealthFraction([...combatants.values()]),
      });
      return advance(1);
    }

    if (node.kind === 'discovery') {
      state.lootRolls += this.deps.world.nodeKinds['discovery']?.['lootRolls'] ?? 1;
      state.elapsedSeconds += 30;
      state.reports.push({
        node,
        outcome: 'found',
        xp: 0,
        highlights: [],
        encounterSeconds: 0,
        partyHealth: partyHealthFraction([...combatants.values()]),
      });
      return advance(1);
    }

    if (node.kind === 'event') {
      const resolved = this.resolveEvent(rng, node, [...combatants.values()], party.objective);
      if (!resolved) {
        state.reports.push({
          node,
          outcome: 'skipped',
          xp: 0,
          highlights: [],
          encounterSeconds: 0,
          partyHealth: partyHealthFraction([...combatants.values()]),
        });
        return advance(1);
      }

      const { event, option, decision: eventDecision } = resolved;
      state.decisions.push(eventDecision);

      const fx = option.effects;
      state.extraLoot += fx.lootRolls ?? 0;
      state.fatigueFromEvents += fx.fatigue ?? 0;
      state.moraleFromEvents += fx.morale ?? 0;
      state.reputation += fx.reputation ?? 0;
      state.elapsedSeconds += fx.seconds ?? 30;
      if (fx.ambush === true) state.ambushNext = true;

      if (fx.heal !== undefined) {
        for (const c of combatants.values()) {
          if (c.dead) continue;
          c.health = Math.min(c.maxHealth, c.health + Math.round(c.maxHealth * fx.heal));
          c.resource = c.maxResource;
        }
      }

      // The branching itself. Extra nodes are drawn from the same region pool, so the long way
      // round is a real detour rather than a label; a shortcut skips ahead.
      if (fx.extraNodes !== undefined && fx.extraNodes > 0) {
        const inserted = this.extraNodes(rng, region, fx.extraNodes, state.walk.length);
        state.walk.splice(state.cursor + 1, 0, ...inserted);
      }
      const skip = fx.skipNodes !== undefined && fx.skipNodes > 0 ? fx.skipNodes : 0;

      state.events.push({ eventId: event.id, optionId: option.id, atNode: node.index });
      state.reports.push({
        node,
        outcome: 'resolved',
        xp: 0,
        highlights: [],
        encounterSeconds: 0,
        partyHealth: partyHealthFraction([...combatants.values()]),
      });

      if (fx.endsExpedition === true) {
        state.endedByEvent = true;
        return finish();
      }
      return advance(1 + skip);
    }

    const result = this.fight(rng, node, combatants, region, party.objective, state.ambushNext, endless, options.worldBossId);
    state.ambushNext = false;
    state.elapsedSeconds += result.elapsedSeconds + 20;

    for (const c of combatants.values()) {
      if (c.downed) state.downedCounts[c.hunterId as HunterId] = (state.downedCounts[c.hunterId as HunterId] ?? 0) + 1;
    }

    // XP is split across everyone still standing when the fight started; a hunter who went down
    // still learns from it, one already dead does not.
    const share = living.length > 0 ? Math.round(result.xp / living.length) : 0;
    for (const c of living) {
      const id = c.hunterId;
      if (id) state.xpEarned[id] = (state.xpEarned[id] ?? 0) + share;
    }

    state.reports.push({
      node,
      outcome: NODE_OUTCOME[result.outcome],
      xp: result.xp,
      highlights: result.log.filter((e) => e.highlight),
      encounterSeconds: Math.round(result.elapsedSeconds * 10) / 10,
      partyHealth: partyHealthFraction([...combatants.values()]),
      story: tellStory(result.facts, result.outcome, result.elapsedSeconds),
      facts: result.facts,
    });

    if (result.outcome === 'victory') {
      state.lootRolls += node.kind === 'boss' ? 3 : 1;
      if (node.kind === 'boss') state.bossDefeated = true;
      // Survivors of a won fight get back up; the run continues with them wounded.
      for (const c of combatants.values()) {
        if (c.downed && !c.dead) {
          c.downed = false;
          c.health = Math.max(1, Math.round(c.maxHealth * this.deps.balance.downed.reviveHealthFraction));
        }
      }
      return advance(1);
    } else if (result.outcome === 'defeat') {
      state.wiped = true;
      return finish();
    }
    // Withdrawal or stalemate. The party is alive and the route is over — treating either as a
    // wipe would kill hunters who broke off precisely to avoid dying.
    state.retreated = true;
    return finish();
  }

  /** Rebuild the live combatant map from the carried state: a fresh combatant re-dressed. */
  private rebuildCombatants(state: ExpeditionRunState): Map<HunterId, Combatant> {
    const combatants = new Map<HunterId, Combatant>();
    for (const id of state.members) {
      const c = this.deps.combatantFor(id);
      const s = state.combatants.find((x) => x.hunterId === id);
      if (s) {
        c.health = s.health;
        c.resource = s.resource;
        c.dead = s.dead;
        c.downed = s.downed;
        c.downedRemaining = s.downedRemaining;
      }
      combatants.set(id, c);
    }
    return combatants;
  }

  /** Build the final result from a run that has turned for home (DL-074). */
  finalize(state: ExpeditionRunState, region: RegionDef, party: PartyProposal, options: RunOptions = {}): ExpeditionResult {
    const tier = this.deps.world.zoneTiers[region.zoneTier];
    const endless = options.endless;
    const combatants = this.rebuildCombatants(state);
    const {
      reports, decisions, events, downedCounts, xpEarned, lootRolls, retreated, wiped,
      bossDefeated, reached, entered, depth, depthsCleared, elapsedSeconds, outOfTime,
      endedByEvent, extraLoot, fatigueFromEvents, moraleFromEvents, reputation, walk,
    } = state;

    const aftermath = party.members.map((member) => {
      const c = combatants.get(member.hunterId);
      const nodeCount = Math.max(1, reached);

      // A hunter left down when the party was broken is lost, and so is one whose downed timer
      // ran out mid-fight. The first case matters more than it looks: an encounter ends the
      // moment the last hunter falls, so nobody's timer *can* expire in a wipe.
      const lost = (c?.dead ?? false) || (wiped && (c?.downed ?? false));

      // REQ-ZON-001: what a zone is *allowed* to do is the zone's property. A hunter lost in a
      // BLUE zone comes home tired instead.
      const died = lost && tier.canKill;
      const injured = !died && (lost || (c?.downed ?? false)) && tier.canInjure;

      return {
        hunterId: member.hunterId,
        survived: !died,
        downedCount: downedCounts[member.hunterId] ?? 0,
        died,
        injured,
        xp: xpEarned[member.hunterId] ?? 0,
        fatigueAdded: Math.min(
          1,
          Math.max(0, nodeCount * FATIGUE_PER_NODE * (wiped ? 1.5 : 1) + fatigueFromEvents),
        ),
        moraleChange: moraleFromEvents,
        healthFraction: c ? healthFraction(c) : 1,
      } satisfies HunterAftermath;
    });

    const totalXp = reports.reduce((sum, r) => sum + r.xp, 0);
    // An event that ends the run ends it *successfully*. Running out of daylight is neither a
    // completion nor a retreat by choice, so it gets its own flag. An endless run counts as
    // completed once a full route is behind the party and they came home.
    const completed = endless
      ? depthsCleared >= 1 && !wiped
      : endedByEvent || (!retreated && !wiped && !outOfTime && state.cursor >= walk.length);

    return {
      regionId: region.id,
      objective: party.objective,
      nodes: reports,
      reachedNode: reached,
      nodesEntered: entered,
      routeLength: walk.length,
      completed,
      retreated: retreated || outOfTime,
      wiped,
      bossDefeated,
      totalXp,
      lootRolls: lootRolls + extraLoot + (completed ? Math.round(tier.lootBonus * 2) : 0),
      aftermath,
      events,
      elapsedSeconds: Math.round(elapsedSeconds),
      outOfTime,
      reputation,
      // REQ-WLD-001: what the guild learned, whatever the outcome. A party wiped at the first
      // node still learned that the first node is there.
      learned: {
        nodeKinds: [...new Set(reports.map((r) => r.node.kind))].sort(),
        monsters: [...new Set(reports.flatMap((r) => r.node.monsters))].sort(),
        deepestNode: reached,
      },
      decisions,
      summary:
        this.summarise(region, party.objective, reached, walk.length, {
          completed,
          retreated,
          wiped,
          bossDefeated,
          outOfTime,
          endedByEvent,
        }) + (endless ? ` Deepest depth reached: ${depth + 1}; routes cleared: ${depthsCleared}.` : ''),
      ...(endless ? { endless: { depthsCleared, deepestDepth: depth + 1 } } : {}),
    };
  }

  // -------------------------------------------------------------------------

  private fight(
    rng: Rng,
    node: RouteNode,
    combatants: Map<HunterId, Combatant>,
    region: RegionDef,
    objective: ObjectiveDef,
    ambushed = false,
    endless?: EndlessRunConfig,
    worldBossId?: string,
  ): EncounterResult {
    const guild = [...combatants.values()].filter((c) => !c.dead);
    for (const c of guild) {
      // Threat, cooldowns and statuses do not carry between fights; health does.
      c.threat.clear();
      c.statuses.length = 0;
      c.cooldowns.clear();
      c.targetId = undefined;
      c.aiCooldown = 0;
      c.rescuingId = undefined;
      c.rescueProgress = 0;
      c.secondsSinceAttacked = 999;
      // An ambush starts the party scattered and already in reach, which is what makes
      // "wade straight across" cost something a fight from a standing start does not.
      c.position = ambushed ? this.deps.balance.movement.startingSeparation * 0.6 : 0;
    }

    const depth = node.depth ?? 0;
    const monsters = node.monsters
      .map((id, index) => {
        const base = this.deps.monsterOf(id);
        const def = base && endless && depth > 0 ? scaleMonster(base, depth, endless.statsPerDepth) : base;
        return def
          ? this.deps.monsterCombatant(
              def,
              index,
              this.deps.balance.movement.startingSeparation + index * 0.5,
            )
          : undefined;
      })
      .filter((c): c is Combatant => c !== undefined);

    const encounter = new CombatEncounter(
      {
        balance: this.deps.balance,
        ai: this.deps.ai,
        skillOf: this.deps.skillOf,
        statusOf: this.deps.statusOf,
        monsterOf: this.deps.monsterOf,
        constraints: this.deps.constraints,
        emergency: this.deps.emergency,
        environment: {
          zoneTier: region.zoneTier,
          lethal: this.deps.world.zoneTiers[region.zoneTier].canKill,
          canInjure: this.deps.world.zoneTiers[region.zoneTier].canInjure,
        },
        objective: { id: objective.id, riskPreference: objective.riskPreference },
        ...(worldBossId !== undefined ? { worldBossId } : {}),
        ...(this.deps.outgoingMultiplier ? { outgoingMultiplier: this.deps.outgoingMultiplier } : {}),
        ...(this.deps.chronicle ? { events: this.deps.chronicle } : {}),
      },
      guild,
      monsters,
    );

    return encounter.run(rng);
  }

  /**
   * Continue or retreat.
   *
   * The rule the player can state back to you: *the party turns back when its condition has
   * fallen below what the objective is willing to spend.* A survival objective retreats at
   * three-quarters health; a boss kill will walk in at a third. Everything else is detail.
   */
  private decideAtNode(
    node: RouteNode,
    party: readonly Combatant[],
    objective: ObjectiveDef,
    tier: ZoneTierDef,
  ): ExpeditionDecision {
    const living = party.filter((c) => !c.dead);
    const health = partyHealthFraction(party);
    const codes: string[] = [`node:${node.kind}`];

    // The player's standing orders outrank the Guild AI's judgement (§29, REQ-POL-004) —
    // including here, at the route level. Checked before anything else so that a threshold,
    // a condition or an objective cannot talk its way past an explicit instruction.
    const orders = this.deps.routeOrders?.() ?? { mustPressOn: false, mustTurnBack: false };
    if (orders.mustTurnBack) {
      return {
        atNode: node.index,
        choice: 'retreat',
        explanation: 'Standing orders require an immediate withdrawal.',
        reasonCodes: [...codes, REASON.hardConstraintVeto, 'order:must_retreat'],
      };
    }
    if (orders.mustPressOn && node.index > 0) {
      return {
        atNode: node.index,
        choice: node.kind === 'boss' ? 'commit' : 'continue',
        explanation:
          `Standing orders forbid turning back. The party presses on at ` +
          `${percent(health)} strength.`,
        reasonCodes: [...codes, REASON.hardConstraintVeto, 'order:never_retreat'],
      };
    }

    if (node.index === 0) {
      return {
        atNode: node.index,
        choice: 'continue',
        explanation: 'The party sets out.',
        reasonCodes: [...codes, 'route_start'],
      };
    }

    // Losses weigh more heavily than damage, and more heavily still where death is possible.
    const lost = party.length - living.length;
    const lossPenalty = (lost / Math.max(1, party.length)) * (tier.canKill ? 0.6 : 0.3);
    const condition = Math.max(0, health - lossPenalty);

    // What the objective will spend. High risk preference tolerates a worse condition.
    const threshold = 0.75 - objective.riskPreference * 0.45;

    if (lost > 0) codes.push('casualties');
    if (tier.canKill) codes.push('lethal_zone');

    if (condition < threshold) {
      return {
        atNode: node.index,
        choice: 'retreat',
        explanation:
          `The party is at ${percent(condition)} strength; "${objective.name}" turns back below ` +
          `${percent(threshold)}${lost > 0 ? `, and ${lost} did not get up` : ''}.`,
        reasonCodes: [...codes, REASON.retreatThresholdReached, `condition:${percent(condition)}`],
      };
    }

    if (node.kind === 'boss') {
      return {
        atNode: node.index,
        choice: 'commit',
        explanation:
          `The party commits to ${node.label} at ${percent(condition)} strength — above the ` +
          `${percent(threshold)} the objective demands.`,
        reasonCodes: [...codes, 'boss_committed', `condition:${percent(condition)}`],
      };
    }

    return {
      atNode: node.index,
      choice: 'continue',
      explanation: `The party presses on at ${percent(condition)} strength.`,
      reasonCodes: [...codes, `condition:${percent(condition)}`],
    };
  }

  /**
   * Decide an event (REQ-EXP-002).
   *
   * The Guild AI chooses, not the player — that is the whole premise (§1). What the player
   * controls is the objective and the policy, and both are inputs here. The choice is
   * audited with the option's own authored consequence text, so the route report can say
   * *"the party forced the cache open, at the cost of a noisy delay"* rather than reporting
   * a number the player has to interpret.
   */
  private resolveEvent(
    rng: Rng,
    node: RouteNode,
    party: readonly Combatant[],
    objective: ObjectiveDef,
  ):
    | { event: EventDef; option: EventOptionDef; decision: ExpeditionDecision }
    | undefined {
    const event = this.deps.events?.find((e) => e.id === node.monsters[0]);
    if (!event) return undefined;

    const health = partyHealthFraction(party);

    // A hurt party is less willing to gamble than the objective alone would suggest —
    // the objective says what the guild wants, condition says what it can afford.
    const appetite = objective.riskPreference * (0.4 + 0.6 * health);

    const scored = event.options
      .map((option) => ({
        option,
        // Closest match between the option's risk and what the party will currently accept.
        // Ties break on option id so a run replays identically (v1.0 §18).
        distance: Math.abs(option.risk - appetite),
      }))
      .sort((a, b) => a.distance - b.distance || a.option.id.localeCompare(b.option.id));

    const chosen = scored[0]?.option;
    if (!chosen) return undefined;

    // One draw from the stream even though the choice is deterministic, so that adding or
    // removing an event cannot silently shift every later draw in the run.
    rng.next();

    return {
      event,
      option: chosen,
      decision: {
        atNode: node.index,
        choice: 'continue',
        explanation:
          `${event.name}: the party chose to ${chosen.label.toLowerCase()}. ${chosen.consequence}`,
        reasonCodes: [
          'node:event',
          `event:${event.id}`,
          `option:${chosen.id}`,
          `risk_appetite:${percent(appetite)}`,
        ],
      },
    };
  }

  /** An event that can actually happen here — right zone tier, right hazards. */
  private pickEvent(rng: Rng, region: RegionDef): EventDef | undefined {
    const eligible = (this.deps.events ?? []).filter(
      (e) =>
        e.zoneTiers.includes(region.zoneTier) &&
        (e.hazards.length === 0 || e.hazards.some((h) => region.hazards.includes(h))),
    );
    if (eligible.length === 0) return undefined;

    const total = eligible.reduce((sum, e) => sum + e.weight, 0);
    let roll = rng.range(0, total);
    for (const event of eligible) {
      roll -= event.weight;
      if (roll <= 0) return event;
    }
    return eligible[0];
  }

  /** Extra route nodes for a detour. Drawn from the region's own pool, so it is a real one. */
  private extraNodes(
    rng: Rng,
    region: RegionDef,
    count: number,
    startIndex: number,
  ): readonly RouteNode[] {
    const nodes: RouteNode[] = [];
    for (let i = 0; i < count; i++) {
      const encounter = weightedPickEncounter(rng, region);
      const monsterCount = rng.int(encounter.count.min, encounter.count.max + 1);
      const monsters: string[] = [];
      for (let m = 0; m < monsterCount; m++) {
        monsters.push(encounter.monsters[m % encounter.monsters.length] ?? '');
      }
      nodes.push({
        index: startIndex + i,
        kind: 'combat',
        monsters: monsters.filter((id) => id !== ''),
        label: `${this.describeGroup(monsters)}, on the long way round`,
      });
    }
    return nodes;
  }

  private describeGroup(monsters: readonly string[]): string {
    const counts = new Map<string, number>();
    for (const id of monsters) counts.set(id, (counts.get(id) ?? 0) + 1);
    return (
      [...counts.entries()]
        .map(([id, n]) => `${n}× ${this.deps.monsterOf(id)?.name ?? id}`)
        .join(' and ') || 'An empty clearing'
    );
  }

  private summarise(
    region: RegionDef,
    objective: ObjectiveDef,
    reached: number,
    length: number,
    flags: {
      completed: boolean;
      retreated: boolean;
      wiped: boolean;
      bossDefeated: boolean;
      outOfTime: boolean;
      endedByEvent: boolean;
    },
  ): string {
    const where = `${region.name}, ${reached}/${length} of the route`;
    if (flags.wiped) return `The party was broken in ${where}.`;
    if (flags.endedByEvent) return `The party came home early from ${region.name}, and not empty-handed.`;
    if (flags.outOfTime) return `The light went in ${where}, and the party turned for home.`;
    if (flags.retreated) {
      // Reaching the end of the route and *then* breaking off is a different story from
      // turning back partway, and "turned back, 4/4 of the route" reads as a contradiction.
      return reached >= length
        ? `The party broke off from the last fight in ${region.name} and came home.`
        : `The party turned back in ${where}, short of "${objective.name}".`;
    }
    if (flags.bossDefeated) return `The party cleared ${region.name} and took the warden with it.`;
    if (flags.completed) return `The party walked ${region.name} end to end and came home.`;
    return `The party returned from ${where}.`;
  }
}

// ---------------------------------------------------------------------------

/** A monster as it stands at a given endless depth: every scaled stat grows linearly. */
function scaleMonster(def: MonsterDef, depth: number, perDepth: Readonly<Record<string, number>>): MonsterDef {
  const stats: Record<string, number> = { ...def.stats };
  for (const [stat, growth] of Object.entries(perDepth)) {
    const value = stats[stat];
    if (value !== undefined) stats[stat] = value * (1 + growth * depth);
  }
  return { ...def, stats };
}

function partyHealthFraction(party: readonly Combatant[]): number {
  const total = party.reduce((sum, c) => sum + c.maxHealth, 0);
  if (total === 0) return 0;
  return party.reduce((sum, c) => sum + Math.max(0, c.health), 0) / total;
}

/** The slice of a combatant's state that carries between nodes (DL-074). */
function sliceOf(c: Combatant, id: HunterId): RunCombatantState {
  return {
    hunterId: id,
    health: c.health,
    resource: c.resource,
    dead: c.dead,
    downed: c.downed,
    downedRemaining: c.downedRemaining,
  };
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function weightedPick(rng: Rng, entries: readonly [string, { weight: number }][]): string {
  const total = entries.reduce((sum, [, def]) => sum + def.weight, 0);
  let roll = rng.range(0, total);
  for (const [name, def] of entries) {
    roll -= def.weight;
    if (roll <= 0) return name;
  }
  return entries[0]?.[0] ?? 'combat';
}

function weightedPickEncounter(rng: Rng, region: RegionDef): RegionDef['encounters'][number] {
  const total = region.encounters.reduce((sum, e) => sum + e.weight, 0);
  let roll = rng.range(0, total);
  for (const encounter of region.encounters) {
    roll -= encounter.weight;
    if (roll <= 0) return encounter;
  }
  const first = region.encounters[0];
  if (!first) throw new Error(`Expedition: region "${region.id}" has no encounters`);
  return first;
}
