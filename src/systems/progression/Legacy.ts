import { err, ok, type Result } from '../../core/result.js';
import type { LegacyUnlockDef, ProgressionData } from '../../data/progressionSchema.js';
import type { MonumentEntry } from './Monument.js';

export type { LegacyUnlockCategory } from '../../data/progressionSchema.js';
export type LegacyUnlock = LegacyUnlockDef;

export interface LegacySnapshot {
  readonly earned: number;
  readonly spent: number;
  /** `c<cycle>|<kind>|<monument id>` for every achievement that paid out. */
  readonly awardedAchievements: readonly string[];
  readonly unlocked: readonly string[];
}

export interface LegacyDeps {
  readonly balance: ProgressionData['legacy'];
  readonly achievements: () => readonly MonumentEntry[];
  /** The New Game+ cycle the Monument's current entries belong to. */
  readonly cycle: () => number;
}

/**
 * Permanent breadth and new options, never a raw-stat ladder (REQ-LEG-001).
 *
 * Points come from Monument achievements, **bounded per kind per cycle** by
 * `balance/progression.json`. The first version paid every plaque with no limit, and since
 * every routine contract was a plaque, the contract board minted Legacy without end: thirty
 * loops earned 42 points against a catalogue costing 16 (DL-047).
 *
 * Awards are keyed by cycle so each New Game+ cycle can earn its own achievements again —
 * the Monument is cleared between cycles, and a guild that defeats the same world boss in a
 * new world has done it again. Within a cycle nothing pays twice.
 */
export class Legacy {
  private earned = 0;
  private spent = 0;
  private readonly awarded = new Set<string>();
  private readonly unlockedIds = new Set<string>();

  constructor(private readonly deps: LegacyDeps) {}

  get points(): number {
    this.reconcile();
    return this.earned - this.spent;
  }

  get lifetimePoints(): number {
    this.reconcile();
    return this.earned;
  }

  catalogue(): readonly LegacyUnlock[] {
    return this.deps.balance.unlocks;
  }

  unlocks(): readonly LegacyUnlock[] {
    return this.deps.balance.unlocks.filter((unlock) => this.unlockedIds.has(unlock.id));
  }

  has(unlockId: string): boolean {
    return this.unlockedIds.has(unlockId);
  }

  find(unlockId: string): LegacyUnlock | undefined {
    return this.deps.balance.unlocks.find((unlock) => unlock.id === unlockId);
  }

  purchase(unlockId: string): Result<LegacyUnlock, string> {
    this.reconcile();
    const unlock = this.find(unlockId);
    if (!unlock) return err(`unknown Legacy unlock "${unlockId}"`);
    if (this.unlockedIds.has(unlockId)) return err(`${unlock.name} is already unlocked`);
    if (this.points < unlock.cost) return err(`${unlock.name} needs ${unlock.cost} Legacy points; ${this.points} available`);
    this.spent += unlock.cost;
    this.unlockedIds.add(unlockId);
    return ok(unlock);
  }

  snapshot(): LegacySnapshot {
    this.reconcile();
    return {
      earned: this.earned,
      spent: this.spent,
      awardedAchievements: [...this.awarded].sort(),
      unlocked: [...this.unlockedIds].sort(),
    };
  }

  restore(snapshot: LegacySnapshot | undefined): void {
    this.earned = Math.max(0, snapshot?.earned ?? 0);
    this.spent = Math.min(this.earned, Math.max(0, snapshot?.spent ?? 0));
    this.awarded.clear();
    // Saves from before DL-047 stored bare Monument ids. Those were all earned in cycle 0,
    // and their kind is recoverable from the Monument, which is restored first.
    const kindOf = new Map(this.deps.achievements().map((entry) => [entry.id, entry.kind]));
    for (const id of snapshot?.awardedAchievements ?? []) {
      this.awarded.add(id.includes('|') ? id : `c0|${kindOf.get(id) ?? 'unknown'}|${id}`);
    }
    this.unlockedIds.clear();
    for (const id of snapshot?.unlocked ?? []) {
      if (this.find(id)) this.unlockedIds.add(id);
    }
    this.reconcile();
  }

  private reconcile(): void {
    const cycle = this.deps.cycle();
    for (const achievement of this.deps.achievements()) {
      const key = `c${cycle}|${achievement.kind}|${achievement.id}`;
      if (this.awarded.has(key)) continue;
      const award = this.deps.balance.awards[achievement.kind];
      if (!award) continue;
      const prefix = `c${cycle}|${achievement.kind}|`;
      let paidThisCycle = 0;
      for (const done of this.awarded) if (done.startsWith(prefix)) paidThisCycle++;
      if (paidThisCycle >= award.maxPerCycle) continue;
      this.awarded.add(key);
      this.earned += award.points;
    }
  }
}
