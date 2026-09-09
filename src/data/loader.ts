/**
 * Content loading and cross-reference validation.
 *
 * Validation happens once, at load. Two layers:
 *   1. per-file shape validation (schema.ts, itemSchema.ts, constellationSchema.ts)
 *   2. cross-file referential integrity (here) — a constellation node pointing at a skill or
 *      region that does not exist is a content bug that must fail at startup rather than
 *      producing a hunter who can never learn anything.
 *
 * REQ-TEC-002, §134 (reasonable error handling).
 */

import archetypesJson from './archetypes.json';
import skillsJson from './skills.json';
import personalitiesJson from './personalities.json';
import traitsJson from './traits.json';
import namesJson from './names.json';

import regionsJson from './constellation/regions.json';
import constellationJson from './constellation/nodes.json';

import raritiesJson from './items/rarities.json';
import itemTypesJson from './items/item-types.json';
import substatsJson from './items/substats.json';
import cardsJson from './items/cards.json';
import setsJson from './items/sets.json';
import uniqueEffectsJson from './items/unique-effects.json';

import attributeBalanceJson from './balance/attributes.json';
import refinementBalanceJson from './balance/refinement.json';
import lootBalanceJson from './balance/loot.json';
import policyPrecedenceJson from './policy/precedence.json';
import masteryBalanceJson from './balance/mastery.json';
import buildIdentityBalanceJson from './balance/build-identity.json';
import potentialBalanceJson from './balance/potential.json';
import personalityBalanceJson from './balance/personality.json';
import chronicleBalanceJson from './balance/chronicle.json';

import {
  ContentValidationError,
  parseArchetypes,
  parseAttributeBalance,
  parseBuildIdentityBalance,
  parseChronicleBalance,
  parseMasteryBalance,
  parsePersonalities,
  parsePersonalityBalance,
  parsePotentialBalance,
  parseSkills,
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
  type SkillDef,
  type TraitDef,
} from './schema.js';

import {
  parseConstellation,
  parseRegions,
  validateConstellationGraph,
  type ConstellationData,
  type ConstellationNodeDef,
  type RegionDef,
} from './constellationSchema.js';

import {
  parseCards,
  parseItemTypes,
  parseLootBalance,
  parseRarities,
  parseRefinementBalance,
  parseSets,
  parseSubstats,
  parseUniqueEffects,
  parsePolicyPrecedence,
  type CardDef,
  type ItemTypeData,
  type ItemTypeDef,
  type LootBalance,
  type PolicyPrecedence,
  type RarityData,
  type RarityDef,
  type RefinementBalance,
  type SetDef,
  type SubstatData,
  type UniqueEffectDef,
} from './itemSchema.js';

export interface GameContent {
  /** Starting positions in the constellation (v1.0 §5). */
  readonly archetypes: readonly ClassNodeDef[];
  readonly archetypesById: ReadonlyMap<string, ClassNodeDef>;

  /** Named areas of the constellation. Descriptive, never gates. */
  readonly regions: readonly RegionDef[];
  readonly regionsById: ReadonlyMap<string, RegionDef>;
  readonly constellation: ConstellationData;
  readonly constellationNodesById: ReadonlyMap<string, ConstellationNodeDef>;

  readonly skills: readonly SkillDef[];
  readonly skillsById: ReadonlyMap<string, SkillDef>;
  readonly personalities: readonly PersonalityDef[];
  readonly personalitiesById: ReadonlyMap<string, PersonalityDef>;
  readonly traits: readonly TraitDef[];
  readonly traitsById: ReadonlyMap<string, TraitDef>;
  readonly namePools: readonly NamePool[];

  readonly rarities: RarityData;
  readonly raritiesById: ReadonlyMap<string, RarityDef>;
  readonly itemTypes: ItemTypeData;
  readonly itemTypesById: ReadonlyMap<string, ItemTypeDef>;
  readonly substats: SubstatData;
  readonly cards: readonly CardDef[];
  readonly cardsById: ReadonlyMap<string, CardDef>;
  readonly sets: readonly SetDef[];
  readonly setsById: ReadonlyMap<string, SetDef>;
  readonly uniqueEffects: readonly UniqueEffectDef[];
  readonly uniqueEffectsById: ReadonlyMap<string, UniqueEffectDef>;

  /** v1.0 §2.1 canonical precedence, as data rather than as source order. */
  readonly policyPrecedence: PolicyPrecedence;

  readonly balance: {
    readonly attributes: AttributeBalance;
    readonly mastery: MasteryBalance;
    readonly buildIdentity: BuildIdentityBalance;
    readonly potential: PotentialBalance;
    readonly personality: PersonalityBalance;
    readonly chronicle: ChronicleBalance;
    readonly refinement: RefinementBalance;
    readonly loot: LootBalance;
  };
}

/**
 * Constellation referential integrity.
 *
 * The failures this prevents are all silent: a node teaching a skill that does not exist, a
 * skill no node teaches (unlearnable content), or a region belonging to an archetype that
 * was deleted. None of these crash — they just quietly remove capability.
 */
function crossValidateConstellation(content: {
  archetypes: readonly ClassNodeDef[];
  regions: readonly RegionDef[];
  constellation: ConstellationData;
  skills: readonly SkillDef[];
  itemTypes: ItemTypeData;
}): void {
  const archetypeIds = new Set(content.archetypes.map((a) => a.id));
  const regionIds = new Set(content.regions.map((r) => r.id));
  const skillIds = new Set(content.skills.map((s) => s.id));
  const itemTypeIds = new Set(content.itemTypes.types.map((t) => t.id));

  for (const region of content.regions) {
    if (!archetypeIds.has(region.archetype)) {
      throw new ContentValidationError(
        `regions.json:${region.id}`,
        `unknown archetype "${region.archetype}"`,
      );
    }
    if (region.parent !== undefined && !regionIds.has(region.parent)) {
      throw new ContentValidationError(
        `regions.json:${region.id}`,
        `parent region "${region.parent}" does not exist`,
      );
    }
  }

  for (const node of content.constellation.nodes) {
    if (!skillIds.has(node.skill)) {
      throw new ContentValidationError(
        `nodes.json:${node.id}`,
        `teaches skill "${node.skill}", which does not exist`,
      );
    }
    for (const weaponType of node.requiresWeaponTypes ?? []) {
      if (!itemTypeIds.has(weaponType)) {
        throw new ContentValidationError(
          `nodes.json:${node.id}`,
          `requires weapon type "${weaponType}", which does not exist`,
        );
      }
    }
  }

  // Every skill must be taught by some node, or it is unlearnable content.
  const taught = new Set(content.constellation.nodes.map((n) => n.skill));
  for (const skill of content.skills) {
    if (!taught.has(skill.id)) {
      throw new ContentValidationError(
        `skills.json:${skill.id}`,
        'no constellation node teaches this skill, so no hunter could ever learn it',
      );
    }
  }

  validateConstellationGraph(content.constellation, regionIds, archetypeIds);
}

/**
 * Item content referential integrity.
 *
 * The failure this prevents is a card that can never be socketed or a substat pool an item
 * type points at but which does not exist — both produce items that look fine and then do
 * nothing, which is far harder to notice than a crash.
 */
function crossValidateItems(content: {
  rarities: RarityData;
  itemTypes: ItemTypeData;
  substats: SubstatData;
  cards: readonly CardDef[];
  uniqueEffects: readonly UniqueEffectDef[];
  skills: readonly SkillDef[];
}): void {
  const rarityIds = new Set(content.rarities.rarities.map((r) => r.id));
  const poolNames = new Set(Object.keys(content.substats.pools));

  for (const type of content.itemTypes.types) {
    if (!poolNames.has(type.substatPool)) {
      throw new ContentValidationError(
        `item-types.json:${type.id}`,
        `substatPool "${type.substatPool}" does not exist`,
      );
    }
  }

  for (const card of content.cards) {
    if (!rarityIds.has(card.rarity)) {
      throw new ContentValidationError(
        `cards.json:${card.id}`,
        `unknown rarity "${card.rarity}"`,
      );
    }
    const fits = content.itemTypes.types.some((type) => {
      if (!card.compatibleSlots.includes(type.slot)) return false;
      if (card.compatibleTags.length === 0) return true;
      return card.compatibleTags.some((tag) => tag in type.skillAffinity);
    });
    if (!fits) {
      throw new ContentValidationError(
        `cards.json:${card.id}`,
        'no existing item type matches its slots and tags, so it could never be socketed',
      );
    }
  }

  const skillTags = new Set(content.skills.flatMap((s) => s.tags));
  const checkTags = (source: string, effects: readonly { tag: string | undefined }[]): void => {
    for (const effect of effects) {
      if (effect.tag === undefined || effect.tag === '*') continue;
      if (!skillTags.has(effect.tag)) {
        throw new ContentValidationError(
          source,
          `references skill tag "${effect.tag}", which no skill carries`,
        );
      }
    }
  };

  for (const card of content.cards) checkTags(`cards.json:${card.id}`, card.effects);
  for (const unique of content.uniqueEffects) {
    checkTags(`unique-effects.json:${unique.id}`, unique.effects);
  }

  const uniqueSlots = new Set(content.uniqueEffects.flatMap((e) => e.slots));
  const legendaryCapable = content.rarities.rarities.some((r) => r.canCarryUniqueEffect);
  if (legendaryCapable && uniqueSlots.size === 0) {
    throw new ContentValidationError(
      'unique-effects.json',
      'a rarity can carry a unique effect but none are defined',
    );
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
  const regions = parseRegions(regionsJson);
  const constellation = parseConstellation(constellationJson);
  const skills = parseSkills(skillsJson);
  const personalities = parsePersonalities(personalitiesJson);
  const traits = parseTraits(traitsJson);

  const rarities = parseRarities(raritiesJson);
  const itemTypes = parseItemTypes(itemTypesJson);
  const substats = parseSubstats(substatsJson);
  const cards = parseCards(cardsJson);
  const sets = parseSets(setsJson);
  const uniqueEffects = parseUniqueEffects(uniqueEffectsJson);

  crossValidateConstellation({ archetypes, regions, constellation, skills, itemTypes });
  crossValidateItems({ rarities, itemTypes, substats, cards, uniqueEffects, skills });

  cached = Object.freeze({
    archetypes,
    archetypesById: new Map(archetypes.map((a) => [a.id, a])),

    regions,
    regionsById: new Map(regions.map((r) => [r.id, r])),
    constellation,
    constellationNodesById: new Map(constellation.nodes.map((n) => [n.id, n])),

    skills,
    skillsById: new Map(skills.map((s) => [s.id, s])),
    personalities,
    personalitiesById: new Map(personalities.map((p) => [p.id, p])),
    traits,
    traitsById: new Map(traits.map((t) => [t.id, t])),
    namePools: parseNamePools(namesJson),

    rarities,
    raritiesById: new Map(rarities.rarities.map((r) => [r.id, r])),
    itemTypes,
    itemTypesById: new Map(itemTypes.types.map((t) => [t.id, t])),
    substats,
    cards,
    cardsById: new Map(cards.map((c) => [c.id, c])),
    sets,
    setsById: new Map(sets.map((s) => [s.id, s])),
    uniqueEffects,
    uniqueEffectsById: new Map(uniqueEffects.map((e) => [e.id, e])),

    policyPrecedence: parsePolicyPrecedence(policyPrecedenceJson),

    balance: {
      attributes: parseAttributeBalance(attributeBalanceJson),
      mastery: parseMasteryBalance(masteryBalanceJson),
      buildIdentity: parseBuildIdentityBalance(buildIdentityBalanceJson),
      potential: parsePotentialBalance(potentialBalanceJson),
      personality: parsePersonalityBalance(personalityBalanceJson),
      chronicle: parseChronicleBalance(chronicleBalanceJson),
      refinement: parseRefinementBalance(refinementBalanceJson),
      loot: parseLootBalance(lootBalanceJson),
    },
  });

  return cached;
}

/** Test affordance: force a fresh validation pass. Never used by gameplay code. */
export function resetContentCache(): void {
  cached = undefined;
}
