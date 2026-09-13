/**
 * Journeys — expeditions that take time in the world (CONTINUOUS_WORLD_ARCHITECTURE.md
 * §Migration, step 1; DL-070).
 *
 * A journey is a party out in the world: travelling out, working through the nodes of its route,
 * and travelling home, on the simulation clock. It is state the simulation owns and the save
 * keeps, so a journey survives a reload and runs the same way offline as live (REQ-OFF-002).
 *
 * The rules engine is unchanged. The route is resolved at departure by the same deterministic
 * `Expedition.run` the instant path uses, from the same seeded fork, so a journey's outcome is
 * exactly the outcome the instant path would have produced. What changes is *when* it lands: the
 * consequences are applied on the step the party walks back through the gate, not the step it
 * left. Nothing here reads a wall clock.
 */

import type { ZoneTier } from '../../data/combatSchema.js';
import type { JourneyBalance } from '../../data/journeySchema.js';
import type { HunterId } from '../../core/ids.js';
import type { ExpeditionResult } from './Expedition.js';
import type { PartyProposal } from '../../systems/party/Party.js';
import type { WorldBossEvent } from '../../systems/world/WorldEvents.js';

export type JourneyPhase = 'outbound' | 'working' | 'inbound' | 'home';

export interface JourneyRecord {
  readonly id: string;
  readonly regionId: string;
  readonly hunterIds: readonly HunterId[];
  readonly departedAtTick: number;
  /** Tick the party reaches the first node. */
  readonly arrivesAtTick: number;
  /** Tick the party leaves the last node it reached and turns for home. */
  readonly turnsHomeAtTick: number;
  /** Tick the party walks back through the gate and its consequences land. */
  readonly returnsAtTick: number;
  /** The resolved route, from the deterministic rules engine at departure. */
  readonly result: ExpeditionResult;
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
 * The timetable for a resolved route, in clock ticks. The party spends `stepsPerNode` at each node
 * it actually worked — a retreat or a wipe ends the route early, and the walk home starts from
 * there. Balance is authored in town steps; a step is `ticksPerStep` clock ticks (the clock's
 * coarse step ratio), so this converts rather than adding steps to ticks.
 */
export function timetable(departedAtTick: number, zoneTier: ZoneTier, nodesWorked: number, balance: JourneyBalance, ticksPerStep: number): {
  arrivesAtTick: number;
  turnsHomeAtTick: number;
  returnsAtTick: number;
} {
  const travel = balance.travelSteps[zoneTier] * ticksPerStep;
  const arrivesAtTick = departedAtTick + travel;
  const turnsHomeAtTick = arrivesAtTick + Math.max(1, nodesWorked) * balance.stepsPerNode * ticksPerStep;
  return { arrivesAtTick, turnsHomeAtTick, returnsAtTick: turnsHomeAtTick + travel };
}

/** Where a journey is at a given tick — for presentation; the rules only care about `returnsAtTick`. */
export function phaseAt(journey: JourneyRecord, tick: number): { phase: JourneyPhase; node: number } {
  const worked = journey.result.nodesEntered;
  if (tick >= journey.returnsAtTick) return { phase: 'home', node: worked };
  if (tick >= journey.turnsHomeAtTick) return { phase: 'inbound', node: worked };
  if (tick < journey.arrivesAtTick) return { phase: 'outbound', node: 0 };
  const perNode = Math.max(1, (journey.turnsHomeAtTick - journey.arrivesAtTick) / Math.max(1, worked));
  return { phase: 'working', node: Math.min(worked, 1 + Math.floor((tick - journey.arrivesAtTick) / perNode)) };
}

/**
 * The timetable after a recall at `tick` (REQ-CW-010). A party still walking out turns round
 * where it stands and walks back the ground it covered; a party at a node finishes that node and
 * then walks the whole way home. `nodesWorked` is the recalled route's count, from the re-run.
 */
export function recallTimetable(journey: JourneyRecord, tick: number, nodesWorked: number, perNodeTicks: number): {
  arrivesAtTick: number;
  turnsHomeAtTick: number;
  returnsAtTick: number;
} {
  const travel = journey.arrivesAtTick - journey.departedAtTick;
  if (tick < journey.arrivesAtTick) {
    return { arrivesAtTick: tick, turnsHomeAtTick: tick, returnsAtTick: tick + Math.max(0, tick - journey.departedAtTick) };
  }
  const turnsHomeAtTick = journey.arrivesAtTick + Math.max(1, nodesWorked) * perNodeTicks;
  return { arrivesAtTick: journey.arrivesAtTick, turnsHomeAtTick, returnsAtTick: turnsHomeAtTick + travel };
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

  /** Swap a journey for its revised record — a recall changes the route's end and the timetable. */
  revise(journey: JourneyRecord): void {
    this.active = this.active.map((j) => (j.id === journey.id ? journey : j));
  }

  /** Whether a hunter is out on a journey right now. */
  isAway(hunterId: HunterId): boolean {
    return this.active.some((j) => j.hunterIds.includes(hunterId));
  }

  /** The soonest return still ahead, so time can be split exactly at it. */
  nextReturnTick(): number | undefined {
    return this.active.reduce<number | undefined>((soonest, j) => (soonest === undefined || j.returnsAtTick < soonest ? j.returnsAtTick : soonest), undefined);
  }

  /**
   * Remove and return every journey that is home by `tick`, oldest departure first, so two
   * parties coming back on the same step apply in the order they left.
   */
  takeReturned(tick: number): JourneyRecord[] {
    const back = this.active.filter((j) => j.returnsAtTick <= tick).sort((a, b) => a.returnsAtTick - b.returnsAtTick || a.departedAtTick - b.departedAtTick || a.id.localeCompare(b.id));
    this.active = this.active.filter((j) => j.returnsAtTick > tick);
    return back;
  }

  snapshot(): JourneysSnapshot {
    return { next: this.next, active: [...this.active] };
  }

  restore(snapshot: JourneysSnapshot | undefined): void {
    // Journeys saved before `nodesEntered` existed (v27, before recall) counted nodes by index.
    this.active = (snapshot?.active ?? []).map((j) =>
      j.result.nodesEntered === undefined ? { ...j, result: { ...j.result, nodesEntered: j.result.reachedNode } } : j,
    );
    this.next = snapshot?.next ?? 1;
  }
}
