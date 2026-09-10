export interface CapabilityVector {
  readonly combat: number;
  readonly expedition: number;
  readonly crafting: number;
  readonly resource: number;
  readonly defense: number;
  readonly research: number;
  readonly economic: number;
}

export interface CapabilityDeps {
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
    const levels = this.deps.hunterLevels();
    const combat = levels.length === 0 ? 0 : levels.reduce((sum, level) => sum + level, 0) / levels.length;
    return {
      combat,
      expedition: combat * 0.6 + this.deps.reputation() * 0.4,
      crafting: this.deps.departmentOutput('crafting') + this.deps.armouryValue() / 1_000,
      resource: this.deps.departmentOutput('resource'),
      defense: this.deps.departmentOutput('defense') + this.deps.defenseCapacity(),
      research: this.deps.departmentOutput('research') + this.deps.researchCompleted() * 2,
      economic: Math.log10(1 + this.deps.gold()) * 10,
    };
  }
}
