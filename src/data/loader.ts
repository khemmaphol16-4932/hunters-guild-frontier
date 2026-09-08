/**
 * Content loading and cross-reference validation.
 *
 * Validation happens once, at load. Two layers:
 *   1. per-file shape validation (schema.ts)
 *   2. cross-file referential integrity (here) — a skill compatibility rule naming a class
 *      that does not exist, or a specialization whose parent is missing, is a content bug
 *      that must fail at startup rather than producing a hunter who can never learn anything.
 *
 * REQ-TEC-002, §134 (reasonable error handling).
 */

import archetypesJson from './archetypes.json';
import advancedClassesJson from './advanced-classes.json';
import specializationsJson from './specializations.json';
import skillsJson from './skills.json';
import skillCompatibilityJson from './skill-compatibility.json';
import personalitiesJson from './personalities.json';
import traitsJson from './traits.json';
import namesJson from './names.json';

import attributeBalanceJson from './balance/attributes.json';
import masteryBalanceJson from './balance/mastery.json';
import buildIdentityBalanceJson from './balance/build-identity.json';
import potentialBalanceJson from './balance/potential.json';
import personalityBalanceJson from './balance/personality.json';
import chronicleBalanceJson from './balance/chronicle.json';

import {
  ContentValidationError,
  parseAdvancedClasses,
  parseArchetypes,
  parseAttributeBalance,
  parseBuildIdentityBalance,
  parseChronicleBalance,
  parseMasteryBalance,
  parsePersonalities,
  parsePersonalityBalance,
  parsePotentialBalance,
  parseSkillCompatibility,
  parseSkills,
  parseSpecializations,
  parseTraits,
  parseNamePools,
  type AttributeBalance,
  type BuildIdentityBalance,
  type ChronicleBalance,
  type ClassNodeDef,
  type MasteryBalance,
  type NamePool,
  type PersonalityBalance,
  type PersonalityDef,
  type PotentialBalance,
  type SkillCompatibilityData,
  type SkillDef,
  type TraitDef,
} from './schema.js';

export interface GameContent {
  readonly archetypes: readonly ClassNodeDef[];
  readonly advancedClasses: readonly ClassNodeDef[];
  readonly specializations: readonly ClassNodeDef[];
  /** Every class node from all three stages, indexed by id. */
  readonly classNodes: ReadonlyMap<string, ClassNodeDef>;
  readonly skills: readonly SkillDef[];
  readonly skillsById: ReadonlyMap<string, SkillDef>;
  readonly skillCompatibility: SkillCompatibilityData;
  readonly personalities: readonly PersonalityDef[];
  readonly personalitiesById: ReadonlyMap<string, PersonalityDef>;
  readonly traits: readonly TraitDef[];
  readonly traitsById: ReadonlyMap<string, TraitDef>;
  readonly namePools: readonly NamePool[];
  readonly balance: {
    readonly attributes: AttributeBalance;
    readonly mastery: MasteryBalance;
    readonly buildIdentity: BuildIdentityBalance;
    readonly potential: PotentialBalance;
    readonly personality: PersonalityBalance;
    readonly chronicle: ChronicleBalance;
  };
}

function crossValidate(content: {
  archetypes: readonly ClassNodeDef[];
  advancedClasses: readonly ClassNodeDef[];
  specializations: readonly ClassNodeDef[];
  skills: readonly SkillDef[];
  skillCompatibility: SkillCompatibilityData;
}): void {
  const archetypeIds = new Set(content.archetypes.map((a) => a.id));
  const advancedIds = new Set(content.advancedClasses.map((a) => a.id));
  const specializationIds = new Set(content.specializations.map((s) => s.id));
  const skillIds = new Set(content.skills.map((s) => s.id));

  for (const advanced of content.advancedClasses) {
    if (advanced.parent === undefined || !archetypeIds.has(advanced.parent)) {
      throw new ContentValidationError(
        `advanced-classes.json:${advanced.id}`,
        `archetype "${advanced.parent ?? '<missing>'}" does not exist`,
      );
    }
  }

  for (const spec of content.specializations) {
    if (spec.parent === undefined || !advancedIds.has(spec.parent)) {
      throw new ContentValidationError(
        `specializations.json:${spec.id}`,
        `advancedClass "${spec.parent ?? '<missing>'}" does not exist`,
      );
    }
  }

  for (const rule of content.skillCompatibility.rules) {
    const where = `skill-compatibility.json:${rule.skill}`;
    if (!skillIds.has(rule.skill)) {
      throw new ContentValidationError(where, 'names a skill that does not exist');
    }
    for (const id of rule.archetypes) {
      if (!archetypeIds.has(id)) {
        throw new ContentValidationError(where, `unknown archetype "${id}"`);
      }
    }
    for (const id of rule.advancedClasses) {
      if (!advancedIds.has(id)) {
        throw new ContentValidationError(where, `unknown advanced class "${id}"`);
      }
    }
    for (const id of rule.specializations) {
      if (!specializationIds.has(id)) {
        throw new ContentValidationError(where, `unknown specialization "${id}"`);
      }
    }
  }

  // Every skill must be reachable by someone, or it is dead content.
  const ruledSkills = new Set(content.skillCompatibility.rules.map((r) => r.skill));
  for (const skill of content.skills) {
    if (!ruledSkills.has(skill.id) && content.skillCompatibility.defaultPolicy === 'deny') {
      throw new ContentValidationError(
        `skills.json:${skill.id}`,
        'has no compatibility rule and the default policy is deny, so no hunter could ever learn it',
      );
    }
  }
}

let cached: GameContent | undefined;

/**
 * Load, validate and freeze all game content.
 * Cached after the first successful load — content is immutable at runtime.
 */
export function loadContent(): GameContent {
  if (cached) return cached;

  const archetypes = parseArchetypes(archetypesJson);
  const advancedClasses = parseAdvancedClasses(advancedClassesJson);
  const specializations = parseSpecializations(specializationsJson);
  const skills = parseSkills(skillsJson);
  const skillCompatibility = parseSkillCompatibility(skillCompatibilityJson);
  const personalities = parsePersonalities(personalitiesJson);
  const traits = parseTraits(traitsJson);

  crossValidate({ archetypes, advancedClasses, specializations, skills, skillCompatibility });

  const classNodes = new Map<string, ClassNodeDef>();
  for (const node of [...archetypes, ...advancedClasses, ...specializations]) {
    if (classNodes.has(node.id)) {
      throw new ContentValidationError(
        `class chain:${node.id}`,
        'id collides across class stages; ids must be unique across the whole chain',
      );
    }
    classNodes.set(node.id, node);
  }

  cached = Object.freeze({
    archetypes,
    advancedClasses,
    specializations,
    classNodes,
    skills,
    skillsById: new Map(skills.map((s) => [s.id, s])),
    skillCompatibility,
    personalities,
    personalitiesById: new Map(personalities.map((p) => [p.id, p])),
    traits,
    traitsById: new Map(traits.map((t) => [t.id, t])),
    namePools: parseNamePools(namesJson),
    balance: {
      attributes: parseAttributeBalance(attributeBalanceJson),
      mastery: parseMasteryBalance(masteryBalanceJson),
      buildIdentity: parseBuildIdentityBalance(buildIdentityBalanceJson),
      potential: parsePotentialBalance(potentialBalanceJson),
      personality: parsePersonalityBalance(personalityBalanceJson),
      chronicle: parseChronicleBalance(chronicleBalanceJson),
    },
  });

  return cached;
}

/** Test affordance: force a fresh validation pass. Never used by gameplay code. */
export function resetContentCache(): void {
  cached = undefined;
}
