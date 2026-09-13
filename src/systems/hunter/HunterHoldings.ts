/**
 * A hunter's personal money and the loot they are carrying (REQ-CW-008, -011; DL-076).
 *
 * A hunter owns money and carried loot; loot transfers to Guild storage only when it is sold. The
 * Guild buys a returning hunter's loot at its full sell value, paying the hunter from the Guild
 * ledger. When the Guild cannot afford an item the hunter keeps it and it is offered again on a
 * later settle. This holds that state, keyed by hunter id, apart from the `Hunter` value itself so
 * hunter creation and every `with*` helper stay untouched. When a hunter leaves the roster their
 * holdings go with them.
 */

import type { HunterId } from '../../core/ids.js';
import type { Item } from '../../core/items/Item.js';

interface Holding {
  money: number;
  carried: Item[];
}

export interface HunterHoldingsSnapshot {
  readonly holdings: readonly { readonly hunterId: HunterId; readonly money: number; readonly carried: readonly Item[] }[];
}

export class HunterHoldings {
  private readonly byHunter = new Map<HunterId, Holding>();

  private hold(id: HunterId): Holding {
    let holding = this.byHunter.get(id);
    if (!holding) {
      holding = { money: 0, carried: [] };
      this.byHunter.set(id, holding);
    }
    return holding;
  }

  /** A hunter's personal money. */
  moneyOf(id: HunterId): number {
    return this.byHunter.get(id)?.money ?? 0;
  }

  /** Pay a hunter — the Guild's purchase of their loot, or any other personal income. */
  earn(id: HunterId, amount: number): void {
    if (amount <= 0) return;
    this.hold(id).money += amount;
  }

  /** Spend a hunter's money (a shop purchase). Returns false and spends nothing if they cannot afford it. */
  spend(id: HunterId, amount: number): boolean {
    const holding = this.hold(id);
    if (amount < 0 || holding.money < amount) return false;
    holding.money -= amount;
    return true;
  }

  /** The loot a hunter is carrying home, not yet sold to the Guild. */
  carriedOf(id: HunterId): readonly Item[] {
    return this.byHunter.get(id)?.carried ?? [];
  }

  /** A hunter picks up a loot drop (REQ-CW-011). */
  addCarried(id: HunterId, item: Item): void {
    this.hold(id).carried.push(item);
  }

  /** Remove one carried item — it has been sold. */
  removeCarried(id: HunterId, item: Item): void {
    const holding = this.byHunter.get(id);
    if (!holding) return;
    const index = holding.carried.indexOf(item);
    if (index >= 0) holding.carried.splice(index, 1);
  }

  /** Every hunter who is carrying at least one unsold item. */
  hunterIdsWithCarried(): readonly HunterId[] {
    return [...this.byHunter.entries()].filter(([, h]) => h.carried.length > 0).map(([id]) => id);
  }

  /** A hunter leaves the roster (death or retirement): their money and carried loot go with them. */
  forget(id: HunterId): void {
    this.byHunter.delete(id);
  }

  snapshot(): HunterHoldingsSnapshot {
    return {
      holdings: [...this.byHunter.entries()]
        .filter(([, h]) => h.money !== 0 || h.carried.length > 0)
        .map(([hunterId, h]) => ({ hunterId, money: h.money, carried: [...h.carried] })),
    };
  }

  restore(snapshot: HunterHoldingsSnapshot | undefined): void {
    this.byHunter.clear();
    for (const entry of snapshot?.holdings ?? []) {
      this.byHunter.set(entry.hunterId, { money: entry.money, carried: [...entry.carried] });
    }
  }
}
