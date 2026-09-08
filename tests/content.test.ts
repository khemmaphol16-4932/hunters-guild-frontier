/**
 * Content validation. REQ-TEC-002 — a malformed content file must fail loudly at load,
 * not surface as undefined in the middle of combat.
 */

import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/data/loader.js';
import {
  ContentValidationError,
  parseSkills,
  parseArchetypes,
  parseAttributeBalance,
  SKILL_CATEGORIES,
} from '../src/data/schema.js';

const content = loadContent();

describe('content loads and cross-validates', () => {
  it('loads every content file', () => {
    expect(content.archetypes.length).toBeGreaterThan(0);
    expect(content.advancedClasses.length).toBeGreaterThan(0);
    expect(content.specializations.length).toBeGreaterThan(0);
    expect(content.skills.length).toBeGreaterThanOrEqual(10);
    expect(content.personalities.length).toBeGreaterThan(0);
    expect(content.traits.length).toBeGreaterThan(0);
    expect(content.namePools.length).toBeGreaterThan(0);
  });

  it('indexes every class node uniquely across all three stages', () => {
    const total =
      content.archetypes.length + content.advancedClasses.length + content.specializations.length;
    expect(content.classNodes.size).toBe(total);
  });

  it('gives every advanced class a real archetype parent', () => {
    const archetypeIds = new Set(content.archetypes.map((a) => a.id));
    for (const advanced of content.advancedClasses) {
      expect(archetypeIds.has(advanced.parent ?? '')).toBe(true);
    }
  });

  it('gives every specialization a real advanced-class parent', () => {
    const advancedIds = new Set(content.advancedClasses.map((a) => a.id));
    for (const spec of content.specializations) {
      expect(advancedIds.has(spec.parent ?? '')).toBe(true);
    }
  });

  it('gives every archetype at least two advanced options and each of those two specializations', () => {
    // Fewer would make the class chain a formality rather than a decision (REQ-CLS-001).
    for (const archetype of content.archetypes) {
      const advanced = content.advancedClasses.filter((a) => a.parent === archetype.id);
      expect(advanced.length).toBeGreaterThanOrEqual(2);
      for (const node of advanced) {
        const specs = content.specializations.filter((s) => s.parent === node.id);
        expect(specs.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('makes every skill learnable by someone', () => {
    const ruled = new Set(content.skillCompatibility.rules.map((r) => r.skill));
    for (const skill of content.skills) {
      expect(ruled.has(skill.id)).toBe(true);
    }
  });

  it('covers the categories §139 asks a prototype to demonstrate', () => {
    const categories = new Set(content.skills.map((s) => s.category));
    // damage/heal/buff come through 'active' and 'buff'; the structural ones are checked here.
    expect(categories.has('ultimate')).toBe(true);
    expect(categories.has('party')).toBe(true);
    expect(categories.has('debuff')).toBe(true);
    expect(categories.has('trigger')).toBe(true);

    // Rescue is a tag, not a category — rescue must exist somewhere (REQ-CBT-013).
    expect(content.skills.some((s) => s.tags.includes('rescue'))).toBe(true);
  });

  it('has no reaction category (REQ-SKL-004)', () => {
    expect(SKILL_CATEGORIES).not.toContain('reaction');
  });

  it('expresses reactive behavior through conditions instead', () => {
    const riposte = content.skillsById.get('riposte');
    expect(riposte).toBeDefined();
    expect(riposte?.conditions.some((c) => c.type === 'wasAttackedWithin')).toBe(true);
  });

  it('gives every skill a usability condition beyond its cooldown (REQ-SKL-006)', () => {
    for (const skill of content.skills) {
      expect(skill.conditions.length).toBeGreaterThan(0);
    }
  });

  it('marks some but not all skills as cross-class (REQ-CLS-004)', () => {
    const crossClass = content.skillCompatibility.rules.filter((r) => r.crossClass);
    expect(crossClass.length).toBeGreaterThan(0);
    expect(crossClass.length).toBeLessThan(content.skillCompatibility.rules.length);
  });

  it('defaults to deny so unruled content cannot silently become universal', () => {
    expect(content.skillCompatibility.defaultPolicy).toBe('deny');
  });
});

describe('validation rejects malformed content', () => {
  it('reports the exact path of a bad field', () => {
    expect(() =>
      parseSkills({ skills: [{ id: 'x', name: 'X', category: 'nonsense' }] }),
    ).toThrow(ContentValidationError);

    try {
      parseSkills({ skills: [{ id: 'x', name: 'X', category: 'nonsense' }] });
    } catch (error) {
      expect((error as ContentValidationError).message).toContain('skills.json.skills[0].category');
    }
  });

  it('rejects a missing required field', () => {
    expect(() => parseArchetypes({ archetypes: [{ id: 'a' }] })).toThrow(/name.*missing/);
  });

  it('rejects duplicate ids', () => {
    expect(() =>
      parseSkills({
        skills: [
          {
            id: 'dup',
            name: 'A',
            category: 'active',
            tags: [],
            element: null,
            targeting: 'enemy',
            rangeBand: 'melee',
            resourceCost: 1,
            cooldownSeconds: 1,
            basePriority: 1,
            conditions: [],
            masteryEffects: [],
            roleContribution: {},
            description: 'a',
          },
          {
            id: 'dup',
            name: 'B',
            category: 'active',
            tags: [],
            element: null,
            targeting: 'enemy',
            rangeBand: 'melee',
            resourceCost: 1,
            cooldownSeconds: 1,
            basePriority: 1,
            conditions: [],
            masteryEffects: [],
            roleContribution: {},
            description: 'b',
          },
        ],
      }),
    ).toThrow(/duplicate id/);
  });

  it('rejects an unknown role key in a weight map', () => {
    expect(() =>
      parseArchetypes({
        archetypes: [
          {
            id: 'a',
            name: 'A',
            description: 'd',
            roleLean: { wizard: 1 },
            rangeBand: {},
            attributeAffinity: {},
            riskPostureShift: 0,
            skillTags: [],
          },
        ],
      }),
    ).toThrow(/unknown key/);
  });

  it('rejects a cap on a derived stat that does not exist', () => {
    expect(() =>
      parseAttributeBalance({
        startingValue: 5,
        pointsPerLevel: 3,
        startingPoints: 5,
        minLevel: 1,
        maxLevel: 100,
        xpCurve: { base: 100, exponent: 1.5 },
        respec: { resourceId: 'x', costPerPointMoved: 1, freeMovesPerLevel: 0 },
        derived: { maxHp: { base: 1, perLevel: 1, from: { vit: 1 } } },
        caps: { doesNotExist: 10 },
      }),
    ).toThrow(/caps a derived stat that is not defined/);
  });
});

describe('balance data', () => {
  it('uses the §16 source weights verbatim', () => {
    // REQ-BLD-002 is a locked ratio: Class 2, Attributes 2, Skills 2, Equipment 2,
    // Cards 1, Skill Books 1.
    expect(content.balance.buildIdentity.sourceWeights).toEqual({
      class: 2,
      attributes: 2,
      skills: 2,
      equipment: 2,
      cards: 1,
      skillBooks: 1,
    });
  });

  it('caps hunter level at 100 (REQ-HUN-004)', () => {
    expect(content.balance.attributes.maxLevel).toBe(100);
  });

  it('gives every mastery effect type a saturating curve (DL-005)', () => {
    for (const curve of Object.values(content.balance.mastery.effectCurves)) {
      expect(curve.halfPoint).toBeGreaterThan(0);
      expect(curve.maxBonus).toBeGreaterThan(0);
    }
  });

  it('bounds personality shifts so they cannot overturn policy (DL-007)', () => {
    const clamp = content.balance.personality.clamp;
    expect(Math.abs(clamp.riskPostureShift.max)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(clamp.roleLeanShift.max)).toBeLessThanOrEqual(0.25);
  });
});
