/**
 * Build Identity — the keystone of the whole design.
 *
 * REQ-BLD-001/002/003, risk R2. This is the single contract between the hunter domain and
 * the AI layer: nothing in ai/ reads raw attributes, raw skill lists or raw equipment, it
 * reads a *profile*. That indirection is what makes "different builds produce different AI
 * behavior" (REQ-BLD-003) implementable — build differences arrive at the decision as
 * differing weights and thresholds, not merely as differing damage numbers.
 *
 * The failure mode this guards against is silent: a utility AI reading raw stats converges
 * on "use the biggest number available", every build behaves the same, and build identity
 * collapses into a stat package — exactly what §16 forbids. A structured profile keeps the
 * differences legible to the AI and to the player.
 *
 * Sources and their weights are the §16 ratios verbatim, read from
 * data/balance/build-identity.json:
 *   Class 2 · Attributes 2 · Skills 2 · Equipment 2 · Cards 1 · Skill Books 1
 */

import { ATTRIBUTE_KEYS, RANGE_BANDS, ROLES } from '../../data/schema.js';
import type {
  BuildIdentityBalance,
  RangeBand,
  Role,
  SkillDef,
} from '../../data/schema.js';
import type { SkillId } from '../../core/ids.js';
import type { BuildProfile, IdentityShape } from '../../core/hunter/buildProfile.js';
import type { Hunter } from '../../core/hunter/Hunter.js';
import { unequippedKnownSkills } from '../../core/hunter/Hunter.js';
import type { Constellation } from '../constellation/Constellation.js';
import type { SkillMastery } from '../skills/SkillMastery.js';
import type { SkillRegistry } from '../skills/SkillRegistry.js';
import type { Condition } from './Condition.js';
import type { Personality } from './Personality.js';
import {
  NULL_CARD_CONTRIBUTION,
  NULL_EQUIPMENT_CONTRIBUTION,
  type CardContribution,
  type EquipmentContribution,
  type IdentityContribution,
} from './contributions.js';

export type { BuildProfile, IdentityShape } from '../../core/hunter/buildProfile.js';

export interface BuildIdentityDeps {
  readonly balance: BuildIdentityBalance;
  readonly constellation: Constellation;
  readonly registry: SkillRegistry;
  readonly mastery: SkillMastery;
  readonly personality: Personality;
  readonly condition: Condition;
  readonly equipment?: EquipmentContribution;
  readonly cards?: CardContribution;
  /** Innate and inherited traits' shift to risk posture (Battle-Born, Glass Nerves). */
  readonly traitRiskShift?: (hunter: Hunter) => number;
  /** Traits' shift toward protecting allies (Loyal: allySafetyWeightShift). */
  readonly traitAllySafety?: (hunter: Hunter) => number;
}

type MutableRoles = Partial<Record<Role, number>>;
type MutableRanges = Partial<Record<RangeBand, number>>;

function addWeights<K extends string>(
  target: Partial<Record<K, number>>,
  source: Readonly<Partial<Record<K, number>>>,
  scale: number,
): void {
  for (const [key, value] of Object.entries(source) as [K, number][]) {
    target[key] = (target[key] ?? 0) + value * scale;
  }
}

function normaliseRecord<K extends string>(
  values: Partial<Record<K, number>>,
  keys: readonly K[],
): Record<K, number> {
  let total = 0;
  for (const key of keys) total += Math.max(0, values[key] ?? 0);

  const out = {} as Record<K, number>;
  for (const key of keys) {
    out[key] = total > 0 ? Math.max(0, values[key] ?? 0) / total : 0;
  }
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Scales gear skill-affinity into the same range as the class and loadout contributions,
 * which add raw shares rather than weighted ones. Chosen so a weapon's affinity lands near
 * a class tag's 0.35 rather than dominating it.
 */
const GEAR_AFFINITY_SCALE = 0.25;

export class BuildIdentity {
  private readonly balance: BuildIdentityBalance;
  private readonly constellation: Constellation;
  private readonly registry: SkillRegistry;
  private readonly mastery: SkillMastery;
  private readonly personality: Personality;
  private readonly condition: Condition;
  private readonly equipment: EquipmentContribution;
  private readonly cards: CardContribution;
  private readonly traitRiskShift: (hunter: Hunter) => number;
  private readonly traitAllySafety: (hunter: Hunter) => number;

  /** Cost extremes across all content, used to normalise the resource profile. */
  private readonly maxSkillCost: number;
  private readonly maxSkillCooldown: number;

  constructor(deps: BuildIdentityDeps) {
    this.balance = deps.balance;
    this.constellation = deps.constellation;
    this.registry = deps.registry;
    this.mastery = deps.mastery;
    this.personality = deps.personality;
    this.condition = deps.condition;
    this.equipment = deps.equipment ?? NULL_EQUIPMENT_CONTRIBUTION;
    this.cards = deps.cards ?? NULL_CARD_CONTRIBUTION;
    this.traitRiskShift = deps.traitRiskShift ?? (() => 0);
    this.traitAllySafety = deps.traitAllySafety ?? (() => 0);

    const all = this.registry.all();
    this.maxSkillCost = Math.max(1, ...all.map((s) => s.resourceCost));
    this.maxSkillCooldown = Math.max(1, ...all.map((s) => s.cooldownSeconds));
  }

  /** Derive the full profile. Pure — the same hunter always yields the same profile. */
  profileOf(hunter: Hunter): BuildProfile {
    const weights = this.balance.sourceWeights;

    const roleLean: MutableRoles = {};
    const rangeBand: MutableRanges = {};
    const skillAffinity: Record<string, number> = {};
    let classRiskShift = 0;

    // --- Class (weight 2) ---------------------------------------------------
    const classProfile = this.constellation.blendedClassProfile(hunter);
    addWeights(roleLean, classProfile.roleLean, weights.class);
    addWeights(rangeBand, classProfile.rangeBand, weights.class);
    classRiskShift = classProfile.riskPostureShift;
    for (const tag of classProfile.skillTags) {
      skillAffinity[tag] = (skillAffinity[tag] ?? 0) + 0.35;
    }

    // --- Attributes (weight 2) ----------------------------------------------
    const attributeContribution = this.attributeContribution(hunter);
    addWeights(roleLean, attributeContribution.roleLean, weights.attributes);
    addWeights(rangeBand, attributeContribution.rangeBand, weights.attributes);

    // --- Skills: the active loadout (weight 2) ------------------------------
    const loadoutContribution = this.skillContribution(hunter, hunter.loadout, true);
    addWeights(roleLean, loadoutContribution.roleLean, weights.skills);
    addWeights(rangeBand, loadoutContribution.rangeBand, weights.skills);
    for (const [tag, value] of Object.entries(loadoutContribution.skillAffinity)) {
      skillAffinity[tag] = (skillAffinity[tag] ?? 0) + value;
    }

    // --- Skill books: known but unequipped (weight 1) ------------------------
    // A hunter who knows a great deal of healing but is running a damage loadout still
    // leans slightly healer. This is what makes the well-read veteran distinct.
    const unequipped = unequippedKnownSkills(hunter);
    const bookContribution = this.skillContribution(hunter, unequipped, false);
    addWeights(roleLean, bookContribution.roleLean, weights.skillBooks);
    addWeights(rangeBand, bookContribution.rangeBand, weights.skillBooks);
    for (const [tag, value] of Object.entries(bookContribution.skillAffinity)) {
      skillAffinity[tag] = (skillAffinity[tag] ?? 0) + value * 0.5;
    }

    // --- Equipment (weight 2) and Cards (weight 1) --------------------------
    // Backed by null objects in Phase 1 and by real implementations from Phase 2 onward
    // (DL-009). All four fields of the contribution are consumed: role lean, range band,
    // risk posture and skill affinity. Consuming only the first two — as this originally
    // did — left gear unable to make a hunter bolder or more rescue-minded, which quietly
    // contradicted REQ-BLD-001's claim that equipment and cards are build inputs.
    const equipmentContribution = this.equipment.contributionFor(hunter);
    addWeights(roleLean, equipmentContribution.roleLean, weights.equipment);
    addWeights(rangeBand, equipmentContribution.rangeBand, weights.equipment);

    const cardContribution = this.cards.contributionFor(hunter);
    addWeights(roleLean, cardContribution.roleLean, weights.cards);
    addWeights(rangeBand, cardContribution.rangeBand, weights.cards);

    // Both contributions arrive already averaged across the items or cards that produced
    // them, so they are summed at full strength rather than re-weighted. With no gear both
    // are zero, which is why adding this changes nothing for an unequipped hunter.
    const gearRiskShift =
      equipmentContribution.riskPostureShift + cardContribution.riskPostureShift;

    for (const [tag, value] of Object.entries(equipmentContribution.skillAffinity)) {
      skillAffinity[tag] = (skillAffinity[tag] ?? 0) + value * GEAR_AFFINITY_SCALE * weights.equipment;
    }
    for (const [tag, value] of Object.entries(cardContribution.skillAffinity)) {
      skillAffinity[tag] = (skillAffinity[tag] ?? 0) + value * GEAR_AFFINITY_SCALE * weights.cards;
    }

    // --- Personality: weights only, already clamped (REQ-HUN-010) -----------
    const personalityInfluence = this.personality.influenceOf(hunter);
    addWeights(roleLean, personalityInfluence.roleLeanShift, 1);

    // --- Normalise and read off ---------------------------------------------
    const normalisedRoles = normaliseRecord(roleLean, ROLES);
    const normalisedRanges = normaliseRecord(rangeBand, RANGE_BANDS);

    const rolesSorted = [...ROLES].sort(
      (a, b) => (normalisedRoles[b] ?? 0) - (normalisedRoles[a] ?? 0),
    );
    const primaryRole = rolesSorted[0] ?? 'damage';
    const secondary = rolesSorted[1];
    const secondaryRole =
      secondary !== undefined && (normalisedRoles[secondary] ?? 0) > 0.15 ? secondary : undefined;

    const rangesSorted = [...RANGE_BANDS].sort(
      (a, b) => (normalisedRanges[b] ?? 0) - (normalisedRanges[a] ?? 0),
    );
    const primaryRange = rangesSorted[0] ?? 'melee';

    const focus = normalisedRoles[primaryRole] ?? 0;
    const shape: IdentityShape =
      focus >= this.balance.confidence.specialistThreshold
        ? 'specialist'
        : focus >= this.balance.confidence.generalistThreshold
          ? 'hybrid'
          : 'generalist';

    return {
      hunterId: hunter.id,
      roleLean: normalisedRoles,
      primaryRole,
      secondaryRole,
      rangeBand: normalisedRanges,
      primaryRange,
      riskPosture: this.riskPosture(hunter, normalisedRoles, classRiskShift + gearRiskShift),
      resourceProfile: this.resourceProfile(hunter),
      skillAffinity,
      versatility: Math.min(
        this.balance.versatility.cap,
        unequipped.length * this.balance.versatility.perUnequippedKnownSkill,
      ),
      focus,
      shape,
      allySafety: this.traitAllySafety(hunter),
    };
  }

  /**
   * Attributes push the role lean in proportion to how the hunter is actually built.
   * A Sentinel who dumped everything into DEX is not the same hunter as one who took VIT,
   * and this is where that stops being a numeric difference and becomes an identity one.
   */
  private attributeContribution(hunter: Hunter): IdentityContribution {
    const roleLean: MutableRoles = {};
    const rangeBand: MutableRanges = {};

    let total = 0;
    for (const key of ATTRIBUTE_KEYS) total += hunter.attributes[key];
    if (total <= 0) return { roleLean, rangeBand, riskPostureShift: 0, skillAffinity: {} };

    for (const key of ATTRIBUTE_KEYS) {
      const share = hunter.attributes[key] / total;
      addWeights(roleLean, this.balance.attributeRoleAffinity[key], share);
      addWeights(rangeBand, this.balance.attributeRangeAffinity[key], share);
    }

    return { roleLean, rangeBand, riskPostureShift: 0, skillAffinity: {} };
  }

  /**
   * Skills push identity, and mastery amplifies that push.
   *
   * This is REQ-PRIME-004 made mechanical: a hunter who has used Riposte ten thousand times
   * reads as a counter-fighter regardless of what their class sheet says. `applyMastery` is
   * false for the skill-book axis, where knowledge counts but practice does not.
   */
  private skillContribution(
    hunter: Hunter,
    skillIds: readonly SkillId[],
    applyMastery: boolean,
  ): IdentityContribution {
    const roleLean: MutableRoles = {};
    const rangeBand: MutableRanges = {};
    const skillAffinity: Record<string, number> = {};

    if (skillIds.length === 0) {
      return { roleLean, rangeBand, riskPostureShift: 0, skillAffinity };
    }

    let weightSum = 0;
    const entries: { def: SkillDef; weight: number }[] = [];

    for (const skillId of skillIds) {
      const def = this.registry.get(skillId);
      if (!def) continue;
      const masteryWeight = applyMastery
        ? 1 + this.mastery.identityWeight(this.mastery.points(hunter, skillId))
        : 1;
      entries.push({ def, weight: masteryWeight });
      weightSum += masteryWeight;
    }

    if (weightSum <= 0) {
      return { roleLean, rangeBand, riskPostureShift: 0, skillAffinity };
    }

    for (const { def, weight } of entries) {
      const share = weight / weightSum;
      addWeights(roleLean, def.roleContribution, share);
      rangeBand[def.rangeBand] = (rangeBand[def.rangeBand] ?? 0) + share;
      for (const tag of def.tags) {
        skillAffinity[tag] = (skillAffinity[tag] ?? 0) + share;
      }
    }

    return { roleLean, rangeBand, riskPostureShift: 0, skillAffinity };
  }

  /**
   * Risk posture blends: the offensive/defensive balance of the attribute spread, the role
   * lean, the class chain, personality (clamped), and current condition.
   *
   * Condition is included because a tired hunter genuinely should fight more carefully
   * (§48) — but note that this makes the profile *situational*, which is why the AI must
   * re-derive it rather than cache it across a long expedition.
   */
  private riskPosture(
    hunter: Hunter,
    roles: Readonly<Record<Role, number>>,
    classShift: number,
  ): number {
    const config = this.balance.riskPosture;
    let posture = config.base;

    let offensive = 0;
    let defensive = 0;
    for (const key of config.fromAttributeRatio.offensive) offensive += hunter.attributes[key];
    for (const key of config.fromAttributeRatio.defensive) defensive += hunter.attributes[key];
    const attributeTotal = offensive + defensive;
    if (attributeTotal > 0) {
      const ratio = offensive / attributeTotal; // 0.5 is balanced
      posture += (ratio - 0.5) * 2 * config.fromAttributeRatio.influence;
    }

    for (const role of ROLES) {
      const shift = config.fromRoleLean[role];
      if (shift !== undefined) posture += shift * (roles[role] ?? 0);
    }

    posture += classShift;
    posture += this.personality.influenceOf(hunter).riskPostureShift;
    posture += this.personality.moraleRiskShift(hunter);
    posture += this.condition.riskPostureShift(hunter);
    posture += this.traitRiskShift(hunter);

    return clamp(posture, config.clamp.min, config.clamp.max);
  }

  /**
   * Burst versus sustain, read off the shape of the active loadout.
   * Expensive, long-cooldown skills mean a hunter who waits for a moment and commits;
   * cheap, fast skills mean one who applies constant pressure. The AI uses this to decide
   * whether holding a resource is in character.
   */
  private resourceProfile(hunter: Hunter): number {
    const config = this.balance.resourceProfile;
    if (hunter.loadout.length === 0) return config.base;

    let costSum = 0;
    let cooldownSum = 0;
    let count = 0;
    for (const skillId of hunter.loadout) {
      const def = this.registry.get(skillId);
      if (!def) continue;
      costSum += def.resourceCost;
      cooldownSum += def.cooldownSeconds;
      count += 1;
    }
    if (count === 0) return config.base;

    const avgCostShare = costSum / count / this.maxSkillCost;
    const avgCooldownShare = cooldownSum / count / this.maxSkillCooldown;

    // Cheap and fast pushes toward sustain (1); expensive and slow pushes toward burst (0).
    const profile =
      config.base +
      (0.5 - avgCostShare) * 2 * config.costInfluence +
      (0.5 - avgCooldownShare) * 2 * config.cooldownInfluence;

    return clamp(profile, config.clamp.min, config.clamp.max);
  }
}
