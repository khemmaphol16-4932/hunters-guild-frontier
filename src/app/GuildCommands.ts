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
import {
  allocate,
  applyExperience,
  attributePointBudget,
  respecToBase,
} from '../core/hunter/leveling.js';
import {
  equippedItemIds,
  withAttributes,
  withAvailability,
  withEquipment,
  withLevel,
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
import { REASON } from '../core/audit.js';
import type { ObjectiveId, PartyProposal } from '../systems/party/Party.js';
import type { ExpeditionResult } from '../sim/expedition/Expedition.js';
import type { KnowledgeTier, RegionDef as WorldRegionDef } from '../data/combatSchema.js';
import { KNOWLEDGE_TIERS } from '../data/combatSchema.js';

/** Knowledge tiers are ordered, so "at least this well known" is a rank comparison. */
function knowledgeAtLeast(actual: KnowledgeTier, needed: KnowledgeTier): boolean {
  return KNOWLEDGE_TIERS.indexOf(actual) >= KNOWLEDGE_TIERS.indexOf(needed);
}

export interface ExpeditionOutcome {
  readonly result: ExpeditionResult;
  readonly party: PartyProposal;
  readonly loot: readonly Item[];
  readonly levelledUp: readonly HunterId[];
}

/**
 * How long an injury and an ordinary return keep a hunter off the roster.
 *
 * Coarse steps, not ticks of combat — this is guild time. Phase 6 replaces both with the
 * housing/food/services model v1.0 §4 describes; until then they are honest placeholders
 * rather than a hidden zero.
 */
const INJURY_TICKS = 2000;
const RECOVERY_TICKS = 400;

export class GuildCommands {
  constructor(private readonly session: Session) {}

  /**
   * Recruit a hunter and walk them out from their starting position.
   *
   * Takes every node currently reachable, repeatedly, because taking one node can unlock
   * another — a recruit should arrive having actually travelled their constellation rather
   * than holding only their entry node. Phase 3 replaces this with recruitment pools.
   */
  recruit(options: GenerateHunterOptions = {}): Hunter {
    let hunter = this.session.generateHunter(options);

    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const node of this.session.constellation.availableNodes(hunter)) {
        // A recruit develops toward their own territory, not into everything they can reach.
        const region = this.session.constellation.region(node.region);
        if (region && region.archetype !== hunter.archetype) continue;

        const learned = this.session.knowledge.learn(hunter, asSkillId(node.skill), 'node');
        if (learned.ok) {
          hunter = learned.value;
          progressed = true;
        }
      }
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

  /**
   * Take a constellation node — the act that replaces class advancement (v1.0 §5).
   * Learning the skill and taking the node are the same thing, so this delegates to
   * SkillKnowledge and lets the Constellation adjudicate eligibility.
   */
  takeNode(hunterId: HunterId, nodeId: string): Result<Hunter, string> {
    const hunter = this.session.roster.require(hunterId);

    const node = this.session.constellation.node(nodeId);
    if (!node) return err(`unknown constellation node "${nodeId}"`);

    const taken = this.session.constellation.canTake(hunter, nodeId);
    if (isErr(taken)) return taken;

    const learned = this.session.knowledge.learn(hunter, asSkillId(node.skill), 'node');
    if (isErr(learned)) return learned;

    this.session.roster.update(learned.value);
    this.session.events.emit('constellation.nodeTaken', {
      hunterId,
      nodeId,
      regionId: node.region,
    });
    return ok(learned.value);
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

  // --- Expeditions ----------------------------------------------------------

  /**
   * Send a party on an expedition and apply what happened to the guild.
   *
   * This is the whole vertical slice in one call, and the order is the point: the player
   * chooses a *region and an objective*, the AI proposes a party, the simulation runs, and
   * only then does the guild change. The player never picks a target, an ability or a
   * moment — they pick the strategy and read the consequences (v1.0 §1).
   *
   * `party` is optional so the UI can let the player edit the proposal before committing;
   * omitting it accepts the AI's own.
   */
  /**
   * Which regions the guild may currently go to (REQ-WLD-002).
   *
   * Every unlock axis combines with AND, per §50's "combinations of level, reputation,
   * story, capability and player choice". A locked region still appears — with the reason
   * it is locked — because §8 makes the map a knowledge interface: seeing that somewhere
   * exists and being told what it will take is itself progression, and hiding it entirely
   * would make the world feel small rather than gated.
   */
  regionAvailability(): readonly {
    readonly region: WorldRegionDef;
    readonly unlocked: boolean;
    readonly blockedBy: readonly string[];
  }[] {
    const highestLevel = this.session.roster
      .all()
      .reduce((best, hunter) => Math.max(best, hunter.level), 0);

    return this.session.content.world.regions.map((region) => {
      const blockedBy: string[] = [];
      const unlock = region.unlock;

      if (unlock) {
        if (unlock.guildLevel !== undefined && highestLevel < unlock.guildLevel) {
          blockedBy.push(`needs a hunter of level ${unlock.guildLevel} (best is ${highestLevel})`);
        }
        if (unlock.afterBoss !== undefined) {
          const defeated = this.session.worldKnowledge
            .all()
            .some((k) => k.bossDefeated && this.bossOf(k.regionId) === unlock.afterBoss);
          if (!defeated) {
            const name = this.session.content.monstersById.get(unlock.afterBoss)?.name;
            blockedBy.push(`needs ${name ?? unlock.afterBoss} dead`);
          }
        }
        if (unlock.afterKnowing !== undefined) {
          const known = this.session.worldKnowledge.of(unlock.afterKnowing.regionId);
          const needed = unlock.afterKnowing;
          if (!knowledgeAtLeast(known.tier, needed.tier)) {
            const name = this.session.content.worldRegionsById.get(needed.regionId)?.name;
            blockedBy.push(`needs ${name ?? needed.regionId} known to "${needed.tier}"`);
          }
        }
        // Reputation and capability are parsed and carried but not yet evaluable — the
        // systems that own them are Phase 6/8. Reported as such rather than silently
        // treated as satisfied, which would let a region open early and quietly.
        if (unlock.reputation !== undefined) {
          blockedBy.push(`needs ${unlock.reputation} reputation (not yet tracked)`);
        }
        if (unlock.capability !== undefined) {
          blockedBy.push(`needs the "${unlock.capability}" capability (not yet tracked)`);
        }
      }

      return { region, unlocked: blockedBy.length === 0, blockedBy };
    });
  }

  private bossOf(regionId: string): string | undefined {
    return this.session.content.worldRegionsById.get(regionId)?.boss;
  }

  sendExpedition(
    regionId: string,
    objective: ObjectiveId,
    party?: PartyProposal,
  ): Result<ExpeditionOutcome, string> {
    const region = this.session.content.worldRegionsById.get(regionId);
    if (!region) return err(`unknown region "${regionId}"`);

    // REQ-WLD-002 is a rule, so it is enforced here rather than only in the UI — the
    // difference between a disabled button and an actual gate is whether the debug console
    // and a future automation path respect it too.
    const availability = this.regionAvailability().find((a) => a.region.id === regionId);
    if (availability && !availability.unlocked) {
      return err(`${region.name} is not open to the guild: ${availability.blockedBy.join('; ')}`);
    }

    const proposal = party ?? this.session.partyPlanner.propose(this.session.roster.all(), objective);
    if (proposal.members.length === 0) return err('no hunter is available to deploy');

    // A fresh fork per expedition, labelled by region and tick, so two expeditions in the
    // same session never share a draw sequence and each one replays on its own.
    const rng = this.session.streams.expedition.fork(`${regionId}:${this.session.clock.tick}`);
    const result = this.session.expedition.run(rng, region, proposal);

    for (const decision of result.decisions) {
      this.session.audit.record({
        actor: { kind: 'system', name: 'guild-ai' },
        system: 'expedition',
        sourceEvent: `${regionId}#${decision.atNode}`,
        outcome: `${decision.choice}: ${decision.explanation}`,
        reasonCodes: decision.reasonCodes,
        inputs: { regionId, objective: proposal.objective.id },
      });
    }

    // REQ-WLD-001: permanent, and recorded whatever the outcome — the first entry also
    // emits `zone.firstEntered` through WorldKnowledge, so the Chronicle learns of it.
    this.session.worldKnowledge.record(regionId, {
      nodeKinds: result.learned.nodeKinds,
      monsters: result.learned.monsters,
      deepestNode: result.learned.deepestNode,
      bossDefeated: result.bossDefeated,
    });

    const levelledUp: HunterId[] = [];
    const balance = this.session.content.balance.attributes;

    // The guild remembers that it went (§19). Emitted before the aftermath is applied,
    // because a hunter who died out there still went on the expedition — recording it
    // afterwards would quietly drop the last run of everyone it killed.
    const durationSeconds = result.nodes.reduce((sum, n) => sum + n.encounterSeconds, 0);
    for (const after of result.aftermath) {
      this.session.events.emit('expedition.completed', {
        hunterId: after.hunterId,
        expeditionId: `${regionId}#${this.session.clock.tick}`,
        durationSeconds,
      });
    }

    for (const after of result.aftermath) {
      let hunter = this.session.roster.require(after.hunterId);

      const progress = applyExperience(hunter.level, hunter.xp, after.xp, balance);
      hunter = withLevel(hunter, progress.level, progress.xp);
      if (progress.levelsGained > 0) {
        levelledUp.push(hunter.id);
        this.session.events.emit('hunter.leveled', { hunterId: hunter.id, level: progress.level });
      }

      hunter = this.session.condition.set(hunter, {
        fatigue: hunter.condition.fatigue + after.fatigueAdded,
        // Coming home is worth something; being broken on the way costs more than it gains.
        morale:
          hunter.condition.morale +
          after.moraleChange +
          (result.wiped ? -0.2 : result.retreated ? -0.05 : 0.08),
      });

      // REQ-ZON-001 decided *whether* a hunter could die out there; this decides what the
      // guild does about it. A death removes them from the roster entirely — permanent
      // death is the whole weight behind a BLACK zone.
      if (after.died) {
        this.session.events.emit('hunter.died', {
          hunterId: hunter.id,
          zoneTier: region.zoneTier,
        });
        // Everyone else on the expedition carries it (§19). Emitted here rather than from
        // combat because permanence is the zone's ruling, and because a wipe ends the fight
        // before any downed timer expires — the encounter never sees these deaths happen.
        for (const other of result.aftermath) {
          if (other.hunterId !== after.hunterId) {
            this.session.events.emit('combat.companionLost', {
              hunterId: other.hunterId,
              lostHunterId: after.hunterId,
            });
          }
        }
        this.session.audit.record({
          actor: { kind: 'system', name: 'guild-ai' },
          system: 'expedition',
          outcome: `${hunter.name} died in ${region.name}`,
          reasonCodes: ['hunter_died', `zone:${region.zoneTier}`],
        });
        this.session.roster.remove(hunter.id);
        continue;
      }

      const availability = after.injured
        ? { state: 'injured' as const, readyAtTick: this.session.clock.tick + INJURY_TICKS }
        : { state: 'recovering' as const, readyAtTick: this.session.clock.tick + RECOVERY_TICKS };

      hunter = withAvailability(hunter, {
        ...availability,
        assignment: undefined,
        recallCompletesAtTick: undefined,
      });

      this.session.audit.record({
        actor: { kind: 'hunter', id: hunter.id },
        system: 'availability',
        outcome: `${hunter.name} returned ${after.injured ? 'injured' : 'to recover'}`,
        reasonCodes: [REASON.availabilityChanged, after.injured ? 'injured' : 'expedition_ended'],
      });

      this.session.roster.update(hunter);
    }

    // Loot is rolled once, for the guild, at the region's item level — a shared haul rather
    // than per-hunter drops, because the guild owns the armoury (§16).
    const loot =
      result.lootRolls > 0
        ? this.session.itemGenerator.generateMany(
            this.session.streams.loot,
            result.lootRolls,
            { itemLevel: region.itemLevel },
          )
        : [];
    this.session.armoury.addMany(loot);

    return ok({ result, party: proposal, loot, levelledUp });
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
