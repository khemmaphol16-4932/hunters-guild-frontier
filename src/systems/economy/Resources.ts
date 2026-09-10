import type { ResourceDef } from '../../data/economySchema.js';
import { err, ok, type Result } from '../../core/result.js';

export type ResourceAmounts = Readonly<Record<string, number>>;
export interface ResourcesSnapshot { readonly balances: ResourceAmounts }

/**
 * What happens to a credit that would push a balance past its authored capacity.
 *
 * - `reject` — the whole transaction fails and nothing moves. Anything the guild *pays* for
 *   uses this: a purchase that cannot be stored must not take the gold.
 * - `discard` — the balance fills to capacity and the excess is reported on the receipt.
 *   Income the guild did not pay for (hauls, production, rewards) uses this, because refusing
 *   a whole expedition reward over a full granary would be the worse outcome.
 *
 * The distinction exists because the ledger used to discard silently for everyone, and a
 * market purchase into a full store charged 495 gold and delivered nothing (DL-044).
 */
export type OverflowRule = 'reject' | 'discard';

export interface Transaction {
  readonly debits?: ResourceAmounts;
  readonly credits?: ResourceAmounts;
  /** Defaults to `discard`; see {@link OverflowRule}. */
  readonly overflow?: OverflowRule;
}

export interface TransactionReceipt extends ResourcesSnapshot {
  /** Credit that did not fit, per resource. Empty when everything landed. */
  readonly discarded: ResourceAmounts;
}

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
  capacity(id: string): number { return this.definitions.get(id)?.capacity ?? 0; }
  /** How much more of a resource the guild can store right now. */
  room(id: string): number { return Math.max(0, this.capacity(id) - this.amount(id)); }

  canAfford(cost: ResourceAmounts): boolean {
    return Object.entries(cost).every(([id, amount]) => this.validAmount(id, amount) && this.amount(id) >= amount);
  }

  transact(transaction: Transaction): Result<TransactionReceipt, string> {
    const debits = transaction.debits ?? {};
    const credits = transaction.credits ?? {};
    const overflow = transaction.overflow ?? 'discard';
    for (const [id, amount] of [...Object.entries(debits), ...Object.entries(credits)]) {
      if (!this.validAmount(id, amount)) return err(`invalid amount for resource "${id}"`);
    }
    for (const [id, amount] of Object.entries(debits)) {
      if (this.amount(id) < amount) return err(`not enough ${this.nameOf(id)}`);
    }

    // Capacity is judged on the *net* result, so a trade that spends and receives the same
    // resource is not refused for a moment of overflow it never actually reaches.
    const next = new Map(this.balances);
    for (const [id, amount] of Object.entries(debits)) next.set(id, (next.get(id) ?? 0) - amount);
    const discarded: Record<string, number> = {};
    for (const [id, amount] of Object.entries(credits)) {
      const wanted = (next.get(id) ?? 0) + amount;
      const capacity = this.capacity(id);
      if (wanted > capacity) {
        if (overflow === 'reject') return err(`not enough room to store ${this.nameOf(id)}`);
        discarded[id] = (discarded[id] ?? 0) + (wanted - capacity);
      }
      next.set(id, Math.min(capacity, wanted));
    }

    this.balances = next;
    return ok({ ...this.snapshot(), discarded });
  }

  consumeAvailable(id: string, requested: number): Result<{ consumed: number; shortfall: number }, string> {
    if (!this.validAmount(id, requested)) return err(`invalid amount for resource "${id}"`);
    const consumed = Math.min(this.amount(id), requested);
    const result = this.transact({ debits: { [id]: consumed } });
    if (!result.ok) return result;
    return ok({ consumed, shortfall: requested - consumed });
  }

  snapshot(): ResourcesSnapshot { return { balances: this.all() }; }

  /**
   * Restore balances from a save.
   *
   * A resource the save does not mention starts at its authored founding balance rather than
   * zero. That covers two cases with one rule: a pre-economy save migrated forward (v10→v11
   * writes an empty ledger), and a resource added to content after the save was written.
   * Both describe a guild that has never had the chance to earn or spend that resource, which
   * is exactly what a new guild is (DL-045).
   */
  restore(snapshot: ResourcesSnapshot | undefined): void {
    if (!snapshot) return;
    for (const definition of this.definitions.values()) {
      const value = snapshot.balances[definition.id];
      const restored = value === undefined
        ? definition.starting
        : typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
      this.balances.set(definition.id, Math.min(definition.capacity, restored));
    }
  }

  private nameOf(id: string): string { return this.definitions.get(id)?.name ?? id; }

  private validAmount(id: string, amount: number): boolean {
    return this.definitions.has(id) && Number.isFinite(amount) && amount >= 0;
  }
}
