/**
 * Skill definitions and compatibility lookup.
 *
 * Skill *eligibility* now lives in systems/constellation/Constellation (v1.0 §5) — this
 * registry is purely a lookup over skill definitions. Splitting them keeps the registry
 * usable by anything that needs a skill by id without dragging in graph traversal.
 *
 * REQ-SKL-004: note the absence of any reaction-skill concept. `riposte` is an ordinary
 * skill whose condition is `wasAttackedWithin`. Reactivity is a property of conditions.
 */

import type { GameContent } from '../../data/loader.js';
import type { SkillDef } from '../../data/schema.js';
import type { SkillId } from '../../core/ids.js';

export class SkillRegistry {
  private readonly content: GameContent;

  constructor(content: GameContent) {
    this.content = content;
  }

  all(): readonly SkillDef[] {
    return this.content.skills;
  }

  get(skillId: SkillId | string): SkillDef | undefined {
    return this.content.skillsById.get(skillId);
  }

  /** Throws — for call sites that have already validated the id (save loading, tests). */
  require(skillId: SkillId | string): SkillDef {
    const def = this.get(skillId);
    if (!def) throw new Error(`SkillRegistry: unknown skill "${skillId}"`);
    return def;
  }

  byCategory(category: SkillDef['category']): readonly SkillDef[] {
    return this.content.skills.filter((s) => s.category === category);
  }

  byTag(tag: string): readonly SkillDef[] {
    return this.content.skills.filter((s) => s.tags.includes(tag));
  }
}
