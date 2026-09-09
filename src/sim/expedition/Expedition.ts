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

import type { MonsterDef, RegionDef, WorldData, ZoneTierDef } from '../../data/combatSchema.js';
import type { CombatBalance, StatusDef } from '../../data/combatSchema.js';
import type { SkillDef } from '../../data/schema.js';
import type { Rng } from '../../core/rng.js';
import type { HunterId } from '../../core/ids.js';
import type { Combatant } from '../../core/combat/Combatant.js';
import { healthFraction } from '../../core/combat/Combatant.js';
import { REASON } from '../../core/audit.js';
import {
  CombatEncounter,
  type CombatEventSink,
  type CombatLogEntry,
  type EncounterResult,
} from '../combat/CombatEncounter.js';
import type { HunterAI } from '../../ai/hunter/hunterAI.js';
import type { CombatAction, CombatView } from '../../ai/hunter/hunterAI.js';
import type { HardConstraint } from '../../ai/policy/pipeline.js';
import type { EmergencyPolicy } from '../../ai/policy/emergency.js';
import type { RouteOrders } from '../../ai/policy/orders.js';
import type { ObjectiveDef, PartyProposal } from '../../systems/party/Party.js';

export type NodeKind = 'combat' | 'rest' | 'discovery' | 'boss';

export interface RouteNode {
  readonly index: number;
  readonly kind: NodeKind;
  /** Monster ids and counts, for combat and boss nodes. */
  readonly monsters: readonly string[];
  readonly label: string;
}

export interface NodeReport {
  readonly node: RouteNode;
  readonly outcome: 'cleared' | 'wiped' | 'withdrew' | 'timeout' | 'rested' | 'found' | 'skipped';
  readonly xp: number;
  readonly highlights: readonly CombatLogEntry[];
  readonly encounterSeconds: number;
  /** Party health fraction on leaving the node. */
  readonly partyHealth: number;
}

export interface HunterAftermath {
  readonly hunterId: HunterId;
  readonly survived: boolean;
  readonly downedCount: number;
  readonly died: boolean;
  readonly injured: boolean;
  readonly xp: number;
  readonly fatigueAdded: number;
  readonly healthFraction: number;
}

export interface ExpeditionResult {
  readonly regionId: string;
  readonly objective: ObjectiveDef;
  readonly nodes: readonly NodeReport[];
  readonly reachedNode: number;
  readonly routeLength: number;
  readonly completed: boolean;
  readonly retreated: boolean;
  readonly wiped: boolean;
  readonly bossDefeated: boolean;
  readonly totalXp: number;
  readonly lootRolls: number;
  readonly aftermath: readonly HunterAftermath[];
  /** The Guild AI's own account of the run, in order (v1.0 §14/§18). */
  readonly decisions: readonly ExpeditionDecision[];
  readonly summary: string;
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
  readonly events?: CombatEventSink;
  /** Route-level force of the player's standing orders (§29). */
  readonly routeOrders?: () => RouteOrders;
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
      ([name]) => name === 'combat' || name === 'rest' || name === 'discovery',
    );

    const nodes: RouteNode[] = [];
    for (let i = 0; i < length; i++) {
      // The first node is always combat: a route that opens on a rest node reads as the
      // expedition not having started.
      const kind = i === 0 ? 'combat' : (weightedPick(rng, kinds) as NodeKind);

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
  run(rng: Rng, region: RegionDef, party: PartyProposal): ExpeditionResult {
    const tier = this.deps.world.zoneTiers[region.zoneTier];
    const nodes = this.route(rng, region);
    const reports: NodeReport[] = [];
    const decisions: ExpeditionDecision[] = [];

    const combatants = new Map<HunterId, Combatant>();
    for (const member of party.members) {
      combatants.set(member.hunterId, this.deps.combatantFor(member.hunterId));
    }

    const downedCounts = new Map<HunterId, number>();
    const xpEarned = new Map<HunterId, number>();
    let lootRolls = 0;
    let retreated = false;
    let wiped = false;
    let bossDefeated = false;
    let reached = 0;

    for (const node of nodes) {
      const living = [...combatants.values()].filter((c) => !c.dead);
      if (living.length === 0) {
        wiped = true;
        break;
      }

      // Decide before entering, not after — the party turns back at the edge of a fight,
      // which is the only point at which turning back saves anyone.
      const decision = this.decideAtNode(node, [...combatants.values()], party.objective, tier);
      decisions.push(decision);
      if (decision.choice === 'retreat') {
        retreated = true;
        reports.push({
          node,
          outcome: 'skipped',
          xp: 0,
          highlights: [],
          encounterSeconds: 0,
          partyHealth: partyHealthFraction([...combatants.values()]),
        });
        break;
      }

      reached = node.index + 1;

      if (node.kind === 'rest') {
        const relief = this.deps.world.nodeKinds['rest']?.['fatigueRelief'] ?? 0.1;
        for (const c of combatants.values()) {
          if (c.dead) continue;
          c.health = Math.min(c.maxHealth, c.health + Math.round(c.maxHealth * relief * 2));
          c.resource = c.maxResource;
        }
        reports.push({
          node,
          outcome: 'rested',
          xp: 0,
          highlights: [],
          encounterSeconds: 0,
          partyHealth: partyHealthFraction([...combatants.values()]),
        });
        continue;
      }

      if (node.kind === 'discovery') {
        lootRolls += this.deps.world.nodeKinds['discovery']?.['lootRolls'] ?? 1;
        reports.push({
          node,
          outcome: 'found',
          xp: 0,
          highlights: [],
          encounterSeconds: 0,
          partyHealth: partyHealthFraction([...combatants.values()]),
        });
        continue;
      }

      const result = this.fight(rng, node, combatants, region, party.objective);

      for (const c of combatants.values()) {
        if (c.downed) downedCounts.set(c.hunterId as HunterId, (downedCounts.get(c.hunterId as HunterId) ?? 0) + 1);
      }

      // XP is split across everyone who was still standing when the fight started; a hunter
      // who went down still learns from it, one who was already dead does not.
      const share = living.length > 0 ? Math.round(result.xp / living.length) : 0;
      for (const c of living) {
        const id = c.hunterId;
        if (id) xpEarned.set(id, (xpEarned.get(id) ?? 0) + share);
      }

      reports.push({
        node,
        outcome: NODE_OUTCOME[result.outcome],
        xp: result.xp,
        highlights: result.log.filter((e) => e.highlight),
        encounterSeconds: Math.round(result.elapsedSeconds * 10) / 10,
        partyHealth: partyHealthFraction([...combatants.values()]),
      });

      if (result.outcome === 'victory') {
        lootRolls += node.kind === 'boss' ? 3 : 1;
        if (node.kind === 'boss') bossDefeated = true;
        // Survivors of a won fight get back up; the run continues with them wounded.
        for (const c of combatants.values()) {
          if (c.downed && !c.dead) {
            c.downed = false;
            c.health = Math.max(1, Math.round(c.maxHealth * this.deps.balance.downed.reviveHealthFraction));
          }
        }
      } else if (result.outcome === 'defeat') {
        wiped = true;
        break;
      } else {
        // Withdrawal or stalemate. The party is alive and the route is over — treating
        // either as a wipe would kill hunters who broke off precisely to avoid dying,
        // which inverts the meaning of the decision they just made.
        retreated = true;
        break;
      }
    }

    const aftermath = party.members.map((member) => {
      const c = combatants.get(member.hunterId);
      const nodeCount = Math.max(1, reached);

      // A hunter left down when the party was broken is lost, and so is one whose downed
      // timer ran out mid-fight. The first case matters more than it looks: an encounter
      // ends the moment the last hunter falls, so nobody's timer *can* expire in a wipe —
      // relying on it alone would mean no hunter ever died, anywhere.
      const lost = (c?.dead ?? false) || (wiped && (c?.downed ?? false));

      // REQ-ZON-001: what a zone is *allowed* to do to a hunter is the zone's property, not
      // the encounter's. A hunter lost in a BLUE zone comes home tired instead.
      const died = lost && tier.canKill;
      const injured = !died && (lost || (c?.downed ?? false)) && tier.canInjure;

      return {
        hunterId: member.hunterId,
        survived: !died,
        downedCount: downedCounts.get(member.hunterId) ?? 0,
        died,
        injured,
        xp: xpEarned.get(member.hunterId) ?? 0,
        fatigueAdded: Math.min(1, nodeCount * FATIGUE_PER_NODE * (wiped ? 1.5 : 1)),
        healthFraction: c ? healthFraction(c) : 1,
      } satisfies HunterAftermath;
    });

    const totalXp = reports.reduce((sum, r) => sum + r.xp, 0);
    const completed = !retreated && !wiped && reached >= nodes.length;

    return {
      regionId: region.id,
      objective: party.objective,
      nodes: reports,
      reachedNode: reached,
      routeLength: nodes.length,
      completed,
      retreated,
      wiped,
      bossDefeated,
      totalXp,
      lootRolls: lootRolls + (completed ? Math.round(tier.lootBonus * 2) : 0),
      aftermath,
      decisions,
      summary: this.summarise(region, party.objective, reached, nodes.length, {
        completed,
        retreated,
        wiped,
        bossDefeated,
      }),
    };
  }

  // -------------------------------------------------------------------------

  private fight(
    rng: Rng,
    node: RouteNode,
    combatants: Map<HunterId, Combatant>,
    region: RegionDef,
    objective: ObjectiveDef,
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
      c.position = 0;
    }

    const monsters = node.monsters
      .map((id, index) => {
        const def = this.deps.monsterOf(id);
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
        ...(this.deps.events ? { events: this.deps.events } : {}),
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
    flags: { completed: boolean; retreated: boolean; wiped: boolean; bossDefeated: boolean },
  ): string {
    const where = `${region.name}, ${reached}/${length} of the route`;
    if (flags.wiped) return `The party was broken in ${where}.`;
    if (flags.retreated) return `The party turned back in ${where}, short of "${objective.name}".`;
    if (flags.bossDefeated) return `The party cleared ${region.name} and took the warden with it.`;
    if (flags.completed) return `The party walked ${region.name} end to end and came home.`;
    return `The party returned from ${where}.`;
  }
}

// ---------------------------------------------------------------------------

function partyHealthFraction(party: readonly Combatant[]): number {
  const total = party.reduce((sum, c) => sum + c.maxHealth, 0);
  if (total === 0) return 0;
  return party.reduce((sum, c) => sum + Math.max(0, c.health), 0) / total;
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
