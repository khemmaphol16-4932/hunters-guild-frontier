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
import { withAttributes, type Hunter } from '../core/hunter/Hunter.js';
import { asSkillId, type HunterId } from '../core/ids.js';
import { err, isErr, ok, type Result } from '../core/result.js';
import type { UseSignificance } from '../systems/skills/SkillMastery.js';

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
