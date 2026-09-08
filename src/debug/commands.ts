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
import { isErr, type Result } from '../core/result.js';
import type { UseSignificance } from '../systems/skills/SkillMastery.js';

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

  /** §118 "Spawn Hunter". */
  spawnHunter(options: SpawnOptions = {}): Hunter {
    const { fullyEquipped, ...generateOptions } = options;
    let hunter = this.session.generateHunter(generateOptions);

    if (fullyEquipped) {
      for (const skill of this.session.registry.learnableBy(hunter)) {
        const learned = this.session.knowledge.learn(hunter, asSkillId(skill.id), 'book');
        if (learned.ok) hunter = learned.value;
      }
      const filled = this.session.knowledge.autoFill(hunter);
      if (filled.ok) hunter = filled.value;
      this.session.roster.update(hunter);
    }

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

  advance(hunterId: HunterId, classId: string): Result<Hunter, string> {
    return this.commands.advanceClass(hunterId, classId);
  }

  /**
   * Learn everything the hunter's current class chain permits and refill the loadout.
   *
   * Advancing a class opens new skills, and a hunter who never picks them up is not really
   * that class — so this models the realistic post-advancement flow. Phase 3 gives this to
   * the player as a training action; for now it keeps scenario setup honest.
   */
  refreshLoadout(hunterId: HunterId): Hunter {
    let hunter = this.session.roster.require(hunterId);

    for (const skill of this.session.registry.learnableBy(hunter)) {
      const learned = this.session.knowledge.learn(hunter, asSkillId(skill.id), 'advancement');
      if (learned.ok) hunter = learned.value;
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
      { globalMultiplier: this.session.condition.statMultiplier(hunter) },
    );

    return {
      name: hunter.name,
      level: hunter.level,
      classChain: this.session.classSystem.describeChain(hunter),
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

  learnableSkills(hunterId: HunterId): readonly string[] {
    const hunter = this.session.roster.require(hunterId);
    return this.session.registry.learnableBy(hunter).map((s) => s.id);
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
