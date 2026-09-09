/**
 * The guild armoury — storage, selling, dismantling and card conversion.
 *
 * Guild-wide rather than per-hunter, because REQ-EQP-004 says equipment is never bound to
 * a hunter: a per-hunter bag would make "give the new recruit the old sword" a transfer
 * operation with two failure modes instead of an equip operation with none. A hunter
 * *has* items equipped; the guild *owns* them.
 *
 * (The system map originally called this `Inventory`. Renamed once the unbound-equipment
 * requirement made the guild-wide shape obvious — recorded in SYSTEM_MAP.md.)
 */

import type { GameContent } from '../../data/loader.js';
import type { CardId, ItemId } from '../../core/ids.js';
import type { Item } from '../../core/items/Item.js';
import { itemQuality, socketedCards, withLocked } from '../../core/items/Item.js';
import { err, ok, type Result } from '../../core/result.js';

export interface ResourceGain {
  readonly resourceId: string;
  readonly amount: number;
}

export interface DismantleOutcome {
  readonly resources: readonly ResourceGain[];
  /** Cards recovered from sockets — dismantling never destroys a card. */
  readonly recoveredCards: readonly CardId[];
}

export class Armoury {
  private readonly items = new Map<ItemId, Item>();
  /** Card id -> count held loose (not socketed). */
  private readonly cardCounts = new Map<string, number>();
  /** Whether the guild has ever seen a card, for duplicate detection (REQ-CRD-003). */
  private readonly cardsSeen = new Set<string>();
  /** Constellation node ids whose skill book the guild holds (v1.0 §5). */
  private readonly skillBooks = new Set<string>();

  constructor(private readonly content: GameContent) {}

  // --- Items ----------------------------------------------------------------

  add(item: Item): void {
    this.items.set(item.id, item);
  }

  addMany(items: readonly Item[]): void {
    for (const item of items) this.add(item);
  }

  update(item: Item): void {
    if (!this.items.has(item.id)) {
      throw new Error(`Armoury: no item ${item.id} to update`);
    }
    this.items.set(item.id, item);
  }

  get(id: ItemId): Item | undefined {
    return this.items.get(id);
  }

  require(id: ItemId): Item {
    const item = this.get(id);
    if (!item) throw new Error(`Armoury: unknown item ${id}`);
    return item;
  }

  all(): readonly Item[] {
    return [...this.items.values()];
  }

  get size(): number {
    return this.items.size;
  }

  remove(id: ItemId): Item | undefined {
    const item = this.items.get(id);
    if (item) this.items.delete(id);
    return item;
  }

  setLocked(id: ItemId, locked: boolean): Result<Item, string> {
    const item = this.get(id);
    if (!item) return err(`unknown item ${id}`);
    const updated = withLocked(item, locked);
    this.items.set(id, updated);
    return ok(updated);
  }

  // --- Cards ----------------------------------------------------------------

  addCard(cardId: CardId | string): { duplicate: boolean } {
    const key = String(cardId);
    const duplicate = this.cardsSeen.has(key);
    this.cardsSeen.add(key);
    this.cardCounts.set(key, (this.cardCounts.get(key) ?? 0) + 1);
    return { duplicate };
  }

  cardCount(cardId: CardId | string): number {
    return this.cardCounts.get(String(cardId)) ?? 0;
  }

  hasSeenCard(cardId: CardId | string): boolean {
    return this.cardsSeen.has(String(cardId));
  }

  consumeCard(cardId: CardId | string): Result<true, string> {
    const key = String(cardId);
    const count = this.cardCounts.get(key) ?? 0;
    if (count <= 0) {
      const name = this.content.cardsById.get(key)?.name ?? key;
      return err(`the guild holds no copies of ${name}`);
    }
    this.cardCounts.set(key, count - 1);
    return ok(true);
  }

  loseCards(): ReadonlyMap<string, number> {
    return new Map([...this.cardCounts].filter(([, count]) => count > 0));
  }

  // --- Skill books ----------------------------------------------------------
  //
  // v1.0 §5 makes skill books a visible requirement in the constellation tree, so possession
  // has to be real state rather than assumed. Guild-wide like everything else here: a book
  // is read by whoever needs it, which is why it is a set rather than a per-hunter flag.

  addSkillBook(nodeId: string): void {
    this.skillBooks.add(nodeId);
  }

  hasSkillBook(nodeId: string): boolean {
    return this.skillBooks.has(nodeId);
  }

  skillBooksHeld(): readonly string[] {
    return [...this.skillBooks];
  }

  // --- Disposal -------------------------------------------------------------

  /**
   * Gold value of an item. Scales with rarity, level and — importantly — roll quality, so
   * a well-rolled item is worth keeping *or* worth more when sold, rather than the quality
   * being invisible the moment you decide not to use it.
   */
  sellValue(item: Item): number {
    const rarity = this.content.raritiesById.get(item.rarity);
    const base = (rarity?.dismantleValue ?? 1) * 5;
    const quality = 0.75 + itemQuality(item) * 0.5;
    return Math.round(base * item.itemLevel * quality * (1 + item.refinement * 0.1));
  }

  /** REQ-LOT-002. Refuses locked items so a bulk sell cannot eat a keeper. */
  sell(id: ItemId, equippedIds: ReadonlySet<ItemId>): Result<
    { gold: number; recoveredCards: readonly CardId[] },
    string
  > {
    const item = this.get(id);
    if (!item) return err(`unknown item ${id}`);
    if (item.locked) return err(`${item.name} is locked`);
    if (equippedIds.has(id)) return err(`${item.name} is equipped`);

    const gold = this.sellValue(item);
    const recoveredCards = socketedCards(item);
    this.items.delete(id);
    for (const cardId of recoveredCards) this.addCard(cardId);

    return ok({ gold, recoveredCards });
  }

  /** REQ-LOT-002 — dismantling yields crafting material rather than gold. */
  dismantle(id: ItemId, equippedIds: ReadonlySet<ItemId>): Result<DismantleOutcome, string> {
    const item = this.get(id);
    if (!item) return err(`unknown item ${id}`);
    if (item.locked) return err(`${item.name} is locked`);
    if (equippedIds.has(id)) return err(`${item.name} is equipped`);

    const rarity = this.content.raritiesById.get(item.rarity);
    const conversion = this.content.balance.loot.conversion;
    const amount = Math.max(1, Math.round((rarity?.dismantleValue ?? 1) * (1 + item.refinement * 0.25)));

    const recoveredCards = socketedCards(item);
    this.items.delete(id);
    for (const cardId of recoveredCards) this.addCard(cardId);

    return ok({
      resources: [{ resourceId: conversion.dismantleResourceId, amount }],
      recoveredCards,
    });
  }

  /**
   * Bulk sell every unlocked, unequipped item below a rarity threshold.
   * The single most-used quality-of-life action in a loot game, and the one most likely to
   * destroy something precious — hence locked and equipped items are excluded here rather
   * than in the UI.
   */
  sellBelowRarity(
    rarityId: string,
    equippedIds: ReadonlySet<ItemId>,
  ): { gold: number; sold: number; recoveredCards: readonly CardId[] } {
    const rank = this.content.rarities.order.indexOf(rarityId);
    let gold = 0;
    let sold = 0;
    const recovered: CardId[] = [];

    for (const item of this.all()) {
      const itemRank = this.content.rarities.order.indexOf(item.rarity);
      if (itemRank < 0 || itemRank >= rank) continue;

      const result = this.sell(item.id, equippedIds);
      if (result.ok) {
        gold += result.value.gold;
        sold += 1;
        recovered.push(...result.value.recoveredCards);
      }
    }

    return { gold, sold, recoveredCards: recovered };
  }

  // --- Persistence ----------------------------------------------------------

  snapshot(): {
    items: readonly Item[];
    cardCounts: Readonly<Record<string, number>>;
    cardsSeen: readonly string[];
    skillBooks: readonly string[];
  } {
    return {
      items: this.all(),
      cardCounts: Object.fromEntries(this.cardCounts),
      cardsSeen: [...this.cardsSeen],
      skillBooks: [...this.skillBooks],
    };
  }

  restore(state: {
    items?: readonly Item[];
    cardCounts?: Readonly<Record<string, number>>;
    cardsSeen?: readonly string[];
    skillBooks?: readonly string[];
  }): void {
    this.items.clear();
    this.cardCounts.clear();
    this.cardsSeen.clear();
    this.skillBooks.clear();

    for (const item of state.items ?? []) this.items.set(item.id, item);
    for (const [key, count] of Object.entries(state.cardCounts ?? {})) {
      this.cardCounts.set(key, count);
    }
    for (const key of state.cardsSeen ?? []) this.cardsSeen.add(key);
    for (const key of state.skillBooks ?? []) this.skillBooks.add(key);
  }

  clear(): void {
    this.items.clear();
    this.cardCounts.clear();
    this.cardsSeen.clear();
    this.skillBooks.clear();
  }
}
