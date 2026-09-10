import type { CapabilityAxis, CapabilityBalance } from '../../data/progressionSchema.js';

export type CapabilityVector = Readonly<Record<CapabilityAxis, number>>;

export interface CapabilityDeps {
  readonly balance: CapabilityBalance;
  readonly hunterLevels: () => readonly number[];
  readonly armouryValue: () => number;
  readonly departmentOutput: (id: 'crafting' | 'resource' | 'defense' | 'research') => number;
  readonly defenseCapacity: () => number;
  readonly researchCompleted: () => number;
  readonly gold: () => number;
  readonly reputation: () => number;
}

/** REQ-CAP-001: independent readings only. Deliberately no total(), score or rank. */
export class Capability {
  constructor(private readonly deps: CapabilityDeps) {}

  read(): CapabilityVector {
    const b = this.deps.balance;
    const levels = this.deps.hunterLevels();
    const combat = levels.length === 0 ? 0 : levels.reduce((sum, level) => sum + level, 0) / levels.length;
    return {
      combat,
      expedition: combat * b.expeditionFromCombat + this.deps.reputation() * b.expeditionFromReputation,
      crafting: this.deps.departmentOutput('crafting') + this.deps.armouryValue() / b.armouryGoldPerPoint,
      resource: this.deps.departmentOutput('resource'),
      defense: this.deps.departmentOutput('defense') + this.deps.defenseCapacity(),
      research: this.deps.departmentOutput('research') + this.deps.researchCompleted() * b.researchPerCompletedNode,
      economic: Math.log10(1 + this.deps.gold()) * b.economicLogScale,
    };
  }
}
