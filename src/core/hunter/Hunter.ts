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
import type {
  AdvancedClassId,
  ArchetypeId,
  HunterId,
  PersonalityId,
  SkillId,
  SpecializationId,
  TraitId,
} from '../ids.js';
import { baseAttributes, type Attributes } from './attributes.js';
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

export interface HunterClassChain {
  readonly archetype: ArchetypeId;
  readonly advanced: AdvancedClassId | undefined;
  readonly specialization: SpecializationId | undefined;
}

export interface Hunter {
  readonly id: HunterId;
  readonly name: string;

  readonly level: number;
  readonly xp: number;

  readonly attributes: Attributes;
  readonly classChain: HunterClassChain;

  /** Unlimited (REQ-SKL-001). */
  readonly knownSkills: readonly SkillId[];
  /** The 6–8 actives (REQ-SKL-001). Always a subset of knownSkills. */
  readonly loadout: readonly SkillId[];
  /** Skill id -> accumulated mastery points. Permanent, unbounded (REQ-MAS-001). */
  readonly mastery: Readonly<Record<string, number>>;

  readonly potential: Potential;
  readonly personalityId: PersonalityId;
  readonly traitIds: readonly TraitId[];

  readonly condition: HunterCondition;

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

export function createHunter(
  options: CreateHunterOptions,
  balance: AttributeBalance,
): Hunter {
  return {
    id: options.id,
    name: options.name,
    level: options.level ?? balance.minLevel,
    xp: 0,
    attributes: options.attributes ?? baseAttributes(balance),
    classChain: {
      archetype: options.archetype,
      advanced: undefined,
      specialization: undefined,
    },
    knownSkills: options.knownSkills ?? [],
    loadout: [],
    mastery: {},
    potential: options.potential,
    personalityId: options.personalityId,
    traitIds: options.potential.traitIds,
    condition: FRESH_CONDITION,
    preferredRole: options.preferredRole,
    preferredDepartment: options.preferredDepartment,
  };
}

// --- Pure updates -----------------------------------------------------------
// Each returns a new Hunter. Rule enforcement lives in the systems layer; these are
// the mechanical writes those rules perform once they have approved a change.

export function withAttributes(hunter: Hunter, attributes: Attributes): Hunter {
  return { ...hunter, attributes };
}

export function withLevel(hunter: Hunter, level: number, xp: number): Hunter {
  return { ...hunter, level, xp };
}

export function withClassChain(hunter: Hunter, classChain: HunterClassChain): Hunter {
  return { ...hunter, classChain };
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

// --- Derived queries --------------------------------------------------------

/** The most specific class node the hunter has reached — what they actually *are*. */
export function currentClassId(hunter: Hunter): string {
  return (
    hunter.classChain.specialization ?? hunter.classChain.advanced ?? hunter.classChain.archetype
  );
}

/** Every class node in the chain, from archetype to current stage. */
export function classChainIds(hunter: Hunter): readonly string[] {
  const ids: string[] = [hunter.classChain.archetype];
  if (hunter.classChain.advanced) ids.push(hunter.classChain.advanced);
  if (hunter.classChain.specialization) ids.push(hunter.classChain.specialization);
  return ids;
}

export function unspentAttributePoints(hunter: Hunter, balance: AttributeBalance): number {
  return unspentPoints(hunter.attributes, hunter.level, balance);
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
