/**
 * Set bonuses.
 *
 * REQ-EQP-006: bonuses at 2, 3 and 4 pieces, and sets must not invalidate normal equipment.
 *
 * The second half of that requirement is the harder one, and it is honoured by what set
 * bonuses *are* rather than by tuning: every tier here grants behaviour (cheaper defensive
 * skills, a longer rescue window, a shifted AI weight) instead of a large flat stat. A
 * better-rolled non-set item therefore competes on stats and loses only the behaviour,
 * which keeps the choice live. Tests assert the no-flat-stat property so a future set
 * cannot quietly break it.
 *
 * All applicable tiers stack — a 4-piece set also grants its 2- and 3-piece bonuses, which
 * is what makes the fourth piece feel like a completion rather than a replacement.
 */

import type { ItemEffect, SetDef, SetTierDef } from '../../data/itemSchema.js';
import type { GameContent } from '../../data/loader.js';
import type { Item } from '../../core/items/Item.js';

export interface ActiveSet {
  readonly set: SetDef;
  readonly pieces: number;
  /** Every tier whose piece requirement is met. */
  readonly tiers: readonly SetTierDef[];
}

export class Sets {
  constructor(private readonly content: GameContent) {}

  all(): readonly SetDef[] {
    return this.content.sets;
  }

  get(setId: string): SetDef | undefined {
    return this.content.setsById.get(setId);
  }

  /** Count equipped pieces per set. */
  pieceCounts(items: readonly Item[]): ReadonlyMap<string, number> {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (!item.setId) continue;
      counts.set(item.setId, (counts.get(item.setId) ?? 0) + 1);
    }
    return counts;
  }

  /** Which sets are active, and which of their tiers are met. */
  active(items: readonly Item[]): readonly ActiveSet[] {
    const out: ActiveSet[] = [];

    for (const [setId, pieces] of this.pieceCounts(items)) {
      const set = this.get(setId);
      if (!set) continue;

      const tiers = set.tiers.filter((tier) => pieces >= tier.pieces);
      if (tiers.length === 0) continue;

      out.push({ set, pieces, tiers });
    }

    return out;
  }

  effects(items: readonly Item[]): readonly ItemEffect[] {
    return this.active(items).flatMap((entry) => entry.tiers.flatMap((tier) => tier.effects));
  }

  /** Player-readable summary, including the next tier so progress is visible. */
  describe(items: readonly Item[]): readonly string[] {
    const lines: string[] = [];

    for (const [setId, pieces] of this.pieceCounts(items)) {
      const set = this.get(setId);
      if (!set) continue;

      const met = set.tiers.filter((t) => pieces >= t.pieces);
      const next = set.tiers.find((t) => pieces < t.pieces);

      lines.push(`${set.name} (${pieces} piece${pieces === 1 ? '' : 's'})`);
      for (const tier of met) lines.push(`  ${tier.pieces}: ${tier.description}`);
      if (next) {
        lines.push(`  ${next.pieces} (${next.pieces - pieces} more): ${next.description}`);
      }
    }

    return lines;
  }
}
