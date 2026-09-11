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
  respecCost,
} from '../core/hunter/leveling.js';
import {
  equippedItemIds,
  withAttributes,
  withAvailability,
  withTraits,
  withEquipment,
  withLevel,
  type Hunter,
} from '../core/hunter/Hunter.js';
import { asItemId, asSkillId, asTraitId, type HunterId, type ItemId } from '../core/ids.js';
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
import type { Rotation, TownDepartmentId } from '../data/townSchema.js';
import type { Placement } from '../systems/town/TownGrid.js';
import type { DepartmentState } from '../systems/town/Departments.js';
import type { ResearchNodeDef } from '../data/researchSchema.js';
import type { Candidate, RecruitmentAdvice } from '../core/town/recruitment.js';
import { analysePool } from '../ai/town/guildFit.js';
import type { DefenseResult, HuntResult } from '../sim/town/TownCombat.js';
import type { EconomyReward } from '../data/economySchema.js';
import type { FoodReport } from '../systems/economy/Food.js';
import type { CraftOrder, CraftPreview } from '../systems/economy/Crafting.js';
import type { MarketQuote } from '../systems/economy/Market.js';
import type { ContractAnalysis, ContractOffer, LockedContract } from '../systems/economy/Contracts.js';
import type { LegacyUnlock } from '../systems/progression/Legacy.js';
import type { MentorProfile } from '../systems/progression/Mentors.js';
import type { NewGamePlusOptions } from '../systems/progression/NewGamePlus.js';
import type { RecordOutcome } from '../systems/progression/EndlessRecords.js';
import { traitMultiplier } from '../systems/hunter/traitEffects.js';
import type { EndlessObjectiveDef } from '../data/endlessSchema.js';
import type { WorldBossEvent } from '../systems/world/WorldEvents.js';
import { ReportRecorder, type GuildReport } from './GuildReport.js';
import type { StandingOrder } from '../systems/guild/StandingOrders.js';
import { OBJECTIVES } from '../systems/party/Party.js';

/** Knowledge tiers are ordered, so "at least this well known" is a rank comparison. */
function knowledgeAtLeast(actual: KnowledgeTier, needed: KnowledgeTier): boolean {
  return KNOWLEDGE_TIERS.indexOf(actual) >= KNOWLEDGE_TIERS.indexOf(needed);
}

export interface ExpeditionOutcome {
  readonly result: ExpeditionResult;
  readonly party: PartyProposal;
  readonly loot: readonly Item[];
  readonly levelledUp: readonly HunterId[];
  readonly resources: EconomyReward;
  /** Present for an endless run: whether it set a personal record (REQ-END-003). */
  readonly record?: RecordOutcome;
}

/**
 * Injury and recovery durations used to be two flat constants here — `INJURY_TICKS = 2000`
 * and `RECOVERY_TICKS = 400` — with a note promising Phase 6 would replace them with the
 * housing/food/services model v1.0 §4 describes. Phase 6 has, and they are gone:
 * `session.recovery.estimate()` computes both from the actual town.
 */

export class GuildCommands {
  constructor(private readonly session: Session) {}

  private get masteryPoints() {
    return this.session.content.progression.guildMastery.activityPoints;
  }

  purchaseLegacyUnlock(unlockId: string): Result<LegacyUnlock, string> {
    const result = this.session.legacy.purchase(unlockId);
    if (result.ok) {
      this.session.audit.record({
        actor: { kind: 'player' },
        system: 'legacy',
        outcome: `unlocked ${result.value.name}`,
        reasonCodes: ['legacy_unlock', `unlock:${result.value.id}`],
        inputs: { cost: result.value.cost, category: result.value.category },
      });
    }
    return result;
  }

  retireHunter(hunterId: HunterId): Result<MentorProfile, string> {
    if (!this.session.legacy.has('mentor_hall')) return err('the Mentor Hall Legacy unlock is required');
    const hunter = this.session.roster.get(hunterId);
    if (!hunter) return err(`unknown hunter ${hunterId}`);
    const minLevel = this.session.content.progression.retirement.minLevel;
    if (hunter.level < minLevel) return err(`${hunter.name} must reach level ${minLevel} before retiring`);
    if (hunter.availability.state !== 'available') return err(`${hunter.name} is not available to retire`);

    this.session.townJobs.release(hunter.id);
    // REQ-LEG-004: the historic entries in their Chronicle become the Legacy Traits they can
    // pass on. Resolved against content, so only a trait that exists can be inherited.
    const historicKinds = new Set(this.session.chronicle.entriesAtLevel(hunter.id, 'historic').map((entry) => entry.kind));
    const legacyTraits = this.session.content.traits
      .filter((trait) => trait.origin === 'legacy' && trait.fromChronicle !== undefined && historicKinds.has(trait.fromChronicle))
      .map((trait) => trait.id);
    const mentor = this.session.mentors.retire(hunter, legacyTraits);
    this.session.roster.remove(hunter.id);
    this.session.friendship.forget(hunter.id);
    this.session.audit.record({
      actor: { kind: 'player' },
      system: 'legacy',
      outcome: `${hunter.name} retired as a ${mentor.speciality} mentor`,
      reasonCodes: ['hunter_retired', `hunter:${hunter.id}`],
      inputs: { level: hunter.level, legacyTraits: mentor.legacyTraits },
    });
    return ok(mentor);
  }

  /**
   * Found a new guild: the starting roster and the starting town.
   *
   * Used by a brand-new save and by every New Game+ cycle. It lived in `main.ts` until New
   * Game+ needed it too, and New Game+ shipped without it, opening on an empty grid with no
   * Guild Hall and nobody to send anywhere (DL-048).
   */
  foundGuild(options: { readonly extraRecruit?: GenerateHunterOptions } = {}): readonly Hunter[] {
    // Two Vanguards who will be built differently, plus one of each other archetype. Two
    // same-class hunters are here specifically so REQ-BLD-003 can be inspected on first load.
    const roster = [
      this.recruit({ archetype: 'vanguard', personality: 'stoic' }),
      this.recruit({ archetype: 'vanguard', personality: 'reckless' }),
      this.recruit({ archetype: 'adept', personality: 'protective' }),
      this.recruit({ archetype: 'ranger', personality: 'opportunist' }),
    ];
    if (options.extraRecruit) roster.push(this.recruit(options.extraRecruit));
    this.foundTown();
    this.session.town.refreshStage();
    this.session.townJobs.refresh();
    return roster;
  }

  /**
   * A mentor takes on an apprentice (v1.0 §11 generational play, REQ-LEG-004).
   *
   * The apprentice is a new recruit, developed like any other, who may inherit one of the
   * mentor's Legacy Traits. That inheritance is the explicit conversion REQ-CHR-003 requires
   * before history may become mechanical: the player chose this mentor and this trait.
   */
  takeApprentice(mentorId: string, legacyTraitId?: string): Result<Hunter, string> {
    const mentor = this.session.mentors.get(mentorId);
    if (!mentor) return err('that hunter is not a mentor');
    const rules = this.session.content.progression.apprentices;
    if (this.session.mentors.apprenticesOf(mentorId) >= rules.perMentor) {
      return err(`${mentor.name} has already trained ${rules.perMentor === 1 ? 'an apprentice' : `${rules.perMentor} apprentices`}`);
    }
    if (legacyTraitId !== undefined && !mentor.legacyTraits.includes(legacyTraitId)) {
      return err(`${mentor.name} has no Legacy Trait "${legacyTraitId}" to pass on`);
    }
    const trait = legacyTraitId === undefined ? undefined : this.session.content.traitsById.get(legacyTraitId);
    if (legacyTraitId !== undefined && trait?.origin !== 'legacy') return err(`"${legacyTraitId}" is not a Legacy Trait`);

    const paid = this.session.resources.transact({ debits: { gold: rules.goldCost } });
    if (isErr(paid)) return err(paid.error);

    let apprentice = this.recruit({});
    if (trait) {
      apprentice = withTraits(apprentice, [...apprentice.traitIds, asTraitId(trait.id)]);
      this.session.roster.update(apprentice);
    }
    this.session.mentors.recordApprentice(mentorId);
    this.session.townJobs.refresh();
    this.session.audit.record({
      actor: { kind: 'player' },
      system: 'legacy',
      outcome: `${apprentice.name} apprenticed to ${mentor.name}` + (trait ? `, inheriting ${trait.name}` : ''),
      reasonCodes: ['apprentice_taken', `mentor:${mentorId}`, ...(trait ? [`trait:${trait.id}`] : [])],
    });
    return ok(apprentice);
  }

  beginNewGamePlus(options: NewGamePlusOptions = {}): Result<number, string> {
    const result = this.session.beginNewGamePlus(options);
    if (result.ok) {
      const archetype = options.archetype === undefined
        ? undefined
        : this.session.content.progression.newGamePlus.archetypes[options.archetype];
      this.foundGuild(
        archetype
          ? { extraRecruit: { archetype: archetype.archetype, preferredDepartment: archetype.preferredDepartment as TownDepartmentId } }
          : {},
      );
      this.session.audit.record({ actor: { kind: 'player' }, system: 'legacy', outcome: `began New Game+ cycle ${result.value}`, reasonCodes: ['new_game_plus'], inputs: { ...options } });
    }
    return result;
  }

  marketQuote(resourceId: string, amount: number, side: 'buy' | 'sell'): Result<MarketQuote, string> {
    if (this.session.town.grid.countOf('market_stall') === 0) return err('the town has no Market Stall');
    return this.session.market.quote(resourceId, amount, side);
  }
  buyFromMarket(resourceId: string, amount: number): Result<MarketQuote, string> {
    if (this.session.town.grid.countOf('market_stall') === 0) return err('the town has no Market Stall');
    return this.session.market.buy(resourceId, amount);
  }
  sellToMarket(resourceId: string, amount: number): Result<MarketQuote, string> {
    if (this.session.town.grid.countOf('market_stall') === 0) return err('the town has no Market Stall');
    return this.session.market.sell(resourceId, amount);
  }
  contractBoard(): readonly ContractAnalysis[] {
    // First sight of the board fills it; after that, clients post on the town clock.
    const offers = this.session.contracts.available().length > 0
      ? this.session.contracts.available()
      : this.postContracts();
    return offers.map((offer) => this.session.contracts.analyse(offer));
  }

  /** Work the guild is not yet trusted with, and what it would take (REQ-CON-001 tiers). */
  lockedContracts(): readonly LockedContract[] {
    return this.session.contracts.locked();
  }

  private postContracts(): readonly ContractOffer[] {
    const rng = this.session.streams.world.fork(`contracts:${this.session.clock.tick}`);
    return this.session.contracts.refresh(rng);
  }

  /**
   * Fit a party to an active challenge contract (REQ-END-004).
   *
   * When the player lets the planner choose, the planner is given only the hunters the
   * contract allows and the party is trimmed to its size. A party the player chose is
   * checked, never altered: the contract refuses it with the reasons.
   */
  private shapeForChallenge(
    contract: ContractOffer | undefined,
    objective: ObjectiveId,
    party: PartyProposal | undefined,
  ): Result<PartyProposal, string> {
    const roster = this.session.roster.all();
    if (!contract?.challenge) {
      return ok(party ?? this.session.partyPlanner.propose(roster, objective));
    }
    const challenge = contract.challenge;
    let proposal = party;
    if (!proposal) {
      const allowed = challenge.maxMemberLevel === undefined
        ? roster
        : roster.filter((hunter) => hunter.level <= challenge.maxMemberLevel!);
      const planned = this.session.partyPlanner.propose(allowed, objective);
      const forbidden = new Set(challenge.forbiddenRoles ?? []);
      const kept = planned.members
        .filter((member) => !forbidden.has(member.role))
        .slice(0, challenge.maxPartySize ?? planned.members.length);
      proposal = kept.length === planned.members.length
        ? planned
        : { ...planned, members: kept, summary: `${planned.summary} Shaped to the terms of ${contract.name}.` };
    }
    const problems = this.session.contracts.challengeViolations(
      contract,
      proposal.members.map((member) => ({
        name: member.name,
        role: member.role,
        level: this.session.roster.get(member.hunterId)?.level ?? 0,
      })),
    );
    if (problems.length > 0) {
      return err(`${contract.name} refuses this party: ${problems.join('; ')}. Change the party or abandon the contract.`);
    }
    return ok(proposal);
  }
  acceptContract(offerId: string): Result<ContractOffer, string> {
    const result = this.session.contracts.accept(offerId);
    if (result.ok) {
      this.session.audit.record({
        actor: { kind: 'player' },
        system: 'contracts',
        outcome: `accepted ${result.value.name} from ${result.value.clientName}`,
        reasonCodes: ['contract_accepted', `faction:${result.value.factionId}`],
      });
    }
    return result;
  }

  /** Walk away from the active contract. The client remembers (REQ-FAC-001). */
  abandonContract(): Result<ContractOffer, string> {
    const result = this.session.contracts.abandon();
    if (!result.ok) return result;
    const standing = this.session.factions.change(result.value.factionId, this.session.content.contracts.standing.abandon);
    this.session.audit.record({
      actor: { kind: 'player' },
      system: 'contracts',
      outcome: `abandoned ${result.value.name}; ${result.value.clientName} standing now ${standing}`,
      reasonCodes: ['contract_abandoned', `faction:${result.value.factionId}`],
    });
    return result;
  }

  craftingPreview(recipeId: string, crafterId: HunterId): Result<CraftPreview, string> {
    const crafter = this.session.roster.get(crafterId);
    if (!crafter) return err(`unknown hunter ${crafterId}`);
    return this.session.crafting.preview(recipeId, crafter);
  }

  craftItem(recipeId: string, crafterId: HunterId): Result<CraftOrder, string> {
    const crafter = this.session.roster.get(crafterId);
    if (!crafter) return err(`unknown hunter ${crafterId}`);
    if (crafter.availability.state !== 'available') return err(`${crafter.name} is not available to craft`);
    const result = this.session.crafting.start(this.session.streams.crafting, recipeId, crafter);
    if (!result.ok) return result;
    const order = result.value.order;
    this.session.roster.update(withAvailability(crafter, { state: 'assigned', assignment: order.id, recallCompletesAtTick: undefined, readyAtTick: order.readyAtTick }));
    this.session.townJobs.release(crafter.id);
    this.session.audit.record({ actor: { kind: 'hunter', id: crafter.id }, system: 'crafting', outcome: `${crafter.name} began ${result.value.preview.recipe.name}`, reasonCodes: ['crafting_started', `recipe:${recipeId}`], inputs: { durationSteps: result.value.preview.durationSteps, cost: result.value.preview.recipe.cost } });
    this.session.guildMastery.record('crafting', this.masteryPoints.craftStarted);
    return ok(order);
  }

  /**
   * Recruit a hunter and walk them out from their starting position.
   *
   * Takes every node currently reachable, repeatedly, because taking one node can unlock
   * another — a recruit should arrive having actually travelled their constellation rather
   * than holding only their entry node. The Recruitment Hall path is `hireRecruit`; this
   * remains for the composition root's starting roster and for tests.
   */
  recruit(options: GenerateHunterOptions = {}): Hunter {
    return this.developRecruit(this.session.generateHunter(options));
  }

  /**
   * Walk a new hunter out from their starting position in the constellation.
   *
   * Takes every node currently reachable, repeatedly, because taking one node can unlock
   * another — a recruit should arrive having actually travelled their constellation rather
   * than holding only their entry node.
   *
   * Shared by the prototype `recruit` path and by `hireRecruit`, so somebody hired from the
   * Recruitment Hall is developed exactly like anyone else. Two divergent versions of "what
   * a new hunter knows" would be a very quiet bug.
   */
  private developRecruit(recruit: Hunter): Hunter {
    let hunter = recruit;

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

  /** What a respec to base would cost this hunter, in the respec resource. */
  respecPrice(hunterId: HunterId): { readonly resourceId: string; readonly amount: number } {
    const hunter = this.session.roster.require(hunterId);
    const balance = this.session.content.balance.attributes;
    return {
      resourceId: balance.respec.resourceId,
      amount: respecCost(hunter.attributes, respecToBase(balance), balance, hunter.level),
    };
  }

  /**
   * REQ-HUN-003 — respec is cheap and available, paid in Insight Crystals.
   *
   * The comment here used to say cost accounting arrives with Phase 7, and TECH_DEBT recorded
   * Phase 7 as having wired every price. This one was missed, and the resource it names had
   * no source anywhere in the game.
   */
  respec(hunterId: HunterId): Result<Hunter, string> {
    const hunter = this.session.roster.require(hunterId);
    const price = this.respecPrice(hunterId);
    if (price.amount > 0) {
      const paid = this.session.resources.transact({ debits: { [price.resourceId]: price.amount } });
      if (isErr(paid)) return err(paid.error);
    }
    const updated = withAttributes(hunter, respecToBase(this.session.content.balance.attributes));
    this.session.roster.update(updated);
    this.session.events.emit('hunter.respec', { hunterId });
    return ok(updated);
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

    // Mentors' mastery training and training efficiency both apply here, capped together,
    // and so does the hunter's own aptitude for learning — innate (Quick Study) or inherited
    // (Wardenbane).
    const aptitude =
      (hunter.potential.facets['masteryAptitude'] ?? 1) *
      this.session.mentors.practiceScale() *
      traitMultiplier(hunter, this.session.content.traitsById, 'masteryGainMultiplier');
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
   * The ledger charges before the roll, so failure is a real gold sink and reloading cannot
   * turn an unaffordable attempt into a free random draw.
   */
  refineItem(itemId: string, useProtection = false): Result<RefineResult, string> {
    const id = asItemId(itemId);
    const item = this.session.armoury.get(id);
    if (!item) return err(`unknown item ${itemId}`);

    const options = { useProtection };
    if (this.session.refinement.isAtMax(item)) {
      return err(`${item.name} is already at maximum refinement`);
    }
    const cost = this.session.refinement.cost(item, options);
    const debits: Record<string, number> = { gold: cost.gold };
    if (cost.protection) debits[cost.protection.resourceId] = cost.protection.amount;
    const paid = this.session.resources.transact({ debits });
    if (isErr(paid)) return err(paid.error);
    const attempt = this.session.refinement.attempt(this.session.streams.refine, item, options);
    if (isErr(attempt)) {
      this.session.resources.transact({ credits: debits });
      return attempt;
    }

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
    this.session.resources.transact({ credits: { gold: result.value.gold } });
    return ok({ gold: result.value.gold });
  }

  dismantleItem(itemId: string): Result<DismantleOutcome, string> {
    const equipped = Equipment.equippedIdsAcross(this.session.roster.all());
    const result = this.session.armoury.dismantle(asItemId(itemId), equipped);
    if (isErr(result)) return result;
    this.session.resources.transact({
      credits: Object.fromEntries(result.value.resources.map((gain) => [gain.resourceId, gain.amount])),
    });
    return result;
  }

  /** Bulk-sell everything below a rarity, skipping locked and equipped items. */
  sellJunk(rarityId: string): { gold: number; sold: number } {
    const equipped = Equipment.equippedIdsAcross(this.session.roster.all());
    const result = this.session.armoury.sellBelowRarity(rarityId, equipped);
    this.session.resources.transact({ credits: { gold: result.gold } });
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
        // Reputation became a real quantity in Phase 6, so this axis is evaluated rather
        // than apologised for — it read "not yet tracked" through Phase 5, which meant a
        // region gated on reputation was permanently shut (DL-033).
        if (unlock.reputation !== undefined) {
          const current = this.session.reputation.current;
          if (current < unlock.reputation) {
            blockedBy.push(
              `needs ${unlock.reputation} reputation (the guild has ${current.toFixed(1)})`,
            );
          }
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
    return this.dispatch(regionId, objective, party, undefined, undefined);
  }

  worldBossEvent(): WorldBossEvent | undefined {
    return this.session.worldEvents.currentWorldBoss(this.session.clock.tick);
  }

  sendWorldBossExpedition(party?: PartyProposal): Result<ExpeditionOutcome, string> {
    const event = this.worldBossEvent();
    if (!event) return err('no world boss is currently active');
    return this.dispatch(event.regionId, 'slay', party, undefined, event);
  }

  /**
   * REQ-CRD-002/003 for the world boss: the authored drop chance, the per-boss guarantee
   * after enough kills without a card, and a duplicate that converts into essence rather
   * than sitting as a dead second copy.
   */
  private rollWorldBossCard(bossId: string): void {
    const boss = this.session.content.monstersById.get(bossId);
    const pool = boss?.cardPool ?? [];
    if (pool.length === 0) return;
    const rules = this.session.content.balance.loot.bossCards;
    const guaranteed = this.session.worldEvents.killsSinceCard + 1 >= rules.duplicateProtection.guaranteeAfterKills;
    const rng = this.session.streams.loot;
    const dropped = guaranteed || rng.bool(rules.dropChance);
    this.session.worldEvents.recordCardRoll(dropped);
    if (!dropped) return;
    const card = pool[rng.int(0, pool.length)] ?? pool[0]!;
    const added = this.session.armoury.addCard(card);
    if (added.duplicate) {
      const conversion = this.session.cards.duplicateConversion(card);
      if (conversion.ok) {
        this.session.resources.transact({ credits: { [conversion.value.resourceId]: conversion.value.amount } });
      }
    }
    this.session.audit.record({
      actor: { kind: 'system', name: 'guild-ai' },
      system: 'loot',
      outcome: `${boss?.name ?? bossId} dropped ${card}${added.duplicate ? ' (a duplicate, converted)' : ''}${guaranteed ? ' — guaranteed by duplicate protection' : ''}`,
      reasonCodes: ['world_boss_card', `card:${card}`],
    });
  }

  /** Why endless expeditions are or are not open to the guild yet. */
  endlessAvailability(): { readonly open: boolean; readonly reason: string } {
    const needed = this.session.content.endless.unlock.guildMasteryLevel;
    const level = this.session.guildMastery.level();
    return level >= needed
      ? { open: true, reason: `Guild Mastery ${level}` }
      : { open: false, reason: `Endless expeditions open at Guild Mastery ${needed} (the guild is at ${level}).` };
  }

  /**
   * An endless expedition (REQ-END-002): the chosen objective decides how the party plays
   * and what the run pays; the run continues, route after deeper route, until the Guild AI
   * turns back, the party breaks, or the light goes. Depth is a personal record (REQ-END-003).
   */
  sendEndlessExpedition(
    regionId: string,
    endlessObjectiveId: string,
    party?: PartyProposal,
  ): Result<ExpeditionOutcome, string> {
    const objective = this.session.content.endless.objectives.find((o) => o.id === endlessObjectiveId);
    if (!objective) return err(`unknown endless objective "${endlessObjectiveId}"`);
    const availability = this.endlessAvailability();
    if (!availability.open) return err(availability.reason);
    return this.dispatch(regionId, objective.baseObjective, party, objective, undefined);
  }

  private dispatch(
    regionId: string,
    objective: ObjectiveId,
    party: PartyProposal | undefined,
    endless: EndlessObjectiveDef | undefined,
    worldBoss: WorldBossEvent | undefined,
  ): Result<ExpeditionOutcome, string> {
    const baseRegion = this.session.content.worldRegionsById.get(regionId);
    if (!baseRegion) return err(`unknown region "${regionId}"`);
    const region = worldBoss ? { ...baseRegion, boss: worldBoss.bossId } : baseRegion;

    // REQ-WLD-002 is a rule, so it is enforced here rather than only in the UI — the
    // difference between a disabled button and an actual gate is whether the debug console
    // and a future automation path respect it too.
    const availability = this.regionAvailability().find((a) => a.region.id === regionId);
    if (availability && !availability.unlocked) {
      return err(`${region.name} is not open to the guild: ${availability.blockedBy.join('; ')}`);
    }

    // Contracts are ordinary expeditions; an endless run neither satisfies nor is bound by one.
    const active = endless ? undefined : this.session.contracts.active();
    const matching = active && active.regionId === regionId && active.objective === objective ? active : undefined;
    const shaped = this.shapeForChallenge(matching, objective, party);
    if (isErr(shaped)) return shaped;
    const proposal = shaped.value;
    if (proposal.members.length === 0) return err('no hunter is available to deploy');

    // A fresh fork per expedition, labelled by region and tick, so two expeditions in the
    // same session never share a draw sequence and each one replays on its own.
    const rng = this.session.streams.expedition.fork(`${regionId}:${this.session.clock.tick}`);
    const endlessConfig = this.session.content.endless;
    const result = this.session.expedition.run(
      rng,
      region,
      proposal,
      {
        ...(endless ? { endless: { maxDepth: endlessConfig.maxDepth, statsPerDepth: endlessConfig.statsPerDepth } } : {}),
        ...(worldBoss ? { worldBossId: worldBoss.bossId } : {}),
      },
    );
    this.session.guildMastery.record('expedition', Math.max(1, result.reachedNode) * this.masteryPoints.expeditionPerNode);

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

      // REQ-LEG-004: mentors' EXP bonus applies to all combat experience, not only town hunts.
      const xp = Math.round(
        after.xp *
          this.session.mentors.experienceScale() *
          traitMultiplier(hunter, this.session.content.traitsById, 'experienceGainMultiplier'),
      );
      const progress = applyExperience(hunter.level, hunter.xp, xp, balance);
      hunter = withLevel(hunter, progress.level, progress.xp);
      if (progress.levelsGained > 0) {
        levelledUp.push(hunter.id);
        this.session.events.emit('hunter.leveled', { hunterId: hunter.id, level: progress.level });
      }

      // Morale swings harder for some hunters than others (Glass Nerves: moraleVolatility).
      const moraleSwing =
        (after.moraleChange + (result.wiped ? -0.2 : result.retreated ? -0.05 : 0.08)) *
        traitMultiplier(hunter, this.session.content.traitsById, 'moraleVolatility');
      // REQ-ECO-003: time in the field makes a hunter hungry (Iron Stomach: hungerRateMultiplier).
      // Nothing applied field hunger before; `Condition.exert` existed and had no caller.
      const hungerAdded =
        (result.elapsedSeconds / 60) *
        this.session.content.economy.hunger.fieldPerMinute *
        traitMultiplier(hunter, this.session.content.traitsById, 'hungerRateMultiplier');
      hunter = this.session.condition.set(hunter, {
        fatigue: hunter.condition.fatigue + after.fatigueAdded,
        hunger: hunter.condition.hunger + hungerAdded,
        // Coming home is worth something; being broken on the way costs more than it gains.
        morale: hunter.condition.morale + moraleSwing,
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
        this.session.friendship.forget(hunter.id);
        continue;
      }

      // v1.0 §4/§18: how long they are out depends on the town they came home to. The
      // condition update above happens first deliberately — the estimate reads their
      // fatigue and hunger, so it has to see the state the expedition left them in.
      const estimate = this.session.recovery.estimate(hunter, { injured: after.injured });

      hunter = withAvailability(hunter, {
        state: after.injured ? 'injured' : 'recovering',
        readyAtTick: this.session.clock.tick + estimate.ticks,
        assignment: undefined,
        recallCompletesAtTick: undefined,
      });

      // Town work is for idle hunters; someone who just came home wounded is not idle.
      this.session.townJobs.release(hunter.id);

      this.session.audit.record({
        actor: { kind: 'hunter', id: hunter.id },
        system: 'availability',
        outcome: `${hunter.name} returned ${after.injured ? 'injured' : 'to recover'} — ${estimate.explanation}`,
        reasonCodes: [REASON.availabilityChanged, after.injured ? 'injured' : 'expedition_ended'],
        inputs: {
          steps: estimate.steps,
          housingQuality: Number(estimate.inputs.housingQuality.toFixed(2)),
          serviceQuality: Number(estimate.inputs.serviceQuality.toFixed(2)),
          foodAvailable: estimate.inputs.foodAvailable,
        },
      });

      this.session.roster.update(hunter);
    }

    // REQ-HUN-012: everyone who came home together knows each other a little better.
    this.session.friendship.recordShared(result.aftermath.filter((a) => !a.died).map((a) => a.hunterId));

    // The frontier notices what the guild did (REQ-WLD-002's reputation axis, now real).
    this.session.reputation.recordExpedition({
      zoneTier: region.zoneTier,
      bossDefeated: result.bossDefeated,
      // Always false for now, and deliberately not faked. Nothing in the content marks a
      // monster as a *world* boss — `MonsterDef` has no such field and `CombatEncounter`
      // emits `worldBoss: false` for the same reason. The Drowned Choir is authored but
      // unplaced (TECH_DEBT, deferred to Phase 8's world-event system), so the larger
      // reputation award is reachable only once that lands. Inferring it from tier or level
      // here would put a number on the board that the rest of the game disagrees with.
      worldBoss: worldBoss !== undefined,
      wiped: result.wiped,
      deaths: result.aftermath.filter((a) => a.died).length,
      regionId: region.id,
      regionName: region.name,
    });

    // The encounter itself reported the kill as a world-boss kill (worldBossId above). This
    // used to emit it a second time for every survivor, so each hunter's boss counter went up
    // by two for one kill (DL-056).
    if (worldBoss && result.bossDefeated) {
      this.session.worldEvents.defeat(worldBoss.id, this.session.clock.tick);
      this.rollWorldBossCard(worldBoss.bossId);
    }

    const contract = endless ? undefined : this.session.contracts.resolve(regionId, proposal.objective.id);
    if (contract) {
      const succeeded = result.completed && !result.wiped;
      if (succeeded) {
        this.session.resources.transact({
          credits: {
            gold: contract.reward.gold,
            food: contract.reward.food,
            materials: contract.reward.materials,
            ...(contract.reward.extras ?? {}),
          },
        });
      }
      const standing = this.session.content.contracts.standing;
      this.session.factions.change(contract.factionId, succeeded ? standing.success : standing.failure);
      const reputationDelta = succeeded ? contract.reputation : -contract.reputation;
      const reputationReason = `${succeeded ? 'completed' : 'failed'} contract ${contract.name}`;
      this.session.reputation.change(reputationDelta, reputationReason);
      this.session.reputation.changeRegional(regionId, reputationDelta, reputationReason);
      for (const member of proposal.members) {
        this.session.events.emit('contract.completed', {
          hunterId: member.hunterId,
          contractId: contract.offerId,
          templateId: contract.id,
          name: contract.name,
          succeeded,
        });
      }
      this.session.audit.record({
        actor: { kind: 'system', name: 'guild-ai' },
        system: 'contracts',
        outcome: `${succeeded ? 'completed' : 'failed'} ${contract.name}`,
        reasonCodes: [succeeded ? 'contract_completed' : 'contract_failed', `faction:${contract.factionId}`],
        inputs: { reward: succeeded ? contract.reward : {} },
      });
      this.session.guildMastery.record(
        'contract',
        succeeded ? this.masteryPoints.contractCompleted : this.masteryPoints.contractFailed,
      );
    }

    // Loot is rolled once, for the guild, at the region's item level — a shared haul rather
    // than per-hunter drops, because the guild owns the armoury (§16).
    // Endless depth adds loot rolls, never item level (v1.0 §12: no infinitely rising item level).
    const depthsCleared = result.endless?.depthsCleared ?? 0;
    const lootRolls = endless
      ? Math.round((result.lootRolls + endlessConfig.lootRollsPerDepth * depthsCleared) * endless.rewardScale.loot)
      : result.lootRolls;
    const loot =
      lootRolls > 0
        ? this.session.itemGenerator.generateMany(
            this.session.streams.loot,
            lootRolls,
            { itemLevel: region.itemLevel },
          )
        : [];
    this.session.armoury.addMany(loot);

    const baseReward = this.session.content.economy.expeditionRewards[region.zoneTier];
    const completionScale = result.wiped
      ? 0
      : endless
        ? 1 + endlessConfig.rewardPerDepth * depthsCleared
        : result.completed
          ? 1
          : Math.max(0.2, result.reachedNode / Math.max(1, result.routeLength));
    const emphasis = endless?.rewardScale ?? { gold: 1, food: 1, materials: 1, loot: 1 };
    const extras: Record<string, number> = {};
    for (const [id, amount] of Object.entries(baseReward.extras ?? {})) {
      // Rare resources come home whole or not at all: half a crystal is not a haul.
      const scaled = Math.floor(amount * completionScale);
      if (scaled > 0) extras[id] = scaled;
    }
    if (endless && !result.wiped) {
      for (const [id, perDepth] of Object.entries(endless.extrasPerDepth)) {
        const earned = Math.floor(perDepth * depthsCleared);
        if (earned > 0) extras[id] = (extras[id] ?? 0) + earned;
      }
    }
    const resources: EconomyReward = {
      gold: Math.round(baseReward.gold * completionScale * emphasis.gold),
      food: Math.round(baseReward.food * completionScale * emphasis.food),
      materials: Math.round(baseReward.materials * completionScale * emphasis.materials),
      ...(Object.keys(extras).length > 0 ? { extras } : {}),
    };
    this.session.resources.transact({
      credits: { gold: resources.gold, food: resources.food, materials: resources.materials, ...extras },
    });

    const record = endless && result.endless ? this.recordEndless(region, endless, result.endless.deepestDepth, depthsCleared, proposal) : undefined;

    return ok({ result, party: proposal, loot, levelledUp, resources, ...(record ? { record } : {}) });
  }

  private recordEndless(
    region: { readonly id: string; readonly name: string },
    objective: EndlessObjectiveDef,
    deepestDepth: number,
    routesCleared: number,
    party: PartyProposal,
  ): RecordOutcome {
    const outcome = this.session.endlessRecords.submit({
      regionId: region.id,
      objectiveId: objective.id,
      depth: deepestDepth,
      routesCleared,
      tick: this.session.clock.tick,
      cycle: this.session.newGamePlus.cycle,
      party: party.members.map((member) => member.name),
    });
    if (outcome.improved) {
      const milestone = this.session.content.endless.recordMilestone;
      const previousDepth = outcome.previous?.depth ?? 0;
      // A milestone is crossed when the new record reaches a multiple the old one had not.
      const crossed = Math.floor(deepestDepth / milestone) > Math.floor(previousDepth / milestone);
      this.session.events.emit('endless.recordSet', {
        regionId: region.id,
        regionName: region.name,
        objectiveName: objective.name,
        depth: crossed ? Math.floor(deepestDepth / milestone) * milestone : deepestDepth,
        milestone: crossed,
      });
      this.session.audit.record({
        actor: { kind: 'system', name: 'guild-ai' },
        system: 'endless',
        outcome: `new ${objective.name.toLowerCase()} record in ${region.name}: depth ${deepestDepth}` +
          (outcome.previous ? ` (was ${outcome.previous.depth})` : ''),
        reasonCodes: ['endless_record', `region:${region.id}`, `objective:${objective.id}`],
      });
    }
    return outcome;
  }

  // --- Time passing: live, offline, and the report -------------------------

  /**
   * Let town time pass and account for it (REQ-UX-006).
   *
   * Steps run in chunks, and the standing order is checked at the start of each, so a long
   * catch-up dispatches expeditions on the same cadence live play would. Every step goes
   * through `advanceTown`, the same path the season button uses: offline is the same
   * systems accelerated, never a different model (REQ-OFF-002).
   */
  passTime(steps: number, options: { readonly offline?: boolean } = {}): GuildReport {
    const recorder = new ReportRecorder(this.session, options.offline ?? false);
    const chunk = this.session.content.time.catchUpChunkSteps;
    let remaining = Math.max(0, Math.floor(steps));
    while (remaining > 0) {
      this.runStandingOrder(recorder);
      const n = Math.min(chunk, remaining);
      const result = this.advanceTown(n);
      recorder.addSteps(n);
      recorder.noteHunts(result.hunts);
      recorder.noteRecovered(result.recovered.length);
      recorder.noteCrafted(result.completedCrafts.map((item) => item.name));
      if (result.defense) recorder.noteDefense(result.defense.summary, result.defense.held);
      if (this.session.standingOrders.autoRepair) this.repairDamaged(recorder);
      // Asking is what lets the world boss appear on schedule (and announce itself).
      this.worldBossEvent();
      remaining -= n;
    }
    return recorder.finish();
  }

  /**
   * Catch up on real time the player spent away (REQ-OFF-001): converted to steps at the
   * authored calendar rate and capped at three days.
   */
  catchUpOffline(elapsedMs: number): GuildReport {
    const time = this.session.content.time;
    const capped = Math.min(Math.max(0, elapsedMs), time.maxOfflineHours * 3_600_000);
    const steps = Math.floor(capped / 1000 / time.realSecondsPerStep);
    return this.passTime(steps, { offline: true });
  }

  /** Set, replace or clear the standing expedition order (REQ-OFF-003: the risk is chosen here). */
  setStandingOrder(order: StandingOrder | undefined): Result<StandingOrder | undefined, string> {
    if (order) {
      if (!this.session.content.worldRegionsById.has(order.regionId)) return err(`unknown region "${order.regionId}"`);
      if (!OBJECTIVES.some((objective) => objective.id === order.objective)) return err(`unknown objective "${order.objective}"`);
      if (!Number.isInteger(order.everySteps) || order.everySteps < 1) return err('an order needs a whole number of steps between expeditions');
    }
    this.session.standingOrders.set(order);
    this.session.audit.record({
      actor: { kind: 'player' },
      system: 'standing-orders',
      outcome: order
        ? `standing order: ${order.objective} in ${order.regionId} every ${order.everySteps} steps${order.allowLethal ? ', lethal zones allowed' : ''}`
        : 'standing order cleared',
      reasonCodes: ['standing_order'],
    });
    return ok(order);
  }

  /** Turn the Guild AI's automatic repairs on or off (REQ-OFF-004). */
  setAutoRepair(on: boolean): void {
    this.session.standingOrders.setAutoRepair(on);
    this.session.audit.record({
      actor: { kind: 'player' },
      system: 'standing-orders',
      outcome: `automatic repairs ${on ? 'on' : 'off'}`,
      reasonCodes: ['auto_repair'],
    });
  }

  /**
   * The Guild AI rebuilds what attacks damaged, through the same paid command the player
   * uses, cheapest first. What it cannot afford it leaves, and the report says so.
   */
  private repairDamaged(recorder: ReportRecorder): void {
    const damaged = [...this.session.town.grid.damaged()].sort((a, b) => a.instanceId.localeCompare(b.instanceId));
    for (const placement of damaged) {
      const name = this.session.content.buildingsById.get(placement.buildingId)?.name ?? placement.buildingId;
      const repaired = this.repairBuilding(placement.instanceId);
      if (repaired.ok) {
        recorder.noteRepair(`Rebuilt the ${name}.`);
        this.session.audit.record({
          actor: { kind: 'system', name: 'guild-ai' },
          system: 'town',
          outcome: `rebuilt the ${name}`,
          reasonCodes: ['auto_repair'],
        });
      } else {
        recorder.noteSkipped(`Could not rebuild the ${name}: ${repaired.error}.`);
      }
    }
  }

  /** Run the standing order if it is due. Never leaves anything pending (REQ-OFF-004). */
  private runStandingOrder(recorder: ReportRecorder): void {
    const orders = this.session.standingOrders;
    const order = orders.order;
    if (!order || !orders.due(this.session.clock.tick, this.session.clock.coarseStepRatio)) return;
    orders.attempted(this.session.clock.tick);

    const region = this.session.content.worldRegionsById.get(order.regionId);
    if (!region) return;
    const lethal = this.session.content.world.zoneTiers[region.zoneTier].canKill;
    if (lethal && !order.allowLethal) {
      recorder.noteSkipped(`${region.name} can kill, and the standing order does not allow lethal zones.`);
      return;
    }
    const outcome = this.sendExpedition(order.regionId, order.objective as ObjectiveId);
    if (!outcome.ok) {
      recorder.noteSkipped(`${region.name}: ${outcome.error}`);
      return;
    }
    recorder.noteExpedition(
      {
        regionName: region.name,
        summary: outcome.value.result.summary,
        completed: outcome.value.result.completed,
        wiped: outcome.value.result.wiped,
      },
      outcome.value.result.aftermath,
    );
  }

  // --- The town -------------------------------------------------------------

  /**
   * Found the town a new guild starts with.
   *
   * Called from the composition root for a *new* guild only, never from a save migration:
   * placing buildings during a migration would put them somewhere the player did not choose,
   * on a grid whose dimensions come from balance data that may since have changed.
   *
   * The starting layout is the minimum that makes the town legible rather than a tutorial —
   * a Command Post so the stage ladder has a Guild Hall tier to read, a bunkhouse and a
   * granary so housing and food pressure both start answerable, and a drill yard so the work
   * rota has something to fill on the first step.
   */
  foundTown(): readonly string[] {
    if (this.session.town.grid.size > 0) return [];

    // Two bunkhouses rather than one, deliberately: a single one housed eight against a
    // starting population of twelve, so a brand-new guild opened already under housing
    // pressure and losing residents. A starting town should be *comfortable and small*, and
    // let the player create the pressure by growing — not hand them a deficit on turn one.
    const founding: readonly [string, number, number][] = [
      ['guild_hall', 0, 0],
      ['bunkhouse', 4, 0],
      ['bunkhouse', 0, 4],
      ['granary', 8, 0],
      ['well', 4, 3],
      ['drill_yard', 6, 3],
    ];

    const placed: string[] = [];
    for (const [buildingId, x, y] of founding) {
      const result = this.placeBuildingWithoutCharge(buildingId, x, y);
      if (result.ok) placed.push(result.value.instanceId);
    }

    this.session.town.refreshStage();
    this.session.townJobs.refresh();
    return placed;
  }

  /**
   * Place a building (REQ-TWN-001).
   *
   * Placement and payment commit together. A blocked cell never consumes resources.
   */
  placeBuilding(
    buildingId: string,
    x: number,
    y: number,
    rotation: Rotation = 0,
  ): Result<Placement, string> {
    return this.placeBuildingPaid(buildingId, x, y, rotation, true);
  }

  private placeBuildingWithoutCharge(buildingId: string, x: number, y: number): Result<Placement, string> {
    return this.placeBuildingPaid(buildingId, x, y, 0, false);
  }

  private placeBuildingPaid(
    buildingId: string,
    x: number,
    y: number,
    rotation: Rotation,
    charge: boolean,
  ): Result<Placement, string> {
    const allowed = this.session.town.canBuild(buildingId);
    if (isErr(allowed)) return allowed;

    const before = this.session.town.grid.snapshot();
    const placed = this.session.town.grid.place(buildingId, x, y, rotation);
    if (isErr(placed)) return placed;
    const tier = this.session.content.buildingsById.get(buildingId)?.tiers.find((entry) => entry.tier === 1);
    if (charge && tier) {
      const paid = this.session.resources.transact({ debits: { gold: tier.cost.gold, materials: tier.cost.materials } });
      if (isErr(paid)) {
        this.session.town.grid.restore(before);
        return err(paid.error);
      }
    }

    this.session.events.emit('town.buildingPlaced', {
      buildingId,
      instanceId: placed.value.instanceId,
      x,
      y,
    });

    const stage = this.session.town.refreshStage();
    if (stage) {
      this.session.audit.record({
        actor: { kind: 'player' },
        system: 'town',
        outcome: `the town became a ${stage.name}`,
        reasonCodes: ['town_stage_reached', `stage:${stage.id}`],
      });
    }

    // A new building can open new work, so the rota is stale the moment one goes up.
    this.session.townJobs.refresh();
    return placed;
  }

  /** Move or rotate a building. Free, per v1.0 §9. */
  moveBuilding(
    instanceId: string,
    x: number,
    y: number,
    rotation?: Rotation,
  ): Result<Placement, string> {
    return this.session.town.grid.relocate(instanceId, x, y, rotation);
  }

  /** Raise a building a tier and charge its authored cost atomically. */
  upgradeBuilding(instanceId: string): Result<Placement, string> {
    const cost = this.session.town.upgradeCost(instanceId);
    if (isErr(cost)) return cost;

    const before = this.session.town.grid.snapshot();
    const raised = this.session.town.grid.setTier(instanceId, cost.value.tier);
    if (isErr(raised)) return raised;
    const paid = this.session.resources.transact({ debits: { gold: cost.value.gold, materials: cost.value.materials } });
    if (isErr(paid)) {
      this.session.town.grid.restore(before);
      return err(paid.error);
    }

    const stage = this.session.town.refreshStage();
    if (stage) {
      this.session.audit.record({
        actor: { kind: 'player' },
        system: 'town',
        outcome: `the town became a ${stage.name}`,
        reasonCodes: ['town_stage_reached', `stage:${stage.id}`],
      });
    }

    this.session.townJobs.refresh();
    return raised;
  }

  /** Demolish a building. Returns nothing to the guild — Phase 7 owns refunds. */
  demolishBuilding(instanceId: string): Result<Placement, string> {
    const removed = this.session.town.grid.remove(instanceId);
    if (isErr(removed)) return removed;
    // Note that the town's *stage* does not fall (REQ-TWN-002): progression never resets.
    this.session.townJobs.refresh();
    return removed;
  }

  // --- The Recruitment Hall (REQ-RCT-001/002) -------------------------------

  /**
   * Who is waiting at the hall, with the recruiter's read on each of them.
   *
   * The analysis is computed on demand rather than stored, because it is a function of the
   * roster: hiring somebody changes what the guild is missing, so an advice snapshot taken
   * before a hire would be wrong immediately after one.
   */
  /**
   * Fuller candidate histories, unlocked by the Veteran Records Legacy option.
   *
   * The unlock shipped with no consumer: paid for and read by nothing. What a recruiter's
   * records can honestly add is what the board already knows and does not say — where the
   * candidate is from and why that matters, their temperament in the game's own words, and
   * what each of their traits actually means. Nothing here is invented or hidden elsewhere;
   * this is a convenience unlock, as its category says.
   */
  recruitmentHistories(): readonly { readonly hunterId: HunterId; readonly name: string; readonly lines: readonly string[] }[] {
    if (!this.session.legacy.has('veteran_records')) return [];
    return this.session.recruitment.available().map((candidate) => {
      const hunter = candidate.hunter;
      const personality = this.session.content.personalitiesById.get(hunter.personalityId);
      const lines = [`${candidate.originName}: ${candidate.originNote}`];
      if (personality) lines.push(`${personality.name} — ${personality.description}`);
      for (const traitId of hunter.traitIds) {
        const trait = this.session.content.traitsById.get(traitId);
        if (trait) lines.push(`${trait.name} — ${trait.description}`);
      }
      return { hunterId: hunter.id, name: hunter.name, lines };
    });
  }

  recruitmentBoard(): {
    readonly candidates: readonly Candidate[];
    readonly advice: RecruitmentAdvice;
    readonly ticksUntilRefresh: number | undefined;
    readonly paidRefreshGold: number;
  } {
    const candidates = this.session.recruitment.available();
    return {
      candidates,
      advice: analysePool(candidates, {
        roster: this.session.roster.all(),
        deps: {
          profileOf: (hunter) => this.session.buildIdentity.profileOf(hunter),
          potentialOf: (hunter) => hunter.potential.composite,
        },
      }),
      ticksUntilRefresh: this.session.recruitment.ticksUntilRefresh(),
      paidRefreshGold: this.session.content.recruitment.pool.paidRefreshGold,
    };
  }

  /**
   * Pay for a new set of candidates (REQ-RCT-001).
   *
   * Payment and the refresh happen together: an unaffordable request leaves the current
   * candidates in place rather than turning the board into a free reroll.
   */
  refreshRecruits(): Result<readonly Candidate[], string> {
    if (this.session.town.grid.countOf('recruitment_hall') === 0) {
      return err('the guild has no Recruitment Hall');
    }
    const price = this.session.content.recruitment.pool.paidRefreshGold;
    const paid = this.session.resources.transact({ debits: { gold: price } });
    if (isErr(paid)) return err(paid.error);

    const drawn = this.session.recruitment.refresh(this.session.streams.recruit);
    this.session.audit.record({
      actor: { kind: 'player' },
      system: 'recruitment',
      outcome: `paid to refresh the recruitment pool (${drawn.length} waiting)`,
      reasonCodes: ['recruitment_refreshed'],
      inputs: { gold: this.session.content.recruitment.pool.paidRefreshGold },
    });
    return ok(drawn);
  }

  /**
   * Hire someone from the hall.
   *
   * The candidate is already a whole hunter, so this enlists exactly the person the player
   * was looking at — no re-roll, no reconstruction from a summary. They then walk their
   * constellation the way any recruit does.
   */
  hireRecruit(hunterId: HunterId): Result<Hunter, string> {
    const candidate = this.session.recruitment.available().find((entry) => entry.hunter.id === hunterId);
    if (!candidate) return err('that candidate is no longer at the hall');
    const paid = this.session.resources.transact({ debits: { gold: candidate.cost } });
    if (isErr(paid)) return err(paid.error);
    const taken = this.session.recruitment.hire(String(hunterId));
    if (isErr(taken)) {
      this.session.resources.transact({ credits: { gold: candidate.cost } });
      return taken;
    }

    const hired = this.session.enlist(taken.value.hunter);
    const developed = this.developRecruit(hired);

    this.session.audit.record({
      actor: { kind: 'player' },
      system: 'recruitment',
      outcome:
        `hired ${developed.name} — ${taken.value.originName}` +
        (taken.value.exceptional ? ', an exceptional recruit' : ''),
      reasonCodes: ['recruit_hired', `origin:${taken.value.originId}`],
      inputs: { cost: taken.value.cost },
    });

    this.session.townJobs.refresh();
    this.session.guildMastery.record('recruitment', this.masteryPoints.recruitHired);
    return ok(developed);
  }

  /** Let a candidate go. The seat stays empty until the pool refreshes. */
  turnAwayRecruit(hunterId: HunterId): Result<Candidate, string> {
    return this.session.recruitment.turnAway(String(hunterId));
  }

  /**
   * Begin researching something (REQ-RES-001).
   *
   * Choosing what to research is one of the few decisions in the game that cannot be undone
   * without paying for it, because taking a node forecloses its conflicts permanently. So it
   * is audited as a player act, with the foreclosed branches named in the record — the point
   * of an audit trail is to be able to answer "why can I not build that any more" a hundred
   * hours later.
   */
  beginResearch(nodeId: string): Result<ResearchNodeDef, string> {
    const started = this.session.research.begin(nodeId);
    if (isErr(started)) return started;

    const forecloses = started.value.conflictsWith
      .map((id) => this.session.research.node(id)?.name ?? id)
      .filter((name) => name.length > 0);

    this.session.audit.record({
      actor: { kind: 'player' },
      system: 'research',
      outcome:
        `began researching ${started.value.name}` +
        (forecloses.length > 0 ? `, which will rule out ${forecloses.join(' and ')}` : ''),
      reasonCodes: ['research_begun', `node:${started.value.id}`],
      inputs: { branch: started.value.branch, cost: started.value.cost },
    });
    return started;
  }

  /**
   * REQ-RES-001 — reset the research tree with a rare resource.
   *
   * The rare resource is charged before locks are released, which is the only way a guild
   * changes its research identity.
   */
  resetResearch(): Result<{ readonly cleared: number; readonly cost: string }, string> {
    const resetCost = this.session.content.research.resetResource;
    const paid = this.session.resources.transact({ debits: { [resetCost.id]: resetCost.amount } });
    if (isErr(paid)) return err(paid.error);
    const result = this.session.research.reset();
    this.session.audit.record({
      actor: { kind: 'player' },
      system: 'research',
      outcome: `reset the research tree, unlearning ${result.cleared} advance(s)`,
      reasonCodes: ['research_reset'],
    });
    return ok({
      cleared: result.cleared,
      cost: `${result.cost.amount} × ${result.cost.name}`,
    });
  }

  /** Appoint a Department Head (REQ-DEP-002). */
  appointDepartmentHead(
    department: TownDepartmentId,
    hunterId: HunterId | undefined,
  ): Result<DepartmentState, string> {
    const result = this.session.departments.appointHead(department, hunterId);
    if (isErr(result)) return result;

    const name = hunterId ? this.session.roster.get(hunterId)?.name : undefined;
    this.session.audit.record({
      actor: { kind: 'player' },
      system: 'departments',
      outcome: name
        ? `${name} appointed to head the ${department} department`
        : `the ${department} department has no head`,
      reasonCodes: ['department_head_changed', `department:${department}`],
    });
    return result;
  }

  /** Set a department's priority. Guild policy remains the higher authority (REQ-DEP-004). */
  setDepartmentPriority(
    department: TownDepartmentId,
    priority: number,
  ): Result<DepartmentState, string> {
    const result = this.session.departments.setPriority(department, priority);
    if (isErr(result)) return result;
    this.session.townJobs.refresh();
    return result;
  }

  /** Choose a department's policy preset (REQ-DEP-005). Reweights the rota; never filters. */
  setDepartmentPolicy(
    department: TownDepartmentId,
    policyId: string,
  ): Result<DepartmentState, string> {
    const result = this.session.departments.setPolicy(department, policyId);
    if (isErr(result)) return result;
    this.session.townJobs.refresh();
    return result;
  }

  /**
   * Advance town time by `steps` coarse steps.
   *
   * One call, because these things are not independent: people arrive, which changes demand,
   * which changes recovery, which changes who is free to work. Running them separately from
   * the UI would let the player observe an inconsistent town between two of them.
   *
   * Deliberately *not* wired to a timer here — DL-003 puts everything on the simulation
   * clock, and the composition root owns advancing it.
   */
  advanceTown(steps = 1): {
    readonly populationChange: number;
    readonly recovered: readonly HunterId[];
    readonly stageReached: string | undefined;
    readonly researchCompleted: readonly string[];
    readonly hunts: readonly HuntResult[];
    readonly defense: DefenseResult | undefined;
    readonly economy: { readonly materialsProduced: number; readonly food: FoodReport };
    readonly completedCrafts: readonly Item[];
  } {
    // Advance the simulation clock first, because everything below is timed against it.
    //
    // This was missing, and it froze more than it looked like it would: the recruitment
    // refresh, the defense timer and every hunter's `readyAtTick` are all measured in ticks,
    // so a game where town time passed but the clock did not meant nobody ever recovered,
    // the pool never refreshed on its own, and the walls were never once tested. DL-003 puts
    // everything on the simulation clock; this is the town honouring that rather than
    // keeping a private step counter beside it.
    //
    // `runSteps` rather than `advance` because there is no frame to keep responsive here —
    // it is the same entry point offline catch-up uses (REQ-OFF-001).
    this.session.clock.runSteps(steps * this.session.clock.coarseStepRatio, () => {});
    this.session.market.step(steps);
    if (this.session.contracts.due()) this.postContracts();
    const completedCrafts: Item[] = [];
    for (const order of this.session.crafting.completeReady()) {
      this.session.armoury.add(order.item);
      completedCrafts.push(order.item);
      const crafter = this.session.roster.get(order.crafterId as HunterId);
      if (crafter?.availability.assignment === order.id) {
        this.session.roster.update(withAvailability(crafter, { state: 'available', assignment: undefined, recallCompletesAtTick: undefined, readyAtTick: undefined }));
      }
    }

    // REQ-RES-002: research points come from the Research department's output and from
    // nowhere else. This one line is what keeps technology and experience on separate
    // ledgers — there is no path from anything a hunter did well to a research point.
    const researchCompleted: string[] = [];
    const researchOutput = this.session.departments.report('research').output;
    for (let i = 0; i < steps; i++) {
      const done = this.session.research.contribute(researchOutput);
      if (done) {
        researchCompleted.push(done.name);
        this.session.guildMastery.record('research', this.masteryPoints.researchCompleted);
      }
    }

    const materialsProduced = this.session.departments.materialsOutput() * steps;
    if (materialsProduced > 0) {
      this.session.resources.transact({ credits: { materials: materialsProduced } });
    }
    // Provisions produced = the residents the town says it can feed, at the ration each one
    // eats (DL-059). Food capacity — granary, field kitchen, staffed kitchen and hunting
    // posts, research — is authored in *residents fed*, and the pressure panel reads it that
    // way ("Enough food for 14"). Phase 7c produced provisions from staffed jobs only, in a
    // different unit, so the founding town, which has a granary and no kitchen, produced
    // nothing: it starved after ~90 steps and emptied within 200.
    const food = this.session.food.step(
      this.session.population.size,
      steps,
      this.session.town.capacity().food * this.session.content.economy.foodConsumptionPerResidentPerStep,
    );

    const populationChange = this.session.population.step(steps);
    if (populationChange !== 0) {
      this.session.events.emit('town.populationChanged', {
        population: this.session.population.size,
        delta: populationChange,
      });
    }

    const stage = this.session.town.refreshStage();
    const recovered = this.returnRecoveredHunters();

    // REQ-RCT-001 requires a timed refresh as well as a paid one. It lives here rather than
    // on its own timer so that town time has exactly one place it advances (DL-003).
    this.session.recruitment.refreshIfDue(this.session.streams.recruit);

    // Town hunting before defense, and both before the rota is rebuilt: a hunter who came
    // back tired from the orchard should be considered for tomorrow's rota in that state.
    const hunts = this.runTownHunts(steps);
    const defense = this.runDefense();
    if (defense) {
      this.session.guildMastery.record(
        'defense',
        defense.held ? this.masteryPoints.defenseHeld : this.masteryPoints.defenseBreached,
      );
    }

    this.restIdleHunters(steps);
    this.session.townJobs.refresh();

    return {
      populationChange,
      recovered,
      stageReached: stage?.name,
      researchCompleted,
      hunts,
      defense,
      economy: { materialsProduced, food },
      completedCrafts,
    };
  }

  /**
   * Run the hunting posts (REQ-TWN-007).
   *
   * Who goes is decided by the ordinary work rota — town hunting is a job like any other,
   * so the AI picks workers under the department policy the player set, with no second
   * assignment path to keep in step with the first.
   */
  private runTownHunts(steps: number): readonly HuntResult[] {
    const config = this.session.content.threats.hunting;
    const hunters = this.session.townJobs
      .all()
      .filter((assignment) => assignment.jobId === 'town_hunting')
      .map((assignment) => assignment.hunterId as HunterId)
      .filter((id) => this.session.roster.get(id) !== undefined);

    if (hunters.length === 0) return [];

    const outings = Math.floor(steps / config.everySteps);
    if (outings <= 0) return [];

    const results: HuntResult[] = [];
    for (let i = 0; i < outings; i++) {
      const rng = this.session.streams.expedition.fork(
        `hunt:${this.session.clock.tick}:${i}`,
      );
      const ground = rng.pick(config.grounds);
      if (!ground) break;

      const result = this.session.townCombat.hunt(rng, ground, hunters);
      results.push(result);

      for (const hunterId of hunters) {
        const hunter = this.session.roster.get(hunterId);
        if (!hunter) continue;

        // REQ-TWN-007 yields EXP as well as loot, and the same experience curve applies —
        // town work is slower than an expedition, not a different kind of progress.
        const progress = applyExperience(
          hunter.level,
          hunter.xp,
          Math.round(
            (result.xp / hunters.length) *
              this.session.mentors.experienceScale() *
              traitMultiplier(hunter, this.session.content.traitsById, 'experienceGainMultiplier'),
          ),
          this.session.content.balance.attributes,
        );
        let updated = withLevel(hunter, progress.level, progress.xp);
        updated = this.session.condition.set(updated, {
          fatigue: updated.condition.fatigue + config.fatiguePerHunt,
          morale: updated.condition.morale + (result.won ? 0.02 : -0.03),
        });
        this.session.roster.update(updated);

        if (progress.levelsGained > 0) {
          this.session.events.emit('hunter.leveled', {
            hunterId: updated.id,
            level: progress.level,
          });
        }
      }

      if (result.loot) {
        this.session.armoury.addMany(
          this.session.itemGenerator.generateMany(this.session.streams.loot, 1, {
            itemLevel: ground.itemLevel,
          }),
        );
      }
      if (result.won) {
        const reward = this.session.content.economy.townHuntRewards;
        this.session.resources.transact({
          credits: { gold: reward.gold, food: reward.food, materials: reward.materials },
        });
      }
    }

    return results;
  }

  /**
   * Test the walls, if anything is due (REQ-TWN-008).
   *
   * The Guild AI picks the defenders under the player's guard policy; the fight runs through
   * the real combat system; and losing costs buildings and residents rather than lives.
   */
  private runDefense(): DefenseResult | undefined {
    const rng = this.session.streams.expedition.fork(`defense:${this.session.clock.tick}`);
    const threat = this.session.defense.threatDue(rng);
    if (!threat) return undefined;

    const defenders = this.session.defense.defenders(threat);
    const result = this.session.townCombat.defend(rng, threat, defenders);
    this.session.defense.recordOutcome(result.held);
    this.session.events.emit('town.defended', { threatName: result.threatName, held: result.held });

    // Defending is work, and a fight at the gate tires people out the way any fight does.
    for (const hunterId of defenders) {
      const hunter = this.session.roster.get(hunterId);
      if (!hunter) continue;
      this.session.roster.update(
        this.session.condition.set(hunter, {
          fatigue: hunter.condition.fatigue + 0.1,
          morale: hunter.condition.morale + (result.held ? 0.05 : -0.1),
        }),
      );
    }

    if (!result.held) {
      // Damage the buildings that were actually worth attacking — undamaged ones, chosen
      // deterministically from the forked stream so a defense replays identically.
      const standing = this.session.town.grid.all().filter((p) => p.damaged !== true);
      for (let i = 0; i < result.buildingsDamaged && standing.length > 0; i++) {
        const index = Math.floor(rng.next() * standing.length);
        const victim = standing.splice(index, 1)[0];
        if (victim) this.session.town.grid.damage(victim.instanceId);
      }
      if (result.populationLost > 0) this.session.population.adjust(-result.populationLost);
    }

    this.session.audit.record({
      actor: { kind: 'system', name: 'guild-ai' },
      system: 'defense',
      outcome: `${result.summary} ${this.session.defense.explainDefenders(threat, defenders)}`,
      reasonCodes: [
        result.held ? 'defense_held' : 'defense_failed',
        `threat:${threat.id}`,
        `policy:${this.session.defense.policy}`,
      ],
      inputs: {
        severity: threat.severity,
        defenders: defenders.length,
        buildingsDamaged: result.buildingsDamaged,
      },
    });

    return result;
  }

  /** REQ-TWN-008 — the player sets guard policy; the AI organises under it. */
  setGuardPolicy(policyId: string): Result<string, string> {
    const result = this.session.defense.setPolicy(policyId);
    if (isErr(result)) return result;

    this.session.audit.record({
      actor: { kind: 'player' },
      system: 'defense',
      outcome: `guard policy set to "${policyId}"`,
      reasonCodes: ['guard_policy_changed'],
    });
    return result;
  }

  /** Rebuild something a defense event wrecked, paying a fraction of its tier cost. */
  repairBuilding(instanceId: string): Result<Placement, string> {
    const placement = this.session.town.grid.get(instanceId);
    if (!placement) return err(`nothing placed as "${instanceId}"`);
    if (placement.damaged !== true) return err('that building is not damaged');
    const tier = this.session.content.buildingsById.get(placement.buildingId)?.tiers.find((entry) => entry.tier === placement.tier);
    if (!tier) return err('that building tier no longer exists');
    const scale = this.session.content.economy.repairCostScale;
    const debits = { gold: Math.ceil(tier.cost.gold * scale), materials: Math.ceil(tier.cost.materials * scale) };
    const paid = this.session.resources.transact({ debits });
    if (isErr(paid)) return err(paid.error);

    const repaired = this.session.town.grid.repair(instanceId);
    if (isErr(repaired)) {
      this.session.resources.transact({ credits: debits });
      return repaired;
    }

    this.session.townJobs.refresh();
    return repaired;
  }

  /**
   * Let everyone who is in town shed some fatigue (v1.0 §4).
   *
   * This is the other half of recovery, and its absence was a real bug rather than a missing
   * nicety. `returnRecoveredHunters` handles the *injured* path, which is the only place
   * recovery ran until now — so a hunter who was `available` and working the hunting camp
   * gained fatigue every outing and shed none, ever. Two of them hit the ceiling in a
   * browser session and became permanently unemployable: too tired for the rota, not injured
   * enough to be resting. The systems were both correct and nothing joined them up.
   *
   * §4's clauses — time, food, housing, rest — say nothing about being wounded first. So the
   * same rate the infirmary uses applies to everybody standing in the town, and whether a
   * work rota is sustainable becomes a genuine question about the town supporting it.
   */
  private restIdleHunters(steps: number): void {
    for (const hunter of this.session.roster.all()) {
      // Only people actually in town: someone in the field is not resting, and someone
      // injured is already on the slower, state-machine-governed path.
      if (hunter.availability.state !== 'available') continue;
      // The town feeds its hunters as far as its provisions reach (REQ-ECO-003).
      const fed = this.session.content.economy.hunger.townReliefPerStep * steps * this.session.food.fedFraction;
      if (hunter.condition.fatigue <= 0 && (hunter.condition.hunger <= 0 || fed <= 0)) continue;

      const rested = Math.max(0, this.session.recovery.restPerStep(hunter) * steps);
      this.session.roster.update(
        this.session.condition.set(hunter, {
          fatigue: hunter.condition.fatigue - rested,
          hunger: hunter.condition.hunger - fed,
          morale: hunter.condition.morale,
        }),
      );
    }
  }

  /**
   * Move anyone whose recovery has elapsed back to available.
   *
   * Injury heals into recovery rather than straight to deployable — that transition is
   * enforced by `availability.ts` and this respects it, so an injured hunter takes two hops
   * home and the second one is subject to the town all over again.
   */
  private returnRecoveredHunters(): readonly HunterId[] {
    const now = this.session.clock.tick;
    const returned: HunterId[] = [];

    for (const hunter of this.session.roster.all()) {
      const availability = hunter.availability;
      if (availability.readyAtTick === undefined || now < availability.readyAtTick) continue;

      if (availability.state === 'injured') {
        const estimate = this.session.recovery.estimate(hunter, { injured: false });
        this.session.roster.update(
          withAvailability(hunter, {
            state: 'recovering',
            readyAtTick: now + estimate.ticks,
            assignment: undefined,
            recallCompletesAtTick: undefined,
          }),
        );
        continue;
      }

      if (availability.state === 'recovering') {
        this.session.roster.update(
          withAvailability(hunter, {
            state: 'available',
            readyAtTick: undefined,
            assignment: undefined,
            recallCompletesAtTick: undefined,
          }),
        );
        returned.push(hunter.id);
      }
    }

    return returned;
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
