/**
 * Skill knowledge and the active loadout.
 *
 * REQ-SKL-001/002. A hunter may know unlimited skills but equips only 6–8. Keeping these
 * two separate is what makes a veteran feel like a veteran: a hunter with forty known
 * skills and eight equipped is a different proposition from one who only ever learned eight,
 * even when both are running the same loadout — the difference shows up as versatility in
 * build identity (§16, the Skill Books axis).
 */

import type { SkillId } from '../../core/ids.js';
import type { Hunter } from '../../core/hunter/Hunter.js';
import { withKnownSkills, withLoadout } from '../../core/hunter/Hunter.js';
import { err, ok, type Result } from '../../core/result.js';
import type { EventBus } from '../../core/events.js';
import type { SkillRegistry } from './SkillRegistry.js';
import type { Constellation } from '../constellation/Constellation.js';

export const MIN_LOADOUT_SIZE = 6;
export const MAX_LOADOUT_SIZE = 8;

export interface SkillKnowledgeDeps {
  readonly registry: SkillRegistry;
  readonly constellation: Constellation;
  readonly events: EventBus;
}

export class SkillKnowledge {
  private readonly registry: SkillRegistry;
  private readonly constellation: Constellation;
  private readonly events: EventBus;

  constructor(deps: SkillKnowledgeDeps) {
    this.registry = deps.registry;
    this.constellation = deps.constellation;
    this.events = deps.events;
  }

  /**
   * Record that a hunter now knows a skill — equivalently, that they have taken its
   * constellation node. The two are the same act (v1.0 §5).
   *
   * Eligibility is checked here rather than at the call site so that skill books, node
   * selection and the debug console cannot diverge on what is legal.
   */
  learn(
    hunter: Hunter,
    skillId: SkillId,
    source: 'book' | 'node' | 'debug',
  ): Result<Hunter, string> {
    if (hunter.knownSkills.includes(skillId)) {
      return err(`${hunter.name} already knows ${this.label(skillId)}`);
    }

    // Debug bypasses eligibility deliberately — it exists to construct impossible hunters
    // for AI scenario testing (§118). Nothing in gameplay uses this source.
    if (source !== 'debug') {
      const node = this.constellation.nodeForSkill(String(skillId));
      if (!node) {
        return err(`no constellation node teaches ${this.label(skillId)}`);
      }

      const verdict = this.constellation.eligibility(hunter, node.id);
      if (!verdict.eligible) return err(verdict.unmet.join('; '));
    }

    const updated = withKnownSkills(hunter, [...hunter.knownSkills, skillId]);
    this.events.emit('skill.learned', { hunterId: hunter.id, skillId, source });
    return ok(updated);
  }

  /**
   * Replace the active loadout wholesale.
   *
   * Validates size, membership and duplicates. The lower bound is enforced only when the
   * hunter actually knows enough skills to fill it — a level-1 recruit with three skills
   * must still be able to equip all three.
   */
  setLoadout(hunter: Hunter, loadout: readonly SkillId[]): Result<Hunter, string> {
    const unique = new Set(loadout);
    if (unique.size !== loadout.length) {
      return err('a loadout cannot contain the same skill twice');
    }
    if (loadout.length > MAX_LOADOUT_SIZE) {
      return err(`a loadout holds at most ${MAX_LOADOUT_SIZE} skills, got ${loadout.length}`);
    }

    const knowable = Math.min(hunter.knownSkills.length, MIN_LOADOUT_SIZE);
    if (loadout.length < knowable) {
      return err(
        `a loadout should hold at least ${knowable} skills while ${hunter.name} knows ${hunter.knownSkills.length}`,
      );
    }

    for (const skillId of loadout) {
      if (!hunter.knownSkills.includes(skillId)) {
        return err(`${hunter.name} does not know ${this.label(skillId)}`);
      }
    }

    const updated = withLoadout(hunter, [...loadout]);
    this.events.emit('loadout.changed', { hunterId: hunter.id, skills: updated.loadout });
    return ok(updated);
  }

  /** Add one skill to the loadout without disturbing the rest. */
  equip(hunter: Hunter, skillId: SkillId): Result<Hunter, string> {
    if (hunter.loadout.includes(skillId)) {
      return err(`${this.label(skillId)} is already equipped`);
    }
    if (hunter.loadout.length >= MAX_LOADOUT_SIZE) {
      return err(`loadout is full (${MAX_LOADOUT_SIZE} skills)`);
    }
    if (!hunter.knownSkills.includes(skillId)) {
      return err(`${hunter.name} does not know ${this.label(skillId)}`);
    }
    const updated = withLoadout(hunter, [...hunter.loadout, skillId]);
    this.events.emit('loadout.changed', { hunterId: hunter.id, skills: updated.loadout });
    return ok(updated);
  }

  unequip(hunter: Hunter, skillId: SkillId): Result<Hunter, string> {
    if (!hunter.loadout.includes(skillId)) {
      return err(`${this.label(skillId)} is not equipped`);
    }
    const updated = withLoadout(
      hunter,
      hunter.loadout.filter((s) => s !== skillId),
    );
    this.events.emit('loadout.changed', { hunterId: hunter.id, skills: updated.loadout });
    return ok(updated);
  }

  /**
   * Fill the loadout with the highest-base-priority known skills.
   * Used by recruitment and the debug console to give a hunter something sensible to do
   * before the player configures them; never overrides an existing loadout.
   */
  autoFill(hunter: Hunter): Result<Hunter, string> {
    const candidates = hunter.knownSkills
      .filter((s) => !hunter.loadout.includes(s))
      .map((id) => ({ id, def: this.registry.get(id) }))
      .filter((c): c is { id: SkillId; def: NonNullable<typeof c.def> } => c.def !== undefined)
      .sort((a, b) => b.def.basePriority - a.def.basePriority);

    const room = MAX_LOADOUT_SIZE - hunter.loadout.length;
    const additions = candidates.slice(0, Math.max(0, room)).map((c) => c.id);
    if (additions.length === 0) return ok(hunter);

    return this.setLoadout(hunter, [...hunter.loadout, ...additions]);
  }

  private label(skillId: SkillId): string {
    return this.registry.get(skillId)?.name ?? String(skillId);
  }
}
