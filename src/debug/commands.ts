/**
 * Developer console.
 *
 * REQ-TEC-006 (§118): debug tooling is built early, not bolted on. The §118 list is large
 * because most of it needs systems that do not exist yet; this is the Phase 1 subset, and
 * every command maps to one the spec names. Later phases add spawn monster, force
 * expedition, force boss, force loot, inspect threat, inspect utility, simulate offline.
 *
 * Never reachable from a production build — main.ts only attaches it when Vite reports a
 * dev build. Commands may deliberately bypass rules that gameplay must respect (learning
 * an incompatible skill, for instance) because their purpose is constructing impossible
 * hunters for AI scenario testing (§120, §140).
 */

import type { Session } from '../app/Session.js';
import { GuildCommands } from '../app/GuildCommands.js';
import type { AttributeKey, Role } from '../data/schema.js';
import {
  computeDerivedStats,
  DERIVED_STAT_DISPLAY_ORDER,
} from '../core/hunter/attributes.js';
import { applyExperience } from '../core/hunter/leveling.js';
import { asSkillId, type HunterId, type SkillId } from '../core/ids.js';
import { withLevel, type DepartmentId, type Hunter } from '../core/hunter/Hunter.js';
import { describeBuild, profileDistance } from '../systems/hunter/describeBuild.js';
import { err, isErr, ok, type Result } from '../core/result.js';
import type { UseSignificance } from '../systems/skills/SkillMastery.js';
import { EQUIPMENT_SLOTS } from '../data/itemSchema.js';
import { asItemId } from '../core/ids.js';
import { isPerfect, itemQuality, type Item } from '../core/items/Item.js';
import type { GenerateOptions } from '../systems/items/ItemGenerator.js';

export interface SpawnOptions {
  archetype?: string;
  personality?: string;
  preferredRole?: Role;
  preferredDepartment?: DepartmentId;
  level?: number;
  name?: string;
  /** Learn every compatible skill and auto-fill the loadout. Convenient for AI scenarios. */
  fullyEquipped?: boolean;
}

export class DebugConsole {
  /**
   * Legitimate player actions delegate to GuildCommands rather than being reimplemented,
   * so a rule cannot drift between the UI path and the debug path. Only the commands that
   * deliberately *bypass* rules are unique to this class.
   */
  private readonly commands: GuildCommands;

  constructor(private readonly session: Session) {
    this.commands = new GuildCommands(session);
  }

  // --- Spawning and mutation ------------------------------------------------

  /**
   * §118 "Spawn Hunter".
   *
   * `fullyEquipped` walks the hunter as far through the constellation as their starting
   * position legitimately reaches — it does **not** grant every skill. Granting everything
   * would make a Vanguard and an Adept hold identical loadouts, which silently destroys the
   * role differentiation the REQ-BLD-003 tests exist to prove. Use `grantSkill` when you
   * genuinely want an impossible hunter for an AI scenario.
   */
  spawnHunter(options: SpawnOptions = {}): Hunter {
    const { fullyEquipped, ...generateOptions } = options;
    const hunter = this.session.generateHunter(generateOptions);

    if (!fullyEquipped) return hunter;
    return this.refreshLoadout(hunter.id);
  }

  /** Grant every skill in the game, bypassing the constellation. For AI scenarios only. */
  grantAllSkills(hunterId: HunterId): Hunter {
    let hunter = this.session.roster.require(hunterId);
    for (const skill of this.session.registry.all()) {
      const learned = this.session.knowledge.learn(hunter, asSkillId(skill.id), 'debug');
      if (learned.ok) hunter = learned.value;
    }
    const filled = this.session.knowledge.autoFill(hunter);
    if (filled.ok) hunter = filled.value;

    this.session.roster.update(hunter);
    return hunter;
  }

  /** §118 "Modify Hunter Level". Grants the matching attribute point budget. */
  setLevel(hunterId: HunterId, level: number): Hunter {
    const hunter = this.session.roster.require(hunterId);
    const balance = this.session.content.balance.attributes;
    const clamped = Math.min(balance.maxLevel, Math.max(balance.minLevel, Math.floor(level)));
    const updated = withLevel(hunter, clamped, 0);
    this.session.roster.update(updated);
    this.session.events.emit('hunter.leveled', { hunterId, level: clamped });
    return updated;
  }

  grantExperience(hunterId: HunterId, amount: number): Hunter {
    const hunter = this.session.roster.require(hunterId);
    const balance = this.session.content.balance.attributes;
    const progress = applyExperience(hunter.level, hunter.xp, amount, balance);
    const updated = withLevel(hunter, progress.level, progress.xp);
    this.session.roster.update(updated);
    if (progress.levelsGained > 0) {
      this.session.events.emit('hunter.leveled', { hunterId, level: progress.level });
    }
    return updated;
  }

  /** Allocate attribute points, respecting the budget. */
  allocate(hunterId: HunterId, attribute: AttributeKey, amount: number): Result<Hunter, string> {
    return this.commands.allocateAttribute(hunterId, attribute, amount);
  }

  /**
   * Spend the whole remaining budget on one attribute.
   * The fastest way to produce two same-class hunters with genuinely different builds,
   * which is what the REQ-BLD-003 differentiation check needs.
   */
  maxOut(hunterId: HunterId, attribute: AttributeKey): Result<Hunter, string> {
    return this.commands.spendAllOn(hunterId, attribute);
  }

  respec(hunterId: HunterId): Hunter {
    return this.commands.respec(hunterId);
  }

  /** Take a constellation node through the normal rules. */
  takeNode(hunterId: HunterId, nodeId: string): Result<Hunter, string> {
    return this.commands.takeNode(hunterId, nodeId);
  }

  /** Grant the guild a skill book, making book-gated nodes reachable (v1.0 §5). */
  giveSkillBook(nodeId: string): void {
    this.session.armoury.addSkillBook(nodeId);
  }

  /**
   * Learn everything the hunter's current class chain permits and refill the loadout.
   *
   * Advancing a class opens new skills, and a hunter who never picks them up is not really
   * that class — so this models the realistic post-advancement flow. Phase 3 gives this to
   * the player as a training action; for now it keeps scenario setup honest.
   */
  refreshLoadout(hunterId: HunterId, options: { wander?: boolean } = {}): Hunter {
    let hunter = this.session.roster.require(hunterId);
    const home = hunter.archetype;

    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const node of this.session.constellation.availableNodes(hunter)) {
        // Build toward the hunter's own territory unless explicitly told to wander.
        // Taking every reachable node is not what a player does, and modelling it that way
        // made every archetype converge on the same profile — a Ranger who picks up Shield
        // Bash and Guard Stance simply because they *can* is not a Ranger any more.
        if (!options.wander) {
          const region = this.session.constellation.region(node.region);
          if (region && region.archetype !== home) continue;
        }

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

  /** Learn a skill, bypassing class compatibility (source: 'debug'). */
  grantSkill(hunterId: HunterId, skillId: string): Result<Hunter, string> {
    const hunter = this.session.roster.require(hunterId);
    const result = this.session.knowledge.learn(hunter, asSkillId(skillId), 'debug');
    if (isErr(result)) return result;
    this.session.roster.update(result.value);
    return result;
  }

  equip(hunterId: HunterId, skillId: string): Result<Hunter, string> {
    return this.commands.equipSkill(hunterId, skillId);
  }

  /** Simulate repeated use of a skill — the fastest route to a mastery-differentiated hunter. */
  grantMastery(
    hunterId: HunterId,
    skillId: string,
    uses: number,
    significance: UseSignificance = 'routine',
  ): Hunter {
    let hunter = this.session.roster.require(hunterId);
    const id = asSkillId(skillId);
    for (let i = 0; i < uses; i++) {
      hunter = this.session.mastery.gainFromUse(hunter, id, significance).hunter;
    }
    this.session.roster.update(hunter);
    return hunter;
  }

  // --- Items (§118 "Spawn Item", "Force Loot") -------------------------------

  /** §118 "Spawn Item". Generates from the loot stream so results stay reproducible. */
  spawnItem(options: GenerateOptions): Item {
    const item = this.session.itemGenerator.generate(this.session.streams.loot, options);
    this.session.armoury.add(item);
    return item;
  }

  /** §118 "Force Loot" — a batch through the real loot table, pity counter included. */
  forceLoot(count: number, itemLevel: number): readonly Item[] {
    const items = this.session.itemGenerator.generateMany(this.session.streams.loot, count, {
      itemLevel,
    });
    this.session.armoury.addMany(items);
    return items;
  }

  /** Grant a card directly, reporting whether the guild already had one (REQ-CRD-003). */
  giveCard(cardId: string): Result<{ duplicate: boolean }, string> {
    if (!this.session.cards.get(cardId)) return err(`unknown card "${cardId}"`);
    return ok(this.session.armoury.addCard(cardId));
  }

  /**
   * Kit a hunter out with a full set of items at their level, socketing whatever cards
   * fit. The fastest way to produce two gear-differentiated hunters for a build comparison.
   */
  outfit(
    hunterId: HunterId,
    options: { rarity?: string; setId?: string; itemLevel?: number } = {},
  ): Hunter {
    const hunter = this.session.roster.require(hunterId);
    const itemLevel = options.itemLevel ?? hunter.level;

    for (const slot of EQUIPMENT_SLOTS) {
      const item = this.spawnItem({
        itemLevel,
        slot,
        ...(options.rarity !== undefined ? { rarity: options.rarity } : {}),
        ...(options.setId !== undefined ? { setId: options.setId } : {}),
      });
      this.commands.equipItem(hunterId, String(item.id));
    }

    return this.session.roster.require(hunterId);
  }

  /** Socket every compatible card the guild holds into a hunter's gear. */
  socketAvailable(hunterId: HunterId): number {
    const hunter = this.session.roster.require(hunterId);
    let socketed = 0;

    for (const item of this.session.equipment.equippedItems(hunter)) {
      for (const card of this.session.cards.all()) {
        if (this.session.armoury.cardCount(card.id) <= 0) continue;
        const current = this.session.armoury.get(item.id);
        if (!current) break;
        if (!this.session.cards.canSocket(current, card.id).ok) continue;
        if (this.commands.socketCard(String(item.id), card.id).ok) socketed += 1;
      }
    }

    return socketed;
  }

  inspectItem(itemId: string): Record<string, unknown> {
    const item = this.session.armoury.require(asItemId(itemId));
    return {
      name: item.name,
      slot: item.slot,
      rarity: item.rarity,
      itemLevel: item.itemLevel,
      refinement: item.refinement,
      quality: Math.round(itemQuality(item) * 1000) / 1000,
      perfect: isPerfect(item, this.session.content.substats.perfectThreshold),
      mainStats: this.session.equipment.mainStats(item),
      substats: item.substats,
      sockets: item.socketed,
      setId: item.setId,
      uniqueEffectId: item.uniqueEffectId,
      value: this.session.armoury.sellValue(item),
    };
  }

  // --- Inspection -----------------------------------------------------------

  /** §118 "Inspect AI State" — the Phase 1 half: identity and derived stats. */
  inspect(hunterId: HunterId): Record<string, unknown> {
    const hunter = this.session.roster.require(hunterId);
    const profile = this.session.buildIdentity.profileOf(hunter);
    const description = describeBuild(profile);
    const stats = computeDerivedStats(
      hunter.attributes,
      hunter.level,
      this.session.content.balance.attributes,
      {
        globalMultiplier: this.session.condition.statMultiplier(hunter),
        flat: this.session.equipment.aggregateStats(hunter),
      },
    );

    return {
      name: hunter.name,
      level: hunter.level,
      identity: this.session.constellation.describeIdentity(hunter),
      attributes: hunter.attributes,
      derived: Object.fromEntries(
        DERIVED_STAT_DISPLAY_ORDER.map((k) => [k, Math.round((stats[k] ?? 0) * 10) / 10]),
      ),
      potentialTier: hunter.potential.tier,
      personality: this.session.personality.definition(hunter.personalityId)?.name,
      knownSkills: hunter.knownSkills.length,
      loadout: hunter.loadout,
      mastery: hunter.mastery,
      profile: {
        primaryRole: profile.primaryRole,
        secondaryRole: profile.secondaryRole,
        shape: profile.shape,
        focus: Math.round(profile.focus * 100) / 100,
        riskPosture: Math.round(profile.riskPosture * 100) / 100,
        resourceProfile: Math.round(profile.resourceProfile * 100) / 100,
        versatility: Math.round(profile.versatility * 100) / 100,
      },
      summary: description.summary,
      tendencies: description.tendencies,
      weaknesses: description.weaknesses,
      chronicle: this.session.chronicle.of(hunterId),
    };
  }

  /** How different are two hunters, really? The REQ-BLD-003 sanity check, on demand. */
  compare(a: HunterId, b: HunterId): { distance: number; a: string; b: string } {
    const first = this.session.buildIdentity.profileOf(this.session.roster.require(a));
    const second = this.session.buildIdentity.profileOf(this.session.roster.require(b));
    return {
      distance: Math.round(profileDistance(first, second) * 1000) / 1000,
      a: describeBuild(first).summary,
      b: describeBuild(second).summary,
    };
  }

  /** Nodes takeable right now. */
  availableNodes(hunterId: HunterId): readonly string[] {
    const hunter = this.session.roster.require(hunterId);
    return this.session.constellation.availableNodes(hunter).map((n) => n.id);
  }

  /** Reachable but not yet takeable, with the reasons — what the player is working toward. */
  frontier(hunterId: HunterId): readonly { nodeId: string; unmet: readonly string[] }[] {
    const hunter = this.session.roster.require(hunterId);
    return this.session.constellation
      .frontierNodes(hunter)
      .map((e) => ({ nodeId: e.nodeId, unmet: e.unmet }));
  }

  // --- Time and persistence -------------------------------------------------

  /** §118 "Fast-forward time". Runs real simulation steps, not a shortcut (DL-003). */
  fastForward(seconds: number): number {
    const steps = this.session.clock.stepsForMs(seconds * 1000);
    return this.session.clock.runSteps(steps, () => {
      // No per-step systems exist yet; Phase 4 hangs combat and Phase 6 town activity here.
    });
  }

  saveNow(slot = 'debug'): Result<unknown, string> {
    return this.session.save.save(slot, this.session.snapshot(), 'Debug save');
  }

  loadNow(slot = 'debug'): Result<true, string> {
    const loaded = this.session.save.load(slot);
    if (isErr(loaded)) return loaded;
    this.session.restore(loaded.value);
    return { ok: true, value: true };
  }

  /** §118 "Reset test scenario". */
  reset(): void {
    this.session.roster.clear();
  }

  listHunters(): readonly { id: HunterId; name: string; level: number; role: Role }[] {
    return this.session.roster.all().map((h) => ({
      id: h.id,
      name: h.name,
      level: h.level,
      role: this.session.buildIdentity.profileOf(h).primaryRole,
    }));
  }

  skills(): readonly { id: SkillId; name: string; category: string }[] {
    return this.session.registry.all().map((s) => ({
      id: asSkillId(s.id),
      name: s.name,
      category: s.category,
    }));
  }
}
