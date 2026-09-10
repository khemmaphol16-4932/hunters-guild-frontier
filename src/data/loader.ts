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

import monstersJson from './combat/monsters.json';
import statusesJson from './combat/statuses.json';
import worldJson from './world/regions.json';
import eventsJson from './world/events.json';
import combatBalanceJson from './balance/combat.json';

import buildingsJson from './town/buildings.json';
import jobsJson from './town/jobs.json';
import departmentsJson from './town/departments.json';
import researchJson from './town/research.json';
import originsJson from './town/origins.json';
import threatsJson from './town/threats.json';
import townBalanceJson from './balance/town.json';
import resourcesJson from './economy/resources.json';
import recipesJson from './economy/recipes.json';
import { parseEconomy, type EconomyData, type ResourceDef } from './economySchema.js';
import { parseCrafting, type CraftingData } from './craftingSchema.js';

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
  parseCombatBalance,
  parseMonsters,
  parseStatuses,
  parseEvents,
  parseWorld,
  type CombatBalance,
  type EventDef,
  type MonsterDef,
  type StatusDef,
  type WorldData,
  type RegionDef as WorldRegionDef,
} from './combatSchema.js';
import { ZONE_TIERS } from './combatSchema.js';
import {
  parseBuildings,
  parseDepartments,
  parseJobs,
  parseTownBalance,
  type BuildingData,
  type BuildingDef,
  type DepartmentData,
  type JobData,
  type JobDef,
  type TownBalance,
} from './townSchema.js';
import { parseResearch, type ResearchData, type ResearchNodeDef } from './researchSchema.js';
import {
  crossValidateRecruitment,
  parseRecruitment,
  type OriginDef,
  type RecruitData,
} from './recruitSchema.js';
import {
  crossValidateThreats,
  parseThreats,
  type ThreatData,
} from './threatSchema.js';
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

  readonly monsters: readonly MonsterDef[];
  readonly monstersById: ReadonlyMap<string, MonsterDef>;
  readonly statuses: readonly StatusDef[];
  readonly statusesById: ReadonlyMap<string, StatusDef>;
  /** World regions — distinct from constellation regions, which are skill territory. */
  readonly world: WorldData;
  readonly worldRegionsById: ReadonlyMap<string, WorldRegionDef>;
  readonly events: readonly EventDef[];
  readonly eventsById: ReadonlyMap<string, EventDef>;

  /** v1.0 §2.1 canonical precedence, as data rather than as source order. */
  readonly policyPrecedence: PolicyPrecedence;

  /** The town: what can be built, what work exists, and how it is managed (REQ-TWN-*). */
  readonly town: BuildingData;
  readonly buildingsById: ReadonlyMap<string, BuildingDef>;
  readonly townJobs: JobData;
  readonly townJobsById: ReadonlyMap<string, JobDef>;
  readonly departments: DepartmentData;
  readonly research: ResearchData;
  readonly researchById: ReadonlyMap<string, ResearchNodeDef>;
  /** Where recruits come from, and how the pool refreshes (REQ-RCT-001/002). */
  readonly recruitment: RecruitData;
  readonly originsById: ReadonlyMap<string, OriginDef>;
  /** Town hunting grounds and the things that come to the walls (REQ-TWN-007/008). */
  readonly threats: ThreatData;
  readonly economy: EconomyData;
  readonly resourcesById: ReadonlyMap<string, ResourceDef>;
  readonly crafting: CraftingData;

  readonly balance: {
    readonly attributes: AttributeBalance;
    readonly mastery: MasteryBalance;
    readonly buildIdentity: BuildIdentityBalance;
    readonly potential: PotentialBalance;
    readonly personality: PersonalityBalance;
    readonly chronicle: ChronicleBalance;
    readonly refinement: RefinementBalance;
    readonly loot: LootBalance;
    readonly combat: CombatBalance;
    readonly town: TownBalance;
  };
}

/**
 * Town referential integrity.
 *
 * Every failure here is silent rather than loud, which is why it is worth checking:
 *
 *   - a building granting slots for a job that does not exist gives the town posts nobody
 *     can be assigned to, so the building looks built and does nothing;
 *   - a job no building offers is unreachable work — it would show in a department's slot
 *     count as zero forever with no indication why;
 *   - a building gated behind a town stage that does not exist can never be built, and
 *     nothing fails: the player simply never sees it become available (the same class of bug
 *     as an unreachable region, DL-033);
 *   - a department with no job at all would report 0% staffing permanently and read as
 *     broken rather than as empty.
 */
function crossValidateTown(content: {
  town: BuildingData;
  jobs: JobData;
  departments: DepartmentData;
  balance: TownBalance;
}): void {
  const jobIds = new Set(content.jobs.jobs.map((j) => j.id));
  const stageIds = new Set(content.balance.stages.map((s) => s.id));
  const offered = new Set<string>();

  for (const building of content.town.buildings) {
    for (const tier of building.tiers) {
      for (const jobId of Object.keys(tier.jobs)) {
        if (!jobIds.has(jobId)) {
          throw new ContentValidationError(
            `buildings.json:${building.id}.tiers[${tier.tier}].jobs`,
            `offers work "${jobId}", which is not a job`,
          );
        }
        offered.add(jobId);
      }
    }

    const unlock = building.unlock;
    if (unlock?.stage !== undefined && !stageIds.has(unlock.stage)) {
      throw new ContentValidationError(
        `buildings.json:${building.id}.unlock.stage`,
        `gated behind town stage "${unlock.stage}", which does not exist`,
      );
    }
    if (unlock?.reputation !== undefined && unlock.reputation > content.balance.reputation.max) {
      throw new ContentValidationError(
        `buildings.json:${building.id}.unlock.reputation`,
        `needs ${unlock.reputation} reputation, above the maximum of ` +
          `${content.balance.reputation.max}, so it could never be built`,
      );
    }
  }

  for (const job of content.jobs.jobs) {
    if (!offered.has(job.id)) {
      throw new ContentValidationError(
        `jobs.json:${job.id}`,
        'no building offers this work at any tier, so nobody could ever be assigned to it',
      );
    }
  }

  for (const department of content.departments.departments) {
    if (!content.jobs.jobs.some((job) => job.department === department.id)) {
      throw new ContentValidationError(
        `jobs.json`,
        `no job belongs to the ${department.id} department, so it can never be staffed`,
      );
    }
  }

  // REQ-TWN-003's pressure has to be *answerable*. A town whose buildings could never cover
  // the starting population's housing would open on a crisis the player cannot fix, which
  // reads as a broken game rather than as a challenge.
  const bestHousing = content.town.buildings.reduce(
    (best, b) => Math.max(best, b.tiers.reduce((sum, t) => sum + t.capacity.housing, 0)),
    0,
  );
  if (bestHousing <= 0) {
    throw new ContentValidationError(
      'buildings.json',
      'no building provides housing, so REQ-TWN-003 housing pressure could never be relieved',
    );
  }
}

function crossValidateEconomy(content: {
  economy: EconomyData;
  research: ResearchData;
  refinement: RefinementBalance;
  loot: LootBalance;
}): void {
  const ids = new Set(content.economy.resources.map((resource) => resource.id));
  const required = [
    'gold',
    'materials',
    content.research.resetResource.id,
    content.refinement.protection.resourceId,
    content.loot.conversion.dismantleResourceId,
  ];
  for (const id of required) {
    if (!ids.has(id)) {
      throw new ContentValidationError(
        'resources.json',
        `does not define referenced resource "${id}", so a transaction would silently fail`,
      );
    }
  }
}

/**
 * World referential integrity.
 *
 * A region pointing at a monster that does not exist would produce an empty encounter — a
 * route the party walks through untouched, which reads as a bug in the AI rather than in the
 * content. Same for a status a monster skill applies.
 */
function crossValidateWorld(content: {
  world: WorldData;
  monsters: readonly MonsterDef[];
  statuses: readonly StatusDef[];
  events: readonly EventDef[];
}): void {
  const monsterIds = new Set(content.monsters.map((m) => m.id));
  const statusIds = new Set(content.statuses.map((s) => s.id));

  for (const monster of content.monsters) {
    for (const skill of monster.skills) {
      if (skill.status !== undefined && !statusIds.has(skill.status)) {
        throw new ContentValidationError(
          `monsters.json:${monster.id}.${skill.id}`,
          `applies status "${skill.status}", which does not exist`,
        );
      }
      if (skill.status !== undefined && skill.statusChance === undefined) {
        throw new ContentValidationError(
          `monsters.json:${monster.id}.${skill.id}`,
          'a skill that applies a status needs a statusChance',
        );
      }
    }
  }

  for (const region of content.world.regions) {
    for (const encounter of region.encounters) {
      for (const id of encounter.monsters) {
        if (!monsterIds.has(id)) {
          throw new ContentValidationError(
            `regions.json:${region.id}`,
            `spawns monster "${id}", which does not exist`,
          );
        }
      }
    }
    if (region.boss !== undefined) {
      if (!monsterIds.has(region.boss)) {
        throw new ContentValidationError(
          `regions.json:${region.id}`,
          `boss "${region.boss}" does not exist`,
        );
      }
      // A region whose boss is not authored as a boss would silently skip phases and
      // telegraphs, which is exactly the sophistication REQ-BOS-001 requires.
      if (content.monsters.find((m) => m.id === region.boss)?.tier !== 'boss') {
        throw new ContentValidationError(
          `regions.json:${region.id}`,
          `boss "${region.boss}" is not authored as tier "boss"`,
        );
      }
    }
  }

  // REQ-WLD-002 unlock gates must point at real things, or a region silently becomes
  // unreachable — the worst kind of content bug, because nothing fails and the player
  // simply never sees the place.
  const regionIds = new Set(content.world.regions.map((r) => r.id));
  for (const region of content.world.regions) {
    const unlock = region.unlock;
    if (!unlock) continue;

    if (unlock.afterBoss !== undefined && !monsterIds.has(unlock.afterBoss)) {
      throw new ContentValidationError(
        `regions.json:${region.id}.unlock`,
        `gated behind boss "${unlock.afterBoss}", which does not exist`,
      );
    }
    if (unlock.afterKnowing !== undefined) {
      if (!regionIds.has(unlock.afterKnowing.regionId)) {
        throw new ContentValidationError(
          `regions.json:${region.id}.unlock`,
          `gated behind knowledge of "${unlock.afterKnowing.regionId}", which does not exist`,
        );
      }
      if (unlock.afterKnowing.regionId === region.id) {
        throw new ContentValidationError(
          `regions.json:${region.id}.unlock`,
          'gated behind knowledge of itself, which can never be satisfied',
        );
      }
    }
  }

  // Every zone tier should have somewhere to go, or REQ-ZON-001's four tiers are three.
  const tiersInUse = new Set(content.world.regions.map((r) => r.zoneTier));
  for (const tier of ZONE_TIERS) {
    if (!tiersInUse.has(tier)) {
      throw new ContentValidationError(
        'regions.json',
        `no region is authored at danger tier "${tier}" (REQ-ZON-001 fixes four)`,
      );
    }
  }

  // An event that can never be drawn is dead content. Each one must have somewhere to fire.
  for (const event of content.events) {
    const eligible = content.world.regions.filter(
      (r) =>
        event.zoneTiers.includes(r.zoneTier) &&
        (event.hazards.length === 0 || event.hazards.some((h) => r.hazards.includes(h))),
    );
    if (eligible.length === 0) {
      throw new ContentValidationError(
        `events.json:${event.id}`,
        'no region matches its zone tiers and hazards, so it can never occur',
      );
    }
  }
}

/**
 * Research referential integrity.
 *
 * Research's whole job is to unlock things, so every id it names has to exist — a node
 * promising a department or a building that does not is a node the player completes and
 * receives nothing for, with nothing failing anywhere.
 *
 * The last check is the one worth having: a department that research is *supposed* to open
 * but which no node opens would be permanently shut. That is the exact bug Phase 5 shipped
 * with reputation and Phase 6a stood in for with a town-stage predicate, and it is invisible
 * without a check like this one.
 */
function crossValidateResearch(content: {
  research: ResearchData;
  town: BuildingData;
  departments: DepartmentData;
}): void {
  const buildingIds = new Set(content.town.buildings.map((b) => b.id));
  const departmentIds = new Set(content.departments.departments.map((d) => d.id));
  const opened = new Set<string>();

  for (const node of content.research.nodes) {
    for (const effect of node.effects) {
      if (effect.kind === 'building' && !buildingIds.has(String(effect.value))) {
        throw new ContentValidationError(
          `research.json:${node.id}`,
          `unlocks building "${String(effect.value)}", which does not exist`,
        );
      }
      if (effect.kind === 'department') {
        if (!departmentIds.has(String(effect.value) as never)) {
          throw new ContentValidationError(
            `research.json:${node.id}`,
            `unlocks department "${String(effect.value)}", which does not exist`,
          );
        }
        opened.add(String(effect.value));
      }
    }
  }

  for (const department of content.departments.departments) {
    if (department.unlockedFromStart) continue;
    if (!opened.has(department.id)) {
      throw new ContentValidationError(
        'research.json',
        `the ${department.id} department is not open from the start and no research opens it, ` +
          'so it could never be used (REQ-DEP-001)',
      );
    }
  }

  // The bootstrap, and it is a real deadlock rather than a theoretical one — it shipped and
  // was found by playing: research points come only from the Research Department's output,
  // so gating that department behind a research node means no department, no points, and no
  // way to ever open the department. Every other department may be gated; this one cannot.
  const researchDepartment = content.departments.departments.find((d) => d.id === 'research');
  if (researchDepartment && !researchDepartment.unlockedFromStart) {
    throw new ContentValidationError(
      'departments.json:research',
      'the Research Department cannot be gated behind research — points come only from its ' +
        'own output, so a new guild could never research anything (REQ-RES-002)',
    );
  }
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
  const namePools = parseNamePools(namesJson);

  const rarities = parseRarities(raritiesJson);
  const itemTypes = parseItemTypes(itemTypesJson);
  const substats = parseSubstats(substatsJson);
  const cards = parseCards(cardsJson);
  const sets = parseSets(setsJson);
  const uniqueEffects = parseUniqueEffects(uniqueEffectsJson);

  const monsters = parseMonsters(monstersJson);
  const statuses = parseStatuses(statusesJson);
  const world = parseWorld(worldJson);
  const events = parseEvents(eventsJson);

  const townBalance = parseTownBalance(townBalanceJson);
  const town = parseBuildings(buildingsJson);
  const townJobs = parseJobs(jobsJson);
  // Departments are parsed against the assignment weights, because the DL-008 inequality
  // ("a preference is never a veto") is a relationship between the two files.
  const departments = parseDepartments(departmentsJson, townBalance.assignment.weights);
  const research = parseResearch(researchJson);
  const recruitment = parseRecruitment(originsJson);
  const threats = parseThreats(threatsJson);
  const economy = parseEconomy(resourcesJson);
  const crafting = parseCrafting(recipesJson);
  const refinementBalance = parseRefinementBalance(refinementBalanceJson);
  const lootBalance = parseLootBalance(lootBalanceJson);

  crossValidateConstellation({ archetypes, regions, constellation, skills, itemTypes });
  crossValidateItems({ rarities, itemTypes, substats, cards, uniqueEffects, skills });
  crossValidateWorld({ world, monsters, statuses, events });
  crossValidateTown({ town, jobs: townJobs, departments, balance: townBalance });
  crossValidateResearch({ research, town, departments });
  crossValidateRecruitment({
    recruitment,
    namePoolIds: new Set(namePools.map((p) => p.id)),
    archetypeIds: new Set(archetypes.map((a) => a.id)),
    personalityIds: new Set(personalities.map((p) => p.id)),
    reputationMax: townBalance.reputation.max,
  });
  crossValidateThreats({
    threats,
    monsterIds: new Set(monsters.map((m) => m.id)),
    reputationMax: townBalance.reputation.max,
  });
  crossValidateEconomy({ economy, research, refinement: refinementBalance, loot: lootBalance });
  for (const recipe of crafting.recipes) {
    if (!itemTypes.types.some((type) => type.id === recipe.typeId)) throw new ContentValidationError(`recipes.json:${recipe.id}`, `unknown item type "${recipe.typeId}"`);
    if (!rarities.rarities.some((rarity) => rarity.id === recipe.rarity)) throw new ContentValidationError(`recipes.json:${recipe.id}`, `unknown rarity "${recipe.rarity}"`);
    for (const resource of Object.keys(recipe.cost)) if (!economy.resources.some((entry) => entry.id === resource)) throw new ContentValidationError(`recipes.json:${recipe.id}.cost`, `unknown resource "${resource}"`);
  }
  for (const resource of Object.keys(economy.market.goods)) if (!economy.resources.some((entry) => entry.id === resource)) throw new ContentValidationError('resources.json.market.goods', `unknown resource "${resource}"`);

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
    namePools,

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

    monsters,
    monstersById: new Map(monsters.map((m) => [m.id, m])),
    statuses,
    statusesById: new Map(statuses.map((s) => [s.id, s])),
    world,
    worldRegionsById: new Map(world.regions.map((r) => [r.id, r])),
    events,
    eventsById: new Map(events.map((e) => [e.id, e])),

    policyPrecedence: parsePolicyPrecedence(policyPrecedenceJson),

    town,
    buildingsById: new Map(town.buildings.map((b) => [b.id, b])),
    townJobs,
    townJobsById: new Map(townJobs.jobs.map((j) => [j.id, j])),
    departments,
    research,
    researchById: new Map(research.nodes.map((n) => [n.id, n])),
    recruitment,
    originsById: new Map(recruitment.origins.map((o) => [o.id, o])),
    threats,
    economy,
    resourcesById: new Map(economy.resources.map((resource) => [resource.id, resource])),
    crafting,

    balance: {
      attributes: parseAttributeBalance(attributeBalanceJson),
      mastery: parseMasteryBalance(masteryBalanceJson),
      buildIdentity: parseBuildIdentityBalance(buildIdentityBalanceJson),
      potential: parsePotentialBalance(potentialBalanceJson),
      personality: parsePersonalityBalance(personalityBalanceJson),
      chronicle: parseChronicleBalance(chronicleBalanceJson),
      refinement: refinementBalance,
      loot: lootBalance,
      combat: parseCombatBalance(combatBalanceJson),
      town: townBalance,
    },
  });

  return cached;
}

/** Test affordance: force a fresh validation pass. Never used by gameplay code. */
export function resetContentCache(): void {
  cached = undefined;
}
