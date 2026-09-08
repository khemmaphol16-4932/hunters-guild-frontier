/**
 * The Item entity.
 *
 * REQ-EQP-001..004. Two decisions worth stating outright:
 *
 * 1. **Main stats are derived, not stored.** An item persists its type, rarity, level and
 *    refinement; its main stats are computed from those plus the balance data. So retuning
 *    a blade's attack coefficient updates every blade already in every save, which is what
 *    REQ-TEC-002 is for. Substats are the opposite — they are *rolls*, so they are stored.
 *
 * 2. **Nothing here references a hunter.** REQ-EQP-004 makes all equipment tradable and
 *    never bound, so an item has no owner field; ownership is a property of the roster and
 *    the hunter's equipment map, not of the item.
 */

import type { CardId, ItemId } from '../ids.js';
import type { EquipmentSlot } from '../../data/itemSchema.js';

export interface SubstatRoll {
  readonly stat: string;
  readonly value: number;
  /** Where in its range this roll landed, 0..1. This is what makes two copies differ. */
  readonly quality: number;
}

export interface Item {
  readonly id: ItemId;
  /** Item type definition id — determines the slot and the fixed main stats. */
  readonly typeId: string;
  readonly name: string;
  readonly slot: EquipmentSlot;
  readonly rarity: string;
  readonly itemLevel: number;

  readonly substats: readonly SubstatRoll[];
  /** Fixed-length; null is an empty socket. */
  readonly socketed: readonly (CardId | null)[];

  readonly refinement: number;
  readonly setId: string | undefined;
  /** REQ-EQP-007 — legendary only. */
  readonly uniqueEffectId: string | undefined;

  /** Player flag: protects an item from bulk sell and dismantle. */
  readonly locked: boolean;
}

export function socketCount(item: Item): number {
  return item.socketed.length;
}

export function filledSockets(item: Item): number {
  return item.socketed.filter((c): c is CardId => c !== null).length;
}

export function emptySockets(item: Item): number {
  return socketCount(item) - filledSockets(item);
}

export function socketedCards(item: Item): readonly CardId[] {
  return item.socketed.filter((c): c is CardId => c !== null);
}

/**
 * Mean substat roll quality, 0..1.
 *
 * REQ-EQP-021: two copies of the same item can be worth very different amounts, and this
 * is the number that says so. It is deliberately the mean rather than the sum, so a
 * five-substat legendary and a three-substat rare are on the same scale.
 */
export function itemQuality(item: Item): number {
  if (item.substats.length === 0) return 0;
  let total = 0;
  for (const roll of item.substats) total += roll.quality;
  return total / item.substats.length;
}

/** REQ-EQP-003 — possible, extremely rare, never required. */
export function isPerfect(item: Item, perfectThreshold: number): boolean {
  if (item.substats.length === 0) return false;
  return item.substats.every((roll) => roll.quality >= perfectThreshold);
}

export function withRefinement(item: Item, refinement: number): Item {
  return { ...item, refinement: Math.max(0, Math.floor(refinement)) };
}

export function withSocketed(item: Item, socketed: readonly (CardId | null)[]): Item {
  return { ...item, socketed };
}

export function withLocked(item: Item, locked: boolean): Item {
  return { ...item, locked };
}
