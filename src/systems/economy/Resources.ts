import type { ResourceDef } from '../../data/economySchema.js';
import { err, ok, type Result } from '../../core/result.js';

export type ResourceAmounts = Readonly<Record<string, number>>;
export interface ResourcesSnapshot { readonly balances: ResourceAmounts }
export interface Transaction { readonly debits?: ResourceAmounts; readonly credits?: ResourceAmounts }

/** Atomic guild ledger. No caller can spend one input and fail halfway through the rest. */
export class Resources {
  private readonly definitions: ReadonlyMap<string, ResourceDef>;
  private balances = new Map<string, number>();

  constructor(definitions: readonly ResourceDef[]) {
    this.definitions = new Map(definitions.map((definition) => [definition.id, definition]));
    for (const definition of definitions) this.balances.set(definition.id, definition.starting);
  }

  amount(id: string): number { return this.balances.get(id) ?? 0; }
  all(): ResourceAmounts { return Object.fromEntries(this.balances); }

  canAfford(cost: ResourceAmounts): boolean {
    return Object.entries(cost).every(([id, amount]) => this.validAmount(id, amount) && this.amount(id) >= amount);
  }

  transact(transaction: Transaction): Result<ResourcesSnapshot, string> {
    const debits = transaction.debits ?? {};
    const credits = transaction.credits ?? {};
    for (const [id, amount] of [...Object.entries(debits), ...Object.entries(credits)]) {
      if (!this.validAmount(id, amount)) return err(`invalid amount for resource "${id}"`);
    }
    for (const [id, amount] of Object.entries(debits)) {
      if (this.amount(id) < amount) return err(`not enough ${this.definitions.get(id)?.name ?? id}`);
    }
    for (const [id, amount] of Object.entries(debits)) this.balances.set(id, this.amount(id) - amount);
    for (const [id, amount] of Object.entries(credits)) this.balances.set(id, this.amount(id) + amount);
    return ok(this.snapshot());
  }

  consumeAvailable(id: string, requested: number): Result<{ consumed: number; shortfall: number }, string> {
    if (!this.validAmount(id, requested)) return err(`invalid amount for resource "${id}"`);
    const consumed = Math.min(this.amount(id), requested);
    const result = this.transact({ debits: { [id]: consumed } });
    if (!result.ok) return result;
    return ok({ consumed, shortfall: requested - consumed });
  }

  snapshot(): ResourcesSnapshot { return { balances: this.all() }; }
  restore(snapshot: ResourcesSnapshot | undefined): void {
    if (!snapshot) return;
    for (const definition of this.definitions.values()) {
      const value = snapshot.balances[definition.id];
      this.balances.set(definition.id, typeof value === 'number' && value >= 0 ? value : 0);
    }
  }

  private validAmount(id: string, amount: number): boolean {
    return this.definitions.has(id) && Number.isFinite(amount) && amount >= 0;
  }
}
