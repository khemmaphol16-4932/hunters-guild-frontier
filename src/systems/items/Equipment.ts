/**
 * Equipping, and the stat and effect totals that follow from it.
 *
 * REQ-EQP-001/002. Main stats are computed here rather than stored on the item:
 *
 *   mainStat = coefficient(type) x itemLevel x rarityMultiplier x (1 + refinement bonus)
 *
 * So a blade's attack comes from what a blade *is*, scaled by how good and how refined this
 * particular blade happens to be. Refinement touches only main stats (REQ-EQP-005 in
 * refinement.json), which is what stops refinement from laundering a badly-rolled item.
 *
 * Aggregation is the single place the rest of the game asks "what is this hunter actually
 * wearing worth?", so Phase 4 combat and the build dashboard cannot disagree about it.
 */

import type { EquipmentSlot, ItemEffect, RefinementBalance } from '../../data/itemSchema.js';
import type { GameContent } from '../../data/loader.js';
import type { ItemId } from '../../core/ids.js';
import type { Hunter } from '../../core/hunter/Hunter.js';
import { equippedItemIds, withEquipment } from '../../core/hunter/Hunter.js';
import type { Item } from '../../core/items/Item.js';
import { Substats } from './Substats.js';
import { err, ok, type Result } from '../../core/result.js';
import type { Armoury } from './Armoury.js';
import type { Cards } from './Cards.js';
import type { Sets } from './Sets.js';

export interface EquipOutcome {
  readonly hunter: Hunter;
  /** The item displaced from the slot, if any. It returns to the armoury unequipped. */
  readonly displaced: Item | undefined;
}

export interface EquipmentDeps {
  readonly content: GameContent;
  readonly armoury: Armoury;
  readonly cards: Cards;
  readonly sets: Sets;
}

export class Equipment {
  private readonly content: GameContent;
  private readonly armoury: Armoury;
  private readonly cards: Cards;
  private readonly sets: Sets;
  private readonly refinement: RefinementBalance;

  constructor(deps: EquipmentDeps) {
    this.content = deps.content;
    this.armoury = deps.armoury;
    this.cards = deps.cards;
    this.sets = deps.sets;
    this.refinement = deps.content.balance.refinement;
  }

  // --- Equipping ------------------------------------------------------------

  equip(hunter: Hunter, itemId: ItemId): Result<EquipOutcome, string> {
    const item = this.armoury.get(itemId);
    if (!item) return err(`unknown item ${itemId}`);

    // An item equipped by someone else must be unequipped first — silently stealing it
    // would make two hunters' sheets disagree about who has the sword.
    const displacedId = hunter.equipment[item.slot];
    const displaced = displacedId !== null ? this.armoury.get(displacedId) : undefined;

    if (displacedId === itemId) return err(`${item.name} is already equipped`);

    return ok({
      hunter: withEquipment(hunter, { ...hunter.equipment, [item.slot]: itemId }),
      displaced,
    });
  }

  unequip(hunter: Hunter, slot: EquipmentSlot): Result<EquipOutcome, string> {
    const itemId = hunter.equipment[slot];
    if (itemId === null) return err(`nothing is equipped in the ${slot} slot`);

    return ok({
      hunter: withEquipment(hunter, { ...hunter.equipment, [slot]: null }),
      displaced: this.armoury.get(itemId),
    });
  }

  equippedItems(hunter: Hunter): readonly Item[] {
    const items: Item[] = [];
    for (const id of equippedItemIds(hunter)) {
      const item = this.armoury.get(id);
      if (item) items.push(item);
    }
    return items;
  }

  /** Every item id equipped by anyone — the guard for selling and dismantling. */
  static equippedIdsAcross(hunters: readonly Hunter[]): ReadonlySet<ItemId> {
    const ids = new Set<ItemId>();
    for (const hunter of hunters) {
      for (const id of equippedItemIds(hunter)) ids.add(id);
    }
    return ids;
  }

  /** Items in the armoury that nobody has equipped. */
  availableFor(hunter: Hunter, slot: EquipmentSlot, allHunters: readonly Hunter[]): readonly Item[] {
    const taken = Equipment.equippedIdsAcross(allHunters.filter((h) => h.id !== hunter.id));
    return this.armoury
      .all()
      .filter((item) => item.slot === slot && !taken.has(item.id));
  }

  // --- Derived values -------------------------------------------------------

  /** The fixed main stats of one item, scaled by rarity, level and refinement. */
  mainStats(item: Item): Readonly<Record<string, number>> {
    const type = this.content.itemTypesById.get(item.typeId);
    const rarity = this.content.raritiesById.get(item.rarity);
    if (!type || !rarity) return {};

    const refineBonus = 1 + item.refinement * this.refinement.mainStatBonusPerLevel;
    const scale = item.itemLevel * rarity.mainStatMultiplier * refineBonus;

    const out: Record<string, number> = {};
    for (const [stat, coefficient] of Object.entries(type.mainStats)) {
      out[stat] = coefficient * scale;
    }
    return out;
  }

  /** Main plus substats for one item. */
  statsOf(item: Item): Readonly<Record<string, number>> {
    const out: Record<string, number> = { ...this.mainStats(item) };
    for (const [stat, value] of Object.entries(Substats.aggregate(item.substats))) {
      out[stat] = (out[stat] ?? 0) + value;
    }
    return out;
  }

  /**
   * Everything a hunter's equipment contributes to their stats.
   * Fed to `computeDerivedStats` as flat modifiers, so gear and attributes meet in exactly
   * one place (REQ-CBT-002 — understandable outside, layered inside).
   */
  aggregateStats(hunter: Hunter): Readonly<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const item of this.equippedItems(hunter)) {
      for (const [stat, value] of Object.entries(this.statsOf(item))) {
        out[stat] = (out[stat] ?? 0) + value;
      }
    }
    return out;
  }

  /**
   * Every declarative effect from equipment: unique legendary effects, socketed cards and
   * set bonuses. Phase 4 combat and AI read this one list rather than three.
   */
  aggregateEffects(hunter: Hunter): readonly ItemEffect[] {
    const items = this.equippedItems(hunter);
    const effects: ItemEffect[] = [];

    for (const item of items) {
      if (item.uniqueEffectId) {
        const unique = this.content.uniqueEffectsById.get(item.uniqueEffectId);
        if (unique) effects.push(...unique.effects);
      }
      effects.push(...this.cards.effectsIn(item));
    }

    effects.push(...this.sets.effects(items));
    return effects;
  }

  /**
   * Merge effects of the same kind so consumers see one number per (type, qualifier).
   * Additive rather than multiplicative: two cards each granting +0.2 to a tag give +0.4,
   * which is the reading a player will assume, and keeps stacking legible.
   */
  static mergeEffects(effects: readonly ItemEffect[]): readonly ItemEffect[] {
    const merged = new Map<string, ItemEffect>();

    for (const effect of effects) {
      const key = [effect.type, effect.tag ?? '', effect.key ?? '', effect.status ?? ''].join('|');
      const existing = merged.get(key);
      merged.set(key, existing ? { ...existing, value: existing.value + effect.value } : effect);
    }

    return [...merged.values()];
  }

  /** Total gold value of what a hunter is wearing — used by the dashboard and the market. */
  equippedValue(hunter: Hunter): number {
    let total = 0;
    for (const item of this.equippedItems(hunter)) total += this.armoury.sellValue(item);
    return total;
  }
}
