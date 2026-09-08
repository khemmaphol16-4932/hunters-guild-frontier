/**
 * Player intents.
 *
 * REQ-TEC-010: the UI dispatches intents, it does not mutate state and it does not decide
 * rules. This is the surface it dispatches to. Every method here is something the *player*
 * legitimately does — allocate points, advance a class, equip a skill, recruit — and each
 * one delegates the actual rule to the owning system and then writes the result back to
 * the roster.
 *
 * The distinction from DebugConsole matters: debug commands may bypass rules (learning an
 * incompatible skill, jumping to level 80) because they exist to construct impossible
 * hunters for AI scenarios. Nothing here bypasses anything, so a rule cannot be
 * accidentally circumvented through the UI path.
 */

import type { Session, GenerateHunterOptions } from './Session.js';
import type { AttributeKey } from '../data/schema.js';
import { ATTRIBUTE_KEYS } from '../data/schema.js';
import { allocate, attributePointBudget, respecToBase } from '../core/hunter/leveling.js';
import {
  equippedItemIds,
  withAttributes,
  withEquipment,
  type Hunter,
} from '../core/hunter/Hunter.js';
import { asItemId, asSkillId, type HunterId, type ItemId } from '../core/ids.js';
import { err, isErr, ok, type Result } from '../core/result.js';
import type { UseSignificance } from '../systems/skills/SkillMastery.js';
import type { EquipmentSlot } from '../data/itemSchema.js';
import { socketedCards, type Item } from '../core/items/Item.js';
import { Equipment } from '../systems/items/Equipment.js';
import type { DismantleOutcome } from '../systems/items/Armoury.js';
import type { RefineResult } from '../systems/items/Refinement.js';

export class GuildCommands {
  constructor(private readonly session: Session) {}

  /** Recruit a hunter and give them a working loadout. Phase 3 replaces this with pools. */
  recruit(options: GenerateHunterOptions = {}): Hunter {
    let hunter = this.session.generateHunter(options);

    for (const skill of this.session.registry.learnableBy(hunter)) {
      const learned = this.session.knowledge.learn(hunter, asSkillId(skill.id), 'advancement');
      if (learned.ok) hunter = learned.value;
    }
    const filled = this.session.knowledge.autoFill(hunter);
    if (filled.ok) hunter = filled.value;

    this.session.roster.update(hunter);
    return hunter;
  }

  allocateAttribute(
    hunterId: HunterId,
    attribute: AttributeKey,
    amount: number,
  ): Result<Hunter, string> {
    const hunter = this.session.roster.require(hunterId);
    const balance = this.session.content.balance.attributes;
    const result = allocate(hunter.attributes, hunter.level, [{ attribute, amount }], balance);
    if (isErr(result)) return result;

    const updated = withAttributes(hunter, result.value);
    this.session.roster.update(updated);
    return ok(updated);
  }

  /** Spend every remaining point on one attribute. */
  spendAllOn(hunterId: HunterId, attribute: AttributeKey): Result<Hunter, string> {
    const hunter = this.session.roster.require(hunterId);
    const balance = this.session.content.balance.attributes;
    const spent = ATTRIBUTE_KEYS.reduce(
      (sum, key) => sum + (hunter.attributes[key] - balance.startingValue),
      0,
    );
    const remaining = attributePointBudget(hunter.level, balance) - spent;
    if (remaining <= 0) return err('no unspent attribute points');
    return this.allocateAttribute(hunterId, attribute, remaining);
  }

  /** REQ-HUN-003 — respec is cheap and available. Cost accounting arrives with Phase 7. */
  respec(hunterId: HunterId): Hunter {
    const hunter = this.session.roster.require(hunterId);
    const updated = withAttributes(hunter, respecToBase(this.session.content.balance.attributes));
    this.session.roster.update(updated);
    this.session.events.emit('hunter.respec', { hunterId });
    return updated;
  }

  advanceClass(hunterId: HunterId, classId: string): Result<Hunter, string> {
    const hunter = this.session.roster.require(hunterId);
    const result = this.session.classSystem.advance(hunter, classId);
    if (isErr(result)) return result;

    this.session.roster.update(result.value);
    const node = this.session.classSystem.node(classId);
    this.session.events.emit('hunter.advanced', {
      hunterId,
      stage: node?.stage === 'specialization' ? 'specialization' : 'advanced',
      classId,
    });
    return result;
  }

  equipSkill(hunterId: HunterId, skillId: string): Result<Hunter, string> {
    const hunter = this.session.roster.require(hunterId);
    const result = this.session.knowledge.equip(hunter, asSkillId(skillId));
    if (isErr(result)) return result;
    this.session.roster.update(result.value);
    return result;
  }

  unequipSkill(hunterId: HunterId, skillId: string): Result<Hunter, string> {
    const hunter = this.session.roster.require(hunterId);
    const result = this.session.knowledge.unequip(hunter, asSkillId(skillId));
    if (isErr(result)) return result;
    this.session.roster.update(result.value);
    return result;
  }

  /** Learn from a skill book — subject to class compatibility (REQ-CLS-004). */
  learnFromBook(hunterId: HunterId, skillId: string): Result<Hunter, string> {
    const hunter = this.session.roster.require(hunterId);
    const book = this.session.books.bookFor(asSkillId(skillId));
    if (isErr(book)) return book;

    const read = this.session.books.read(hunter, book.value);
    if (isErr(read)) return read;

    this.session.roster.update(read.value.hunter);
    return ok(read.value.hunter);
  }

  /**
   * Practise a skill, accruing mastery.
   *
   * A prototype affordance: in the finished game mastery comes from using the skill in
   * combat (REQ-MAS-002), and Phase 4 will route it through there. It is here rather than
   * in DebugConsole because it bypasses no rule — it awards exactly what real use would.
   */
  practiseSkill(
    hunterId: HunterId,
    skillId: string,
    uses: number,
    significance: UseSignificance = 'routine',
  ): Result<Hunter, string> {
    let hunter = this.session.roster.require(hunterId);
    const id = asSkillId(skillId);

    if (!hunter.knownSkills.includes(id)) {
      return err(`${hunter.name} does not know that skill`);
    }

    const aptitude = hunter.potential.facets['masteryAptitude'] ?? 1;
    for (let i = 0; i < uses; i++) {
      hunter = this.session.mastery.gainFromUse(hunter, id, significance, aptitude).hunter;
    }

    this.session.roster.update(hunter);
    return ok(hunter);
  }

  // --- Equipment ------------------------------------------------------------

  /**
   * Equip an item, moving whatever was in the slot back to the armoury.
   * Refuses an item another hunter is wearing — silently taking it would leave two
   * hunters' sheets disagreeing about who has the sword.
   */
  equipItem(hunterId: HunterId, itemId: string): Result<Hunter, string> {
    const hunter = this.session.roster.require(hunterId);
    const id = asItemId(itemId);

    const heldByOther = this.session.roster
      .all()
      .find((other) => other.id !== hunterId && equippedItemIds(other).includes(id));
    if (heldByOther) return err(`${heldByOther.name} is using that item`);

    const result = this.session.equipment.equip(hunter, id);
    if (isErr(result)) return result;

    this.session.roster.update(result.value.hunter);
    return ok(result.value.hunter);
  }

  unequipSlot(hunterId: HunterId, slot: EquipmentSlot): Result<Hunter, string> {
    const hunter = this.session.roster.require(hunterId);
    const result = this.session.equipment.unequip(hunter, slot);
    if (isErr(result)) return result;

    this.session.roster.update(result.value.hunter);
    return ok(result.value.hunter);
  }

  /** Socket a card the guild holds. Consumes one copy on success only. */
  socketCard(itemId: string, cardId: string): Result<Item, string> {
    const item = this.session.armoury.get(asItemId(itemId));
    if (!item) return err(`unknown item ${itemId}`);

    const socketed = this.session.cards.socket(item, cardId);
    if (isErr(socketed)) return socketed;

    const consumed = this.session.armoury.consumeCard(cardId);
    if (isErr(consumed)) return err(consumed.error);

    this.session.armoury.update(socketed.value);
    return ok(socketed.value);
  }

  /** Remove a card, returning it to the armoury rather than destroying it. */
  unsocketCard(itemId: string, index: number): Result<Item, string> {
    const item = this.session.armoury.get(asItemId(itemId));
    if (!item) return err(`unknown item ${itemId}`);

    const removed = this.session.cards.unsocket(item, index);
    if (isErr(removed)) return removed;

    this.session.armoury.update(removed.value.item);
    this.session.armoury.addCard(removed.value.cardId);
    return ok(removed.value.item);
  }

  /**
   * Attempt one refinement (REQ-EQP-005).
   *
   * The gold and protection cost is computed and returned but **not yet charged** — the
   * Resources system arrives in Phase 7 and owning a half-version of it here is exactly
   * the temporary architecture §126 warns against. The *risk* half of risk/reward is fully
   * live: a failed attempt can downgrade or destroy the item. Tracked in TECH_DEBT.md.
   */
  refineItem(itemId: string, useProtection = false): Result<RefineResult, string> {
    const id = asItemId(itemId);
    const item = this.session.armoury.get(id);
    if (!item) return err(`unknown item ${itemId}`);

    const options = { useProtection };
    const attempt = this.session.refinement.attempt(this.session.streams.refine, item, options);
    if (isErr(attempt)) return attempt;

    const outcome = attempt.value;
    if (outcome.kind === 'destroyed') {
      // Sockets are lost with the item; the cards in them are not.
      for (const cardId of socketedCards(item)) this.session.armoury.addCard(cardId);
      this.session.armoury.remove(id);
      this.unequipEverywhere(id);
    } else {
      this.session.armoury.update(outcome.item);
    }

    return ok(outcome);
  }

  sellItem(itemId: string): Result<{ gold: number }, string> {
    const id = asItemId(itemId);
    const equipped = Equipment.equippedIdsAcross(this.session.roster.all());
    const result = this.session.armoury.sell(id, equipped);
    if (isErr(result)) return result;
    return ok({ gold: result.value.gold });
  }

  dismantleItem(itemId: string): Result<DismantleOutcome, string> {
    const equipped = Equipment.equippedIdsAcross(this.session.roster.all());
    return this.session.armoury.dismantle(asItemId(itemId), equipped);
  }

  /** Bulk-sell everything below a rarity, skipping locked and equipped items. */
  sellJunk(rarityId: string): { gold: number; sold: number } {
    const equipped = Equipment.equippedIdsAcross(this.session.roster.all());
    const result = this.session.armoury.sellBelowRarity(rarityId, equipped);
    return { gold: result.gold, sold: result.sold };
  }

  lockItem(itemId: string, locked: boolean): Result<Item, string> {
    return this.session.armoury.setLocked(asItemId(itemId), locked);
  }

  /**
   * Generate loot into the armoury.
   *
   * A prototype affordance, like `practiseSkill`: in the finished game loot comes from
   * expeditions (Phase 5) and boss kills. It is here rather than in DebugConsole because it
   * bypasses no rule — it draws from the real generator, the real weighted table and the
   * real pity counter, so what it produces is exactly what an expedition would produce.
   */
  findLoot(count: number, itemLevel: number): readonly Item[] {
    const items = this.session.itemGenerator.generateMany(this.session.streams.loot, count, {
      itemLevel,
    });
    this.session.armoury.addMany(items);
    return items;
  }

  /**
   * Socket every card the guild holds that fits this hunter's equipped gear.
   * Convenience over `socketCard`, honouring the same compatibility rules.
   */
  socketWhatFits(hunterId: HunterId): number {
    const hunter = this.session.roster.require(hunterId);
    let socketed = 0;

    for (const equipped of this.session.equipment.equippedItems(hunter)) {
      for (const card of this.session.cards.all()) {
        if (this.session.armoury.cardCount(card.id) <= 0) continue;

        const current = this.session.armoury.get(equipped.id);
        if (!current) break;
        if (!this.session.cards.canSocket(current, card.id).ok) continue;
        if (this.socketCard(String(equipped.id), card.id).ok) socketed += 1;
      }
    }

    return socketed;
  }

  /** Clear an item out of every hunter's slots — used when it stops existing. */
  private unequipEverywhere(itemId: ItemId): void {
    for (const hunter of this.session.roster.all()) {
      if (!equippedItemIds(hunter).includes(itemId)) continue;

      const equipment = { ...hunter.equipment };
      for (const slot of Object.keys(equipment) as EquipmentSlot[]) {
        if (equipment[slot] === itemId) equipment[slot] = null;
      }
      this.session.roster.update(withEquipment(hunter, equipment));
    }
  }

  saveGuild(slot = 'autosave'): Result<unknown, string> {
    return this.session.save.save(slot, this.session.snapshot(), 'Guild');
  }

  loadGuild(slot = 'autosave'): Result<true, string> {
    const loaded = this.session.save.load(slot);
    if (isErr(loaded)) return loaded;
    this.session.restore(loaded.value);
    return ok(true);
  }
}
