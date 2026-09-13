/**
 * Journeys — expeditions that take time in the world (CONTINUOUS_WORLD_ARCHITECTURE.md
 * §Migration; DL-070, DL-074).
 *
 * A journey is a party out in the world: travelling out, working through the nodes of its route,
 * and travelling home, on the simulation clock. It is state the simulation owns and the save
 * keeps, so a journey survives a reload and runs the same way offline as live (REQ-OFF-002).
 *
 * Step 2 (DL-074): the route is no longer resolved in full at the gate. The party carries a
 * resumable `ExpeditionRunState` and resolves each stop as it reaches it, against the guild as it
 * is at that tick. Because the number of stops it works is only known as it works them, the return
 * time is *emergent*: `turnsHomeAtTick` and `returnsAtTick` are set the moment the party turns for
 * home, not at departure. `arrivesAtTick` is fixed at the gate. Nothing here reads a wall clock.
 */

import type { ZoneTier } from '../../data/combatSchema.js';
import type { JourneyBalance } from '../../data/journeySchema.js';
import type { HunterId } from '../../core/ids.js';
import type { ExpeditionResult, ExpeditionRunState, NodeReport } from './Expedition.js';
import type { PartyProposal } from '../../systems/party/Party.js';
import type { WorldBossEvent } from '../../systems/world/WorldEvents.js';

export type JourneyPhase = 'outbound' | 'working' | 'inbound' | 'home';

export interface JourneyRecord {
  readonly id: string;
  readonly regionId: string;
  readonly hunterIds: readonly HunterId[];
  readonly departedAtTick: number;
  /** Tick the party reaches the first node and begins working the route. Fixed at the gate. */
  readonly arrivesAtTick: number;
  /**
   * The resumable run: the route as walked so far, the party's carried state, and every
   * accumulator. Resolved a stop at a time by `Expedition.stepNode` (DL-074). Absent only for a
   * journey migrated from a v27 save, which carries a `legacyResult` instead.
   */
  readonly run?: ExpeditionRunState;
  /**
   * A v27 in-flight journey resolved its whole route at the gate. On migration its finished result
   * is kept here and applied on return unchanged, so no old save's outcome changes.
   */
  readonly legacyResult?: ExpeditionResult;
  /** Tick the party turns for home — set when the route ends (emergent). Undefined while working. */
  readonly turnsHomeAtTick?: number;
  /** Tick the party walks back through the gate and its consequences land. Emergent, as above. */
  readonly returnsAtTick?: number;
  /** The party as it left: who went, in what formation, for what objective. */
  readonly proposal: PartyProposal;
  /** Set when the journey was sent at a world boss, so its defeat is recorded on return. */
  readonly worldBoss?: WorldBossEvent;
  /** Tick the guild ordered the party home (REQ-CW-010), when it did. */
  readonly recalledAtTick?: number;
}

export interface JourneysSnapshot {
  readonly next: number;
  readonly active: readonly JourneyRecord[];
}

/**
 * A node report stripped of its presentation-only replay data (DL-072). The combat `facts`, the
 * `story` and the per-fight `highlights` are read only by the route-replay UI and never feed back
 * into the rules, so an in-flight journey does not carry them in the save — they are the bulk of a
 * stored run. A journey interrupted by a save/reload still lands its exact consequences on return;
 * only the blow-by-blow of its replay is thinned to the per-node outcome.
 */
function slimNodeForSave(report: NodeReport): NodeReport {
  return {
    node: report.node,
    outcome: report.outcome,
    xp: report.xp,
    highlights: [],
    encounterSeconds: report.encounterSeconds,
    partyHealth: report.partyHealth,
  };
}

function slimRunForSave(run: ExpeditionRunState): ExpeditionRunState {
  return { ...run, reports: run.reports.map(slimNodeForSave) };
}

function slimResultForSave(result: ExpeditionResult): ExpeditionResult {
  return { ...result, nodes: result.nodes.map(slimNodeForSave) };
}

/** Travel time to a region, each way, in clock ticks. Riskier regions lie further from the gate. */
export function travelTicks(zoneTier: ZoneTier, balance: JourneyBalance, ticksPerStep: number): number {
  return balance.travelSteps[zoneTier] * ticksPerStep;
}

/** How long the party spends working one node, in clock ticks. */
export function perNodeTicks(balance: JourneyBalance, ticksPerStep: number): number {
  return balance.stepsPerNode * ticksPerStep;
}

/** The tick a party reaches its first node, fixed at departure. */
export function arrivalTick(departedAtTick: number, zoneTier: ZoneTier, balance: JourneyBalance, ticksPerStep: number): number {
  return departedAtTick + travelTicks(zoneTier, balance, ticksPerStep);
}

/**
 * The turn-home and return ticks for a party that has worked `nodesWorked` nodes and is turning
 * for home from its route. Computed from `arrivesAtTick` and the count — never from the tick the
 * turn was *detected* — so a party comes home on the same step offline as live (REQ-OFF-002).
 */
export function turnHomeFromRoute(arrivesAtTick: number, nodesWorked: number, travel: number, perNode: number): {
  turnsHomeAtTick: number;
  returnsAtTick: number;
} {
  const turnsHomeAtTick = arrivesAtTick + Math.max(1, nodesWorked) * perNode;
  return { turnsHomeAtTick, returnsAtTick: turnsHomeAtTick + travel };
}

/**
 * The turn-home and return ticks for a party recalled while still walking out, before it reached
 * a node (REQ-CW-010). It turns round where it stands and walks back the ground it covered.
 */
export function turnHomeWalkingOut(departedAtTick: number, tick: number): {
  turnsHomeAtTick: number;
  returnsAtTick: number;
} {
  return { turnsHomeAtTick: tick, returnsAtTick: tick + Math.max(0, tick - departedAtTick) };
}

/** The nodes a journey has worked so far — from its live run, or the migrated legacy result. */
export function nodesWorkedSoFar(journey: JourneyRecord): number {
  return journey.run ? journey.run.entered : (journey.legacyResult?.nodesEntered ?? 0);
}

/**
 * Where a journey is at a given tick — for presentation; the rules only care about `returnsAtTick`.
 * While the party is still working, the return time is not yet known, so the node counts *up* (the
 * stops it has worked) rather than down; the countdown appears once it has turned for home (DL-074).
 */
export function phaseAt(journey: JourneyRecord, tick: number): { phase: JourneyPhase; node: number } {
  const worked = nodesWorkedSoFar(journey);
  if (journey.returnsAtTick !== undefined && tick >= journey.returnsAtTick) return { phase: 'home', node: worked };
  if (journey.turnsHomeAtTick !== undefined && tick >= journey.turnsHomeAtTick) return { phase: 'inbound', node: worked };
  if (tick < journey.arrivesAtTick) return { phase: 'outbound', node: 0 };
  // Working: a stop resolves the moment the party reaches it (DL-074), so the count worked is the
  // stop it is on.
  return { phase: 'working', node: worked };
}

export class Journeys {
  private active: JourneyRecord[] = [];
  private next = 1;

  /** Record a departure. The id is stable across saves and never reused. */
  depart(record: Omit<JourneyRecord, 'id'>): JourneyRecord {
    const journey: JourneyRecord = { ...record, id: `journey-${this.next++}` };
    this.active.push(journey);
    return journey;
  }

  all(): readonly JourneyRecord[] {
    return this.active;
  }

  get(id: string): JourneyRecord | undefined {
    return this.active.find((j) => j.id === id);
  }

  /** Swap a journey for its revised record — stepping a stop or a recall changes its run and times. */
  revise(journey: JourneyRecord): void {
    this.active = this.active.map((j) => (j.id === journey.id ? journey : j));
  }

  /** Whether a hunter is out on a journey right now. */
  isAway(hunterId: HunterId): boolean {
    return this.active.some((j) => j.hunterIds.includes(hunterId));
  }

  /**
   * The soonest tick at which any active journey needs attention, so `passTime` can split its
   * chunk exactly there and never step past a node boundary — which is what keeps each stop
   * resolving against the same guild state offline as live (REQ-OFF-002, DL-074). A journey that
   * has turned for home needs attention at its return; one still working needs it at its next
   * node completion.
   */
  nextEventTick(perNode: number): number | undefined {
    return this.active.reduce<number | undefined>((soonest, j) => {
      // A stop resolves when the party reaches it, at `arrives + workedSoFar * perNode` (DL-074).
      const at = j.returnsAtTick !== undefined ? j.returnsAtTick : j.arrivesAtTick + nodesWorkedSoFar(j) * perNode;
      return soonest === undefined || at < soonest ? at : soonest;
    }, undefined);
  }

  /**
   * Remove and return every journey that is home by `tick`, oldest departure first, so two
   * parties coming back on the same step apply in the order they left.
   */
  takeReturned(tick: number): JourneyRecord[] {
    const home = (j: JourneyRecord): boolean => j.returnsAtTick !== undefined && j.returnsAtTick <= tick;
    const back = this.active.filter(home).sort((a, b) => (a.returnsAtTick ?? 0) - (b.returnsAtTick ?? 0) || a.departedAtTick - b.departedAtTick || a.id.localeCompare(b.id));
    this.active = this.active.filter((j) => !home(j));
    return back;
  }

  snapshot(): JourneysSnapshot {
    // The live records keep their full combat facts for a same-session route replay; only the
    // saved copy is slimmed, so a reload does not carry every fight's blow-by-blow (DL-072).
    return {
      next: this.next,
      active: this.active.map((j) => ({
        ...j,
        ...(j.run ? { run: slimRunForSave(j.run) } : {}),
        ...(j.legacyResult ? { legacyResult: slimResultForSave(j.legacyResult) } : {}),
      })),
    };
  }

  restore(snapshot: JourneysSnapshot | undefined): void {
    this.active = [...(snapshot?.active ?? [])];
    this.next = snapshot?.next ?? 1;
  }
}
