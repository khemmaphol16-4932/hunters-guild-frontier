/**
 * Skill definitions and compatibility lookup.
 *
 * REQ-CLS-004: only *some* skills cross class boundaries, and compatibility is data-driven.
 * The default policy is deny (skill-compatibility.json), so a skill with no rule is
 * unlearnable by everyone — content that silently grants universal access is the failure
 * mode this guards against.
 *
 * REQ-SKL-004: note the absence of any reaction-skill concept. `riposte` is an ordinary
 * skill whose condition is `wasAttackedWithin`. Reactivity is a property of conditions.
 */

import type { GameContent } from '../../data/loader.js';
import type { SkillCompatibilityRule, SkillDef } from '../../data/schema.js';
import type { SkillId } from '../../core/ids.js';
import type { Hunter } from '../../core/hunter/Hunter.js';
import { classChainIds } from '../../core/hunter/Hunter.js';

export interface CompatibilityVerdict {
  readonly allowed: boolean;
  /** Which stage of the chain granted access — useful for explaining the decision. */
  readonly grantedBy: string | undefined;
  readonly reason: string;
}

export class SkillRegistry {
  private readonly content: GameContent;
  private readonly rulesBySkill: ReadonlyMap<string, SkillCompatibilityRule>;

  constructor(content: GameContent) {
    this.content = content;
    this.rulesBySkill = new Map(
      content.skillCompatibility.rules.map((rule) => [rule.skill, rule]),
    );
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

  rule(skillId: SkillId | string): SkillCompatibilityRule | undefined {
    return this.rulesBySkill.get(skillId);
  }

  /**
   * Can this hunter learn this skill?
   *
   * A skill is allowed if *any* node in the hunter's class chain is listed in its rule.
   * Listing the archetype makes it available for the whole branch; listing only a
   * specialization makes it a genuinely specialised skill.
   */
  canLearn(hunter: Hunter, skillId: SkillId | string): CompatibilityVerdict {
    const def = this.get(skillId);
    if (!def) {
      return { allowed: false, grantedBy: undefined, reason: `unknown skill "${skillId}"` };
    }

    const rule = this.rule(skillId);
    if (!rule) {
      if (this.content.skillCompatibility.defaultPolicy === 'allow') {
        return { allowed: true, grantedBy: undefined, reason: 'default policy allows' };
      }
      return {
        allowed: false,
        grantedBy: undefined,
        reason: `${def.name} has no compatibility rule and the default policy is deny`,
      };
    }

    const chain = classChainIds(hunter);
    const permitted = new Set([
      ...rule.archetypes,
      ...rule.advancedClasses,
      ...rule.specializations,
    ]);

    for (const nodeId of chain) {
      if (permitted.has(nodeId)) {
        const node = this.content.classNodes.get(nodeId);
        return {
          allowed: true,
          grantedBy: nodeId,
          reason: `available to ${node?.name ?? nodeId}`,
        };
      }
    }

    return {
      allowed: false,
      grantedBy: undefined,
      reason: `${def.name} is not available to ${chain.join(' → ')}`,
    };
  }

  /** Every skill this hunter could currently learn. Drives the skill book UI. */
  learnableBy(hunter: Hunter): readonly SkillDef[] {
    return this.content.skills.filter((s) => this.canLearn(hunter, s.id).allowed);
  }

  /** Skills flagged as crossing class boundaries — the hybrid-build surface (REQ-CLS-005). */
  crossClassSkills(): readonly SkillDef[] {
    return this.content.skills.filter((s) => this.rule(s.id)?.crossClass === true);
  }

  byCategory(category: SkillDef['category']): readonly SkillDef[] {
    return this.content.skills.filter((s) => s.category === category);
  }

  byTag(tag: string): readonly SkillDef[] {
    return this.content.skills.filter((s) => s.tags.includes(tag));
  }
}
