/**
 * The Hunter aggregate.
 *
 * REQ-HUN-006 — a Hunter carries every field the design calls for, or a typed placeholder
 * for one that arrives in a later phase. Deliberately a plain immutable record rather than
 * a class with behavior: hunters are serialised into saves, replayed in simulation, and
 * compared in tests, and all three are far easier when updates return new values.
 *
 * Note what is *absent*: chronicle. History lives in a separate store that subscribes to
 * the event bus, so a hunter's record cannot accidentally become an input to combat
 * (REQ-CHR-003). The hunter is referenced by id from the chronicle, never the reverse.
 */

import type { AttributeBalance, Role } from '../../data/schema.js';
import { EQUIPMENT_SLOTS, type EquipmentSlot } from '../../data/itemSchema.js';
import type {
  ArchetypeId,
  HunterId,
  ItemId,
  PersonalityId,
  SkillId,
  TraitId,
} from '../ids.js';
import { baseAttributes, type Attributes } from './attributes.js';
import { FRESH_AVAILABILITY, type Availability } from './availability.js';
import { unspentPoints } from './leveling.js';
import type { Potential } from './potential.js';

export const DEPARTMENTS = ['hunter', 'crafting', 'resource', 'defense', 'research'] as const;
export type DepartmentId = (typeof DEPARTMENTS)[number];

/** All 0..1. hunger/fatigue: 0 = sated/rested. morale: 0 = broken, 1 = excellent. */
export interface HunterCondition {
  readonly hunger: number;
  readonly fatigue: number;
  readonly morale: number;
}

export interface Hunter {
  readonly id: HunterId;
  readonly name: string;

  readonly level: number;
  readonly xp: number;
  /** Completed level-cap journeys and unspent level-requirement bypasses (§10). */
  readonly rebirths: number;
  readonly bonusAttributePoints: number;
  readonly constellationBypasses: number;
  /** Nodes deliberately learned early by spending a rebirth bypass. */
  readonly rebirthBypassedNodeIds: readonly string[];

  readonly attributes: Attributes;
  /**
   * The hunter's starting position in the skill constellation (v1.0 §5).
   *
   * Immutable, and deliberately not a 'current class': under the constellation model there
   * is no advancement step to record. What a hunter *is* now derives from which regions
   * their taken nodes fall in — see Constellation.describeIdentity.
   */
  readonly archetype: ArchetypeId;

  /** Unlimited (REQ-SKL-001). */
  readonly knownSkills: readonly SkillId[];
  /** The 6–8 actives (REQ-SKL-001). Always a subset of knownSkills. */
  readonly loadout: readonly SkillId[];
  /** Skill id -> accumulated mastery points. Permanent, unbounded (REQ-MAS-001). */
  readonly mastery: Readonly<Record<string, number>>;

  /**
   * Slot -> item id, or null for empty.
   *
   * Items are referenced by id, never embedded, because REQ-EQP-004 makes all equipment
   * tradable and unbound — the item belongs to the guild's armoury and the hunter merely
   * has it equipped. Embedding would make transferring an item a copy rather than a move.
   */
  readonly equipment: Readonly<Record<EquipmentSlot, ItemId | null>>;

  readonly potential: Potential;
  readonly personalityId: PersonalityId;
  readonly traitIds: readonly TraitId[];

  readonly condition: HunterCondition;

  /**
   * Canonical deployment state (v1.0 §4). Separate from condition: condition is continuous
   * and always present, availability answers whether this hunter can be sent out at all.
   */
  readonly availability: Availability;

  /** Inputs to assignment scoring, never vetoes (REQ-TWN-010, DL-008). */
  readonly preferredRole: Role;
  readonly preferredDepartment: DepartmentId;
}

export interface CreateHunterOptions {
  readonly id: HunterId;
  readonly name: string;
  readonly archetype: ArchetypeId;
  readonly personalityId: PersonalityId;
  readonly potential: Potential;
  readonly preferredRole: Role;
  readonly preferredDepartment: DepartmentId;
  readonly level?: number;
  readonly attributes?: Attributes;
  readonly knownSkills?: readonly SkillId[];
}

export const FRESH_CONDITION: HunterCondition = { hunger: 0, fatigue: 0, morale: 0.7 };

export function emptyEquipment(): Record<EquipmentSlot, ItemId | null> {
  const out = {} as Record<EquipmentSlot, ItemId | null>;
  for (const slot of EQUIPMENT_SLOTS) out[slot] = null;
  return out;
}

export function createHunter(
  options: CreateHunterOptions,
  balance: AttributeBalance,
): Hunter {
  return {
    id: options.id,
    name: options.name,
    level: options.level ?? balance.minLevel,
    xp: 0,
    rebirths: 0,
    bonusAttributePoints: 0,
    constellationBypasses: 0,
    rebirthBypassedNodeIds: [],
    attributes: options.attributes ?? baseAttributes(balance),
    archetype: options.archetype,
    knownSkills: options.knownSkills ?? [],
    loadout: [],
    mastery: {},
    equipment: emptyEquipment(),
    potential: options.potential,
    personalityId: options.personalityId,
    traitIds: options.potential.traitIds,
    condition: FRESH_CONDITION,
    availability: FRESH_AVAILABILITY,
    preferredRole: options.preferredRole,
    preferredDepartment: options.preferredDepartment,
  };
}

// --- Pure updates -----------------------------------------------------------
// Each returns a new Hunter. Rule enforcement lives in the systems layer; these are
// the mechanical writes those rules perform once they have approved a change.

export function withTraits(hunter: Hunter, traitIds: readonly TraitId[]): Hunter {
  return { ...hunter, traitIds: [...new Set(traitIds)] };
}

export function withAttributes(hunter: Hunter, attributes: Attributes): Hunter {
  return { ...hunter, attributes };
}

export function withLevel(hunter: Hunter, level: number, xp: number): Hunter {
  return { ...hunter, level, xp };
}

export function withRebirthProgress(
  hunter: Hunter,
  rebirths: number,
  bonusAttributePoints: number,
  constellationBypasses: number,
): Hunter {
  return { ...hunter, rebirths, bonusAttributePoints, constellationBypasses };
}

export function withKnownSkills(hunter: Hunter, knownSkills: readonly SkillId[]): Hunter {
  return { ...hunter, knownSkills };
}

export function withLoadout(hunter: Hunter, loadout: readonly SkillId[]): Hunter {
  return { ...hunter, loadout };
}

export function withMastery(
  hunter: Hunter,
  mastery: Readonly<Record<string, number>>,
): Hunter {
  return { ...hunter, mastery };
}

export function withCondition(hunter: Hunter, condition: HunterCondition): Hunter {
  return { ...hunter, condition };
}

export function withAvailability(hunter: Hunter, availability: Availability): Hunter {
  return { ...hunter, availability };
}

export function withEquipment(
  hunter: Hunter,
  equipment: Readonly<Record<EquipmentSlot, ItemId | null>>,
): Hunter {
  return { ...hunter, equipment };
}

export function equippedItemIds(hunter: Hunter): readonly ItemId[] {
  const ids: ItemId[] = [];
  for (const slot of EQUIPMENT_SLOTS) {
    const id = hunter.equipment[slot];
    if (id !== null) ids.push(id);
  }
  return ids;
}

// --- Derived queries --------------------------------------------------------

export function unspentAttributePoints(hunter: Hunter, balance: AttributeBalance): number {
  return unspentPoints(hunter.attributes, hunter.level, balance, hunter.bonusAttributePoints ?? 0);
}

export function masteryOf(hunter: Hunter, skillId: SkillId): number {
  return hunter.mastery[skillId] ?? 0;
}

export function knowsSkill(hunter: Hunter, skillId: SkillId): boolean {
  return hunter.knownSkills.includes(skillId);
}

export function hasEquipped(hunter: Hunter, skillId: SkillId): boolean {
  return hunter.loadout.includes(skillId);
}

/** Known skills that are not currently equipped — the Skill Books axis of build identity (§16). */
export function unequippedKnownSkills(hunter: Hunter): readonly SkillId[] {
  return hunter.knownSkills.filter((s) => !hunter.loadout.includes(s));
}
