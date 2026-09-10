/**
 * The town's people, and the pressure they create.
 *
 * REQ-TWN-003 is the whole specification: the town has a real population that creates demand
 * for food, housing and services, grants growth and unlocks — *and excess population creates
 * food, housing and infrastructure pressure*. Both halves matter. Population that only ever
 * helped would make growth a free resource; population that only ever hurt would make the
 * player farm a small town. It has to be a genuine trade, which means demand and capacity are
 * separate quantities that the player is responsible for keeping in some relation.
 *
 * The second rule here is REQ-TWN-003's other sentence, and it is easy to violate by
 * accident: **Town Stability summarises but never replaces the individual indicators.** So
 * `report()` returns the three pressures *and* the summary, always, and a single scalar is
 * never the only thing on offer. A UI or a test that only had the summary could not tell a
 * housing crisis from a famine, which is precisely the information the player needs to act.
 *
 * Growth and departure are deterministic — a fractional accumulator, no RNG. Population is
 * coarse-step town simulation, not a dice roll, and DL-003 wants everything on the fixed
 * timestep anyway. It also means the same town on the same seed grows identically, which is
 * what makes offline catch-up (REQ-OFF-002) able to run this at all.
 */

import type { Capacity, TownBalance } from '../../data/townSchema.js';

export type DemandKey = 'housing' | 'food' | 'services';
export const DEMAND_KEYS: readonly DemandKey[] = ['housing', 'food', 'services'];

export interface PressureReading {
  readonly key: DemandKey;
  readonly demand: number;
  readonly capacity: number;
  /** 0 when demand is met, rising to 1 when nothing is provided at all. */
  readonly pressure: number;
  /** Player-readable, and specific — "short 14 beds", not "housing: 0.42". */
  readonly summary: string;
}

export interface TownReport {
  readonly population: number;
  /** Always all three. The summary never arrives without them (REQ-TWN-003). */
  readonly pressures: readonly PressureReading[];
  readonly stability: number;
  readonly stabilityBand: string;
  readonly growthPerStep: number;
}

export interface PopulationSnapshot {
  readonly count: number;
  /** Sub-person residue, so growth over many small steps is not rounded away each time. */
  readonly fraction: number;
}

export interface PopulationDeps {
  readonly balance: TownBalance;
  readonly capacityOf: () => Capacity;
  readonly reputationOf: () => number;
  readonly foodSupplyFraction?: () => number;
}

export class Population {
  private count: number;
  private fraction = 0;

  constructor(private readonly deps: PopulationDeps) {
    this.count = deps.balance.population.starting;
  }

  get size(): number {
    return this.count;
  }

  demandFor(key: DemandKey): number {
    return this.count * this.deps.balance.population.perCapita[key];
  }

  private capacityFor(key: DemandKey): number {
    const capacity = this.deps.capacityOf();
    if (key === 'services') return capacity.service;
    if (key === 'food') return capacity.food * (this.deps.foodSupplyFraction?.() ?? 1);
    return capacity[key];
  }

  /** One axis of pressure. 0 = met, 1 = nothing provided. */
  pressureFor(key: DemandKey): PressureReading {
    const demand = this.demandFor(key);
    const capacity = this.capacityFor(key);
    const shortfall = Math.max(0, demand - capacity);
    const pressure = demand <= 0 ? 0 : Math.min(1, shortfall / demand);

    // Summaries are stated in *people*, never in capacity units. Services are the reason
    // this matters: one service point covers four people, so "services comfortable for 3"
    // read as a crisis in a town of twelve when it actually meant everyone was fine. Same
    // class of bug as Phase 5's "well travelled — 0 expeditions": two different quantities
    // sharing one sentence.
    const perCapita = this.deps.balance.population.perCapita[key];
    const peopleServed = perCapita <= 0 ? this.count : capacity / perCapita;

    return {
      key,
      demand,
      capacity,
      pressure,
      summary: describe(key, this.count, peopleServed),
    };
  }

  pressures(): readonly PressureReading[] {
    return DEMAND_KEYS.map((key) => this.pressureFor(key));
  }

  /**
   * Town Stability — 1 is a town under no pressure at all, 0 a town failing on every axis.
   *
   * A weighted mean of the *relieved* pressure, where the weights are relative severities
   * and deliberately do not sum to 1 (DL-036): normalising them would let a total housing
   * collapse be averaged away by a full granary, and the summary would then reassure the
   * player at exactly the moment it should not.
   */
  stability(): number {
    const weights = this.deps.balance.stability.weights;
    let weighted = 0;
    let total = 0;
    for (const reading of this.pressures()) {
      const weight = weights[reading.key];
      weighted += weight * (1 - reading.pressure);
      total += weight;
    }
    return total <= 0 ? 1 : weighted / total;
  }

  stabilityBand(): string {
    const value = this.stability();
    for (const band of this.deps.balance.stability.bands) {
      if (value >= band.atLeast) return band.label;
    }
    // The last band is validated to have a floor of 0, so this is unreachable in practice.
    return this.deps.balance.stability.bands[this.deps.balance.stability.bands.length - 1]!.label;
  }

  /**
   * How much the population changes per coarse step.
   *
   * Reputation attracts people; prosperity keeps them. A strained town attracts nobody,
   * which is the mechanism that makes REQ-TWN-003's pressure self-limiting rather than a
   * spiral: growth stops before departure starts, so a player who overbuilds their roster
   * plateaus instead of collapsing.
   */
  growthPerStep(): number {
    const { growth, departure } = this.deps.balance.population;
    const stability = this.stability();

    const arrivals = Math.min(
      growth.maxPerStep,
      (growth.basePerStep + growth.perReputation * Math.max(0, this.deps.reputationOf())) *
        Math.max(0, 1 - growth.prosperityScale * (1 - stability)),
    );

    const worstPressure = Math.max(...this.pressures().map((p) => p.pressure));
    const departures =
      worstPressure <= departure.pressureThreshold
        ? 0
        : departure.perStepAtFullPressure *
          ((worstPressure - departure.pressureThreshold) / (1 - departure.pressureThreshold));

    return arrivals - departures;
  }

  /**
   * Advance the population by `steps` coarse steps.
   *
   * The fractional residue is kept rather than rounded, so a town growing at 0.04 people per
   * step actually gains someone every twenty-five steps instead of never gaining anyone.
   * Returns the whole-person change, which is what the Chronicle and the UI care about.
   */
  step(steps = 1): number {
    const before = this.count;
    // Recomputed per step rather than multiplied: growth depends on stability, which depends
    // on population, so a single multiplication would overshoot at exactly the moment the
    // town stops being able to support anyone.
    for (let i = 0; i < steps; i++) {
      this.fraction += this.growthPerStep();
      const whole = Math.trunc(this.fraction);
      if (whole !== 0) {
        this.count = Math.max(0, this.count + whole);
        this.fraction -= whole;
      }
    }
    return this.count - before;
  }

  /** Directly change the population — an event, a story beat, a defense that went badly. */
  adjust(delta: number): number {
    this.count = Math.max(0, this.count + delta);
    return this.count;
  }

  /**
   * Everything the town panel needs, in one read.
   * The individual pressures come with it by construction, not by convention.
   */
  report(): TownReport {
    return {
      population: this.count,
      pressures: this.pressures(),
      stability: this.stability(),
      stabilityBand: this.stabilityBand(),
      growthPerStep: this.growthPerStep(),
    };
  }

  snapshot(): PopulationSnapshot {
    return { count: this.count, fraction: this.fraction };
  }

  restore(snapshot: PopulationSnapshot | undefined): void {
    this.count = snapshot?.count ?? this.deps.balance.population.starting;
    this.fraction = snapshot?.fraction ?? 0;
  }
}

/**
 * Both arguments are counts of *people* — how many live here, and how many the town's
 * capacity on this axis can actually look after. Never capacity units.
 */
function describe(key: DemandKey, population: number, peopleServed: number): string {
  const served = Math.floor(peopleServed);
  const shortfall = Math.ceil(population - peopleServed);

  switch (key) {
    case 'housing':
      return shortfall > 0
        ? `Short ${shortfall} bed${shortfall === 1 ? '' : 's'} for ${population} residents`
        : `Beds for ${served}, ${population} taken`;
    case 'food':
      return shortfall > 0
        ? `Feeding ${served} of ${population} — people are going hungry`
        : `Enough food for ${served}`;
    case 'services':
      return shortfall > 0
        ? `Services stretched — enough for ${served} of ${population}`
        : `Services comfortable for ${served}`;
  }
}
