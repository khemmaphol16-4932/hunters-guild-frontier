import type { FactionDef } from '../../data/contractSchema.js';
export interface FactionsSnapshot { readonly standing: Readonly<Record<string, number>> }
export class Factions {
  private standing = new Map<string, number>();
  constructor(private readonly definitions: readonly FactionDef[]) { for (const faction of definitions) this.standing.set(faction.id, 0); }
  value(id: string): number { return this.standing.get(id) ?? 0; }
  change(id: string, delta: number): number { if (!this.standing.has(id)) throw new Error(`unknown faction "${id}"`); const value=Math.max(-100,Math.min(100,this.value(id)+delta));this.standing.set(id,value);return value; }
  snapshot(): FactionsSnapshot { return { standing: Object.fromEntries(this.standing) }; }
  restore(snapshot: FactionsSnapshot | undefined): void { for(const def of this.definitions)this.standing.set(def.id,Math.max(-100,Math.min(100,snapshot?.standing[def.id]??0))); }
}
