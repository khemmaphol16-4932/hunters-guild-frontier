import { err, ok, type Result } from '../../core/result.js';
import type { MonumentEntry, MonumentKind } from './Monument.js';

export type LegacyUnlockCategory = 'startingChoice' | 'archetype' | 'convenience' | 'system' | 'worldVariant' | 'prestige';

export interface LegacyUnlock {
  readonly id: string;
  readonly name: string;
  readonly category: LegacyUnlockCategory;
  readonly cost: number;
  readonly description: string;
}

export const LEGACY_UNLOCKS: readonly LegacyUnlock[] = [
  { id: 'prepared_caravan', name: 'Prepared Caravan', category: 'startingChoice', cost: 2, description: 'Offers an extra-provisions opening in a future cycle.' },
  { id: 'veteran_records', name: 'Veteran Records', category: 'convenience', cost: 2, description: 'Reveals fuller candidate histories during recruitment.' },
  { id: 'mentor_hall', name: 'Mentor Hall', category: 'system', cost: 3, description: 'Allows retired hunters to serve as mentors.' },
  { id: 'frontier_exile', name: 'Frontier Exile', category: 'archetype', cost: 4, description: 'Offers a lean, expedition-focused starting archetype.' },
  { id: 'long_winter', name: 'Long Winter', category: 'worldVariant', cost: 4, description: 'Unlocks a harsher food-economy world variant.' },
  { id: 'carved_founders', name: 'Carved Founders', category: 'prestige', cost: 1, description: 'Adds the founding roster to the Monument facade.' },
];

export interface LegacySnapshot {
  readonly earned: number;
  readonly spent: number;
  readonly awardedAchievements: readonly string[];
  readonly unlocked: readonly string[];
}

const POINTS_BY_KIND: Readonly<Record<MonumentKind, number>> = {
  worldBossVictory: 5,
  frontierDiscovery: 2,
  legendaryFind: 2,
  historicContract: 2,
  legendaryHunter: 4,
  townMilestone: 2,
  researchBreakthrough: 1,
};

/** Permanent breadth and new options, never a raw-stat ladder (REQ-LEG-001). */
export class Legacy {
  private earned = 0;
  private spent = 0;
  private readonly awarded = new Set<string>();
  private readonly unlockedIds = new Set<string>();

  constructor(private readonly achievements: () => readonly MonumentEntry[]) {}

  get points(): number {
    this.reconcile();
    return this.earned - this.spent;
  }

  get lifetimePoints(): number {
    this.reconcile();
    return this.earned;
  }

  unlocks(): readonly LegacyUnlock[] {
    return LEGACY_UNLOCKS.filter((unlock) => this.unlockedIds.has(unlock.id));
  }

  has(unlockId: string): boolean {
    return this.unlockedIds.has(unlockId);
  }

  purchase(unlockId: string): Result<LegacyUnlock, string> {
    this.reconcile();
    const unlock = LEGACY_UNLOCKS.find((candidate) => candidate.id === unlockId);
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
    for (const id of snapshot?.awardedAchievements ?? []) this.awarded.add(id);
    this.unlockedIds.clear();
    for (const id of snapshot?.unlocked ?? []) {
      if (LEGACY_UNLOCKS.some((unlock) => unlock.id === id)) this.unlockedIds.add(id);
    }
    this.reconcile();
  }

  private reconcile(): void {
    for (const achievement of this.achievements()) {
      if (this.awarded.has(achievement.id)) continue;
      this.awarded.add(achievement.id);
      this.earned += POINTS_BY_KIND[achievement.kind];
    }
  }
}
