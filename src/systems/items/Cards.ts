/**
 * Cards and sockets.
 *
 * REQ-CRD-001..003. A card is compatible with an item when the item's *slot* is listed and
 * the item type carries at least one of the card's tags (an empty tag list means universal).
 * Tag matching against the item type rather than against the hunter is deliberate: it means
 * socketing a Bulwark Sigil into a stave is impossible, so a card's identity is legible
 * from the item it sits in rather than depending on who happens to be holding it — and
 * REQ-EQP-004 keeps items unbound, so the holder can change at any time.
 */

import type { CardDef, ItemEffect, ItemTypeDef } from '../../data/itemSchema.js';
import type { GameContent } from '../../data/loader.js';
import { asCardId, type CardId } from '../../core/ids.js';
import {
  emptySockets,
  socketedCards,
  withSocketed,
  type Item,
} from '../../core/items/Item.js';
import { err, ok, type Result } from '../../core/result.js';

export class Cards {
  constructor(private readonly content: GameContent) {}

  all(): readonly CardDef[] {
    return this.content.cards;
  }

  get(cardId: CardId | string): CardDef | undefined {
    return this.content.cardsById.get(cardId);
  }

  /** REQ-CRD-002 — the pool for one boss. Each boss has its own. */
  poolForBoss(bossId: string): readonly CardDef[] {
    return this.content.cards.filter(
      (c) => c.source.kind === 'boss' && c.source.bossId === bossId,
    );
  }

  bossCards(): readonly CardDef[] {
    return this.content.cards.filter((c) => c.source.kind === 'boss');
  }

  /** Would this card fit this item? Returns the reason when not, for the UI. */
  compatibility(item: Item, cardId: CardId | string): Result<CardDef, string> {
    const card = this.get(cardId);
    if (!card) return err(`unknown card "${cardId}"`);

    const type = this.content.itemTypesById.get(item.typeId);
    if (!type) return err(`item has an unknown type "${item.typeId}"`);

    if (!card.compatibleSlots.includes(item.slot)) {
      return err(`${card.name} cannot be socketed into a ${item.slot} item`);
    }

    if (card.compatibleTags.length > 0 && !this.tagsMatch(card, type)) {
      return err(`${card.name} needs an item with ${card.compatibleTags.join(' or ')} affinity`);
    }

    return ok(card);
  }

  canSocket(item: Item, cardId: CardId | string): Result<CardDef, string> {
    const compatible = this.compatibility(item, cardId);
    if (!compatible.ok) return compatible;

    if (emptySockets(item) === 0) {
      return err(
        item.socketed.length === 0
          ? `${item.name} has no sockets`
          : `${item.name} has no empty sockets`,
      );
    }

    if (socketedCards(item).includes(asCardId(String(cardId)))) {
      // Two copies of the same card in one item would double an effect the designer
      // balanced as a single instance.
      return err(`${compatible.value.name} is already socketed into ${item.name}`);
    }

    return ok(compatible.value);
  }

  socket(item: Item, cardId: CardId | string): Result<Item, string> {
    const allowed = this.canSocket(item, cardId);
    if (!allowed.ok) return err(allowed.error);

    const socketed = [...item.socketed];
    const index = socketed.indexOf(null);
    if (index < 0) return err(`${item.name} has no empty sockets`);

    socketed[index] = asCardId(String(cardId));
    return ok(withSocketed(item, socketed));
  }

  /** Remove a card, returning it so the caller can put it back into the armoury. */
  unsocket(item: Item, index: number): Result<{ item: Item; cardId: CardId }, string> {
    const existing = item.socketed[index];
    if (existing === undefined) return err(`${item.name} has no socket ${index}`);
    if (existing === null) return err(`socket ${index} of ${item.name} is empty`);

    const socketed = [...item.socketed];
    socketed[index] = null;
    return ok({ item: withSocketed(item, socketed), cardId: existing });
  }

  definitionsIn(item: Item): readonly CardDef[] {
    const defs: CardDef[] = [];
    for (const cardId of socketedCards(item)) {
      const def = this.get(cardId);
      if (def) defs.push(def);
    }
    return defs;
  }

  effectsIn(item: Item): readonly ItemEffect[] {
    return this.definitionsIn(item).flatMap((def) => def.effects);
  }

  /**
   * REQ-CRD-003: a duplicate must have a useful outcome. A duplicate boss card converts to
   * an essence currency which buys a card of the player's choosing, so a 0.5% drop is never
   * a dead end even when it is the one you already have.
   */
  duplicateConversion(cardId: CardId | string): Result<
    { resourceId: string; amount: number },
    string
  > {
    const card = this.get(cardId);
    if (!card) return err(`unknown card "${cardId}"`);

    const conversion = this.content.balance.loot.conversion;
    if (card.source.kind !== 'boss') {
      return ok({ resourceId: conversion.dismantleResourceId, amount: 1 });
    }
    return ok({
      resourceId: conversion.duplicateCardResourceId,
      amount: conversion.duplicateCardValue,
    });
  }

  /** Essence cost of buying a chosen card outright. */
  purchaseCost(): { resourceId: string; amount: number } {
    const conversion = this.content.balance.loot.conversion;
    return {
      resourceId: conversion.duplicateCardResourceId,
      amount: conversion.cardPurchaseCost,
    };
  }

  private tagsMatch(card: CardDef, type: ItemTypeDef): boolean {
    return card.compatibleTags.some((tag) => tag in type.skillAffinity);
  }
}
