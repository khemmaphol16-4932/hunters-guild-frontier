/**
 * The town as a thing the guild can support people with.
 *
 * `TownGrid` owns where buildings are; this owns what having them *means*. Three questions,
 * and they are deliberately the only three:
 *
 *   1. What can the town support? — housing, food, service and defence capacity (REQ-TWN-003).
 *   2. How good is it at supporting them? — housing and service *quality*, which is what
 *      v1.0 §4 makes recovery read.
 *   3. What is it now? — Small Camp → Village → Fortified Town → Hunter City (REQ-TWN-002).
 *
 * The third has a rule that shapes the whole class: **no reset on progression.** A town that
 * reached Fortified Town does not become a Village again because a granary burned down. So
 * the current stage is derived, and the stage the town *is* is the highest it has ever
 * derived — stored, monotonic, and impossible to lower through the public surface (DL-037).
 *
 * Quality is the other decision worth naming. Capacity ratio above 1 does not raise quality
 * linearly, because overbuilding would otherwise trivialise recovery: a town with ten
 * bathhouses would heal injuries instantly. Surplus has diminishing value and a ceiling, so
 * building *more* is worth something and building *far more* is worth almost nothing.
 */

import type {
  Capacity,
  CapacityKey,
  BuildingDef,
  StageDef,
  TownBalance,
} from '../../data/townSchema.js';
import {
  EMPTY_CAPACITY,
  addCapacity,
  capacityThroughTier,
  jobSlotsThroughTier,
} from '../../data/townSchema.js';
import { err, ok, type Result } from '../../core/result.js';
import { TownGrid, type TownGridSnapshot } from './TownGrid.js';

export interface TownSnapshot {
  readonly grid: TownGridSnapshot;
  /** Index into the stage ladder. Stored because progression never reverses (REQ-TWN-002). */
  readonly highestStageIndex: number;
}

export interface TownDeps {
  readonly balance: TownBalance;
  readonly buildings: readonly BuildingDef[];
  /** Population is its own system; the town reads it for stage and unlock checks. */
  readonly populationOf: () => number;
  readonly reputationOf: () => number;
  /** Food produced by staffed jobs, which counts toward capacity alongside buildings. */
  readonly jobFoodOf?: () => number;
  readonly foodSupplyFraction?: () => number;
  /**
   * What research has changed about the town.
   *
   * Injected rather than imported so `Town` stays the thing that knows about buildings and
   * `Research` stays the thing that knows about the tree — neither becomes a second place
   * where the other's rules live. The defaults make every one of these a no-op, so `Town`
   * is still constructible and testable without a research tree at all.
   */
  readonly researchCapacity?: (axis: CapacityKey) => number;
  readonly researchQuality?: (axis: CapacityKey) => number;
  readonly researchUnlockedBuilding?: (buildingId: string) => boolean;
  readonly onStageReached?: (stage: StageDef) => void;
}

export class Town {
  readonly grid: TownGrid;
  private readonly byId: ReadonlyMap<string, BuildingDef>;
  private highestStageIndex = 0;

  constructor(private readonly deps: TownDeps) {
    this.byId = new Map(deps.buildings.map((b) => [b.id, b]));
    this.grid = new TownGrid({
      width: deps.balance.grid.width,
      height: deps.balance.grid.height,
      buildingOf: (id) => this.byId.get(id),
    });
  }

  definition(buildingId: string): BuildingDef | undefined {
    return this.byId.get(buildingId);
  }

  get buildings(): readonly BuildingDef[] {
    return this.deps.buildings;
  }

  // --- Capacity -------------------------------------------------------------

  /** What the standing buildings provide, before any staffed job adds to it. */
  buildingCapacity(): Capacity {
    let total = EMPTY_CAPACITY;
    for (const placement of this.grid.all()) {
      // A wrecked building still stands and still takes up its cells, but it supports
      // nobody until it is repaired (REQ-TWN-008). This is the only thing in the game that
      // can lower town capacity, which is exactly why the stage ladder is stored rather
      // than derived (DL-037) — a burnt granary must not demote a Fortified Town.
      if (placement.damaged === true) continue;
      const def = this.byId.get(placement.buildingId);
      if (!def) continue;
      total = addCapacity(total, capacityThroughTier(def, placement.tier));
    }
    return total;
  }

  /**
   * Everything the town can support right now.
   *
   * Job food is folded in here rather than left to the caller because REQ-TWN-003's food
   * pressure would otherwise be unanswerable: granaries *store* food, and only a staffed
   * cookhouse actually feeds anyone. A town that could grow but never feed itself would make
   * food pressure a dead end rather than a problem the player solves.
   */
  capacity(): Capacity {
    const base = this.buildingCapacity();
    const jobFood = this.deps.jobFoodOf?.() ?? 0;
    const research = (axis: CapacityKey): number => this.deps.researchCapacity?.(axis) ?? 0;

    return {
      housing: base.housing + research('housing'),
      food: base.food + jobFood + research('food'),
      service: base.service + research('service'),
      defence: base.defence + research('defence'),
    };
  }

  /** Job id -> total slots across the town. */
  jobSlots(): Readonly<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const placement of this.grid.all()) {
      // Nobody works in a wrecked building either.
      if (placement.damaged === true) continue;
      const def = this.byId.get(placement.buildingId);
      if (!def) continue;
      for (const [job, slots] of Object.entries(jobSlotsThroughTier(def, placement.tier))) {
        out[job] = (out[job] ?? 0) + slots;
      }
    }
    return out;
  }

  // --- Quality --------------------------------------------------------------

  /**
   * How well the town houses people, as a multiplier around a baseline of 1.
   *
   * An *unbuilt* town is not a baseline town — it is a bad one, and the floor here says so.
   * That distinction is what makes the first bunkhouse feel like it did something.
   */
  housingQuality(): number {
    return this.applyResearchQuality(
      'housing',
      this.qualityFrom(
        this.capacity().housing,
        this.demandFor('housing'),
        this.deps.balance.quality.unbuiltHousingQuality,
      ),
    );
  }

  /** Service quality — kitchens, baths, the infirmary. What an injury heals under. */
  serviceQuality(): number {
    return this.applyResearchQuality(
      'service',
      this.qualityFrom(
        this.capacity().service,
        this.demandFor('services'),
        this.deps.balance.quality.unbuiltServiceQuality,
      ),
    );
  }

  /**
   * Research multiplies quality, and the ceiling still applies afterwards.
   *
   * Applied after the capacity maths rather than folded into it, because the two answer
   * different questions: capacity is how much there is, research is how well the guild
   * knows how to use it. Masonry should improve bad housing as well as good.
   */
  private applyResearchQuality(axis: CapacityKey, quality: number): number {
    const scale = this.deps.researchQuality?.(axis) ?? 1;
    return Math.min(this.deps.balance.quality.maxQuality, quality * scale);
  }

  /** Whether the town can feed everyone in it. Recovery reads this as a yes/no (v1.0 §4). */
  foodAvailable(): boolean {
    return this.capacity().food >= this.demandFor('food') && (this.deps.foodSupplyFraction?.() ?? 1) >= 1;
  }

  private demandFor(key: 'housing' | 'food' | 'services'): number {
    return Math.max(0, this.deps.populationOf()) * this.deps.balance.population.perCapita[key];
  }

  private qualityFrom(provided: number, demand: number, unbuilt: number): number {
    const { surplusQualityScale, maxQuality } = this.deps.balance.quality;
    if (provided <= 0) return unbuilt;
    // A town with nobody in it is comfortable, not undefined.
    if (demand <= 0) return Math.min(maxQuality, 1 + surplusQualityScale);

    const ratio = provided / demand;
    if (ratio <= 1) {
      // Scaled from the unbuilt floor up to baseline, so falling short degrades smoothly
      // rather than stepping off a cliff at exactly 100%.
      return unbuilt + (1 - unbuilt) * ratio;
    }
    // Diminishing: the square root of the surplus, not the surplus.
    return Math.min(maxQuality, 1 + surplusQualityScale * Math.sqrt(ratio - 1));
  }

  // --- Stage ----------------------------------------------------------------

  /** REQ-TWN-006 — the guild hall's tier, which the stage ladder reads. */
  guildHallTier(): number {
    const hall = this.deps.buildings.find((b) => b.providesGuildHallTier);
    if (!hall) return 0;
    const placed = this.grid.all().find((p) => p.buildingId === hall.id);
    return placed?.tier ?? 0;
  }

  /** The best stage the town currently satisfies, ignoring history. */
  derivedStage(): StageDef {
    const population = this.deps.populationOf();
    const buildings = this.grid.size;
    const hallTier = this.guildHallTier();
    const stages = this.deps.balance.stages;

    let best = stages[0];
    for (const stage of stages) {
      const met =
        population >= stage.requires.population &&
        buildings >= stage.requires.buildings &&
        hallTier >= stage.requires.guildHallTier;
      if (met) best = stage;
    }
    // The ladder is validated non-decreasing at load, so the last satisfied stage is the
    // highest satisfied one and there is no need to search for a better earlier entry.
    return best ?? stages[0]!;
  }

  /**
   * What the town *is*. Never lower than it has ever been (REQ-TWN-002).
   *
   * Call `refreshStage` after anything that could raise it; this is a pure read so the UI
   * can ask freely without provoking an event.
   */
  stage(): StageDef {
    return this.deps.balance.stages[this.highestStageIndex] ?? this.deps.balance.stages[0]!;
  }

  /** Recompute progression. Returns the new stage if the town just grew into one. */
  refreshStage(): StageDef | undefined {
    const derived = this.derivedStage();
    const index = this.deps.balance.stages.findIndex((s) => s.id === derived.id);
    if (index <= this.highestStageIndex) return undefined;

    this.highestStageIndex = index;
    const reached = this.stage();
    this.deps.onStageReached?.(reached);
    return reached;
  }

  /** How far off the next stage is, per axis — the town panel's "what's next" list. */
  nextStageRequirements(): {
    readonly stage: StageDef;
    readonly shortfalls: readonly string[];
  } | undefined {
    const next = this.deps.balance.stages[this.highestStageIndex + 1];
    if (!next) return undefined;

    const shortfalls: string[] = [];
    const population = this.deps.populationOf();
    if (population < next.requires.population) {
      shortfalls.push(`${next.requires.population - Math.floor(population)} more residents`);
    }
    if (this.grid.size < next.requires.buildings) {
      shortfalls.push(`${next.requires.buildings - this.grid.size} more buildings`);
    }
    if (this.guildHallTier() < next.requires.guildHallTier) {
      shortfalls.push(`a Guild Hall at tier ${next.requires.guildHallTier}`);
    }
    return { stage: next, shortfalls };
  }

  // --- Unlocks --------------------------------------------------------------

  /**
   * Whether the guild may build this at all.
   *
   * A locked building is *shown* with its reason, the same way a locked region is (DL-033) —
   * seeing that a Shrine exists and being told it needs a Fortified Town and 20 reputation
   * is itself progression.
   */
  canBuild(buildingId: string): Result<true, string> {
    const def = this.byId.get(buildingId);
    if (!def) return err(`unknown building "${buildingId}"`);
    if (def.unique && this.grid.countOf(buildingId) > 0) {
      return err(`the town already has a ${def.name}`);
    }

    const unlock = def.unlock;
    if (!unlock) return ok(true);

    // Research is a *second route* to a locked building, not a third requirement. A guild
    // that worked out masonry has earned the longhouse whether or not the town happens to
    // have grown into a Village yet — that is what makes the tree feel like knowledge
    // rather than a second progress bar gating the same things.
    if (this.deps.researchUnlockedBuilding?.(buildingId) === true) return ok(true);

    const stages = this.deps.balance.stages;
    if (unlock.stage !== undefined) {
      const needed = stages.findIndex((s) => s.id === unlock.stage);
      if (needed > this.highestStageIndex) {
        return err(`needs the town to be a ${stages[needed]?.name ?? unlock.stage}`);
      }
    }
    if (unlock.population !== undefined && this.deps.populationOf() < unlock.population) {
      return err(`needs a population of ${unlock.population}`);
    }
    if (unlock.reputation !== undefined && this.deps.reputationOf() < unlock.reputation) {
      return err(`needs ${unlock.reputation} reputation`);
    }
    return ok(true);
  }

  /** The build menu: every building with whether it is available and why not (DL-033). */
  buildMenu(): readonly {
    readonly building: BuildingDef;
    readonly available: boolean;
    readonly blockedBy: string | undefined;
  }[] {
    return this.deps.buildings.map((building) => {
      const allowed = this.canBuild(building.id);
      return {
        building,
        available: allowed.ok,
        blockedBy: allowed.ok ? undefined : allowed.error,
      };
    });
  }

  /** The cost of the next tier of a placed building, or why it cannot be raised. */
  upgradeCost(instanceId: string): Result<{ tier: number; gold: number; materials: number }, string> {
    const placement = this.grid.get(instanceId);
    if (!placement) return err(`nothing placed as "${instanceId}"`);
    const def = this.byId.get(placement.buildingId);
    if (!def) return err(`unknown building "${placement.buildingId}"`);

    const next = def.tiers.find((t) => t.tier === placement.tier + 1);
    if (!next) return err(`${def.name} is already at its highest tier`);
    return ok({ tier: next.tier, gold: next.cost.gold, materials: next.cost.materials });
  }

  // --- Persistence ----------------------------------------------------------

  snapshot(): TownSnapshot {
    return { grid: this.grid.snapshot(), highestStageIndex: this.highestStageIndex };
  }

  restore(snapshot: TownSnapshot | undefined): void {
    this.grid.restore(snapshot?.grid);
    // Clamped rather than trusted: a save written against a longer stage ladder must not
    // index past the end of a shorter one.
    this.highestStageIndex = Math.min(
      Math.max(0, snapshot?.highestStageIndex ?? 0),
      this.deps.balance.stages.length - 1,
    );
  }
}
