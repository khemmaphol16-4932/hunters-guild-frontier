import type { FactionDef, StandingRules } from '../../data/contractSchema.js';

export interface FactionsSnapshot { readonly standing: Readonly<Record<string, number>> }

/** Per-client standing with the guild (REQ-FAC-001). Deliberately not a political simulator. */
export class Factions {
  private readonly standing = new Map<string, number>();

  constructor(
    private readonly definitions: readonly FactionDef[],
    private readonly rules: StandingRules,
  ) {
    for (const faction of definitions) this.standing.set(faction.id, 0);
  }

  value(id: string): number { return this.standing.get(id) ?? 0; }

  change(id: string, delta: number): number {
    if (!this.standing.has(id)) throw new Error(`unknown faction "${id}"`);
    const value = this.clamp(this.value(id) + delta);
    this.standing.set(id, value);
    return value;
  }

  snapshot(): FactionsSnapshot { return { standing: Object.fromEntries(this.standing) }; }

  restore(snapshot: FactionsSnapshot | undefined): void {
    for (const def of this.definitions) this.standing.set(def.id, this.clamp(snapshot?.standing[def.id] ?? 0));
  }

  private clamp(value: number): number { return Math.max(this.rules.min, Math.min(this.rules.max, value)); }
}
