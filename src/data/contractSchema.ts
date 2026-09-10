import {
  ContentValidationError,
  ROLES,
  assertUniqueIds,
  expectArray,
  expectEnum,
  expectNumber,
  expectObject,
  expectString,
  field,
  optionalField,
  type Role,
} from './schema.js';
import type { EconomyReward } from './economySchema.js';
import { CAPABILITY_AXES, type CapabilityAxis } from './progressionSchema.js';

export const CONTRACT_OBJECTIVES = ['clear', 'survive', 'slay'] as const;
export type ContractObjective = (typeof CONTRACT_OBJECTIVES)[number];

export interface FactionDef { readonly id: string; readonly name: string }

/**
 * What the guild must have shown before a client will offer this work (REQ-CON-001: tiers
 * scale with reputation and guild capability; REQ-CAP-001: capability drives contract
 * generation). Every field is optional; an empty object means "anyone".
 */
export interface ContractRequirements {
  readonly reputation?: number;
  readonly capability?: Readonly<Partial<Record<CapabilityAxis, number>>>;
  /** Minimum standing with the issuing client. */
  readonly standing?: number;
}

/**
 * An Endgame Challenge Contract's constraints (REQ-END-004): difficult conditions that test
 * build, party and guild strategy. Checked against the actual party at dispatch.
 */
export interface ChallengeRules {
  readonly summary: string;
  readonly maxPartySize?: number;
  readonly maxMemberLevel?: number;
  readonly forbiddenRoles?: readonly Role[];
}

export interface ContractTemplate {
  readonly id: string;
  readonly name: string;
  readonly factionId: string;
  readonly regionId: string;
  readonly objective: ContractObjective;
  readonly tier: number;
  readonly requires: ContractRequirements;
  readonly challenge?: ChallengeRules;
  readonly reward: EconomyReward;
  readonly reputation: number;
}

/** How a client's standing with the guild moves, and the band it is kept in. */
export interface StandingRules {
  readonly success: number;
  readonly failure: number;
  readonly abandon: number;
  readonly min: number;
  readonly max: number;
}

export interface BoardRules {
  /** Offers on the board at once. */
  readonly size: number;
  /** Coarse steps before clients post new work. */
  readonly refreshSteps: number;
}

export interface ContractData {
  readonly standing: StandingRules;
  readonly board: BoardRules;
  readonly factions: readonly FactionDef[];
  readonly templates: readonly ContractTemplate[];
}

const FILE = 'contracts.json';

function nonNegative(value: unknown, path: string): number {
  const n = expectNumber(value, path);
  if (n < 0) throw new ContentValidationError(path, 'must not be negative');
  return n;
}

function positiveInteger(value: unknown, path: string): number {
  const n = expectNumber(value, path);
  if (!Number.isInteger(n) || n < 1) throw new ContentValidationError(path, 'must be a positive whole number');
  return n;
}

function parseReward(value: unknown, path: string): EconomyReward {
  const r = expectObject(value, path);
  const base = {
    gold: nonNegative(field(r, 'gold', path), `${path}.gold`),
    food: nonNegative(field(r, 'food', path), `${path}.food`),
    materials: nonNegative(field(r, 'materials', path), `${path}.materials`),
  };
  const extrasRaw = optionalField(r, 'extras');
  if (extrasRaw === undefined) return base;
  const extras: Record<string, number> = {};
  for (const [id, amount] of Object.entries(expectObject(extrasRaw, `${path}.extras`))) {
    const n = expectNumber(amount, `${path}.extras.${id}`);
    if (n <= 0) throw new ContentValidationError(`${path}.extras.${id}`, 'must be positive');
    extras[id] = n;
  }
  return { ...base, extras };
}

function parseRequirements(value: unknown, path: string): ContractRequirements {
  if (value === undefined) return {};
  const o = expectObject(value, path);
  const out: { reputation?: number; capability?: Partial<Record<CapabilityAxis, number>>; standing?: number } = {};
  const reputation = optionalField(o, 'reputation');
  if (reputation !== undefined) out.reputation = nonNegative(reputation, `${path}.reputation`);
  const standing = optionalField(o, 'standing');
  if (standing !== undefined) out.standing = expectNumber(standing, `${path}.standing`);
  const capability = optionalField(o, 'capability');
  if (capability !== undefined) {
    const axes: Partial<Record<CapabilityAxis, number>> = {};
    for (const [axis, min] of Object.entries(expectObject(capability, `${path}.capability`))) {
      const p = `${path}.capability.${axis}`;
      axes[expectEnum(axis, p, CAPABILITY_AXES)] = nonNegative(min, p);
    }
    out.capability = axes;
  }
  return out;
}

function parseChallenge(value: unknown, path: string): ChallengeRules | undefined {
  if (value === undefined) return undefined;
  const o = expectObject(value, path);
  const out: { summary: string; maxPartySize?: number; maxMemberLevel?: number; forbiddenRoles?: Role[] } = {
    summary: expectString(field(o, 'summary', path), `${path}.summary`),
  };
  const size = optionalField(o, 'maxPartySize');
  if (size !== undefined) out.maxPartySize = positiveInteger(size, `${path}.maxPartySize`);
  const level = optionalField(o, 'maxMemberLevel');
  if (level !== undefined) out.maxMemberLevel = positiveInteger(level, `${path}.maxMemberLevel`);
  const roles = optionalField(o, 'forbiddenRoles');
  if (roles !== undefined) {
    out.forbiddenRoles = expectArray(roles, `${path}.forbiddenRoles`).map((role, i) =>
      expectEnum(role, `${path}.forbiddenRoles[${i}]`, ROLES),
    );
  }
  if (out.maxPartySize === undefined && out.maxMemberLevel === undefined && out.forbiddenRoles === undefined) {
    throw new ContentValidationError(path, 'a challenge contract must constrain something');
  }
  return out;
}

export function parseContracts(raw: unknown): ContractData {
  const root = expectObject(raw, FILE);

  const sPath = `${FILE}.standing`;
  const s = expectObject(field(root, 'standing', FILE), sPath);
  const standing: StandingRules = {
    success: expectNumber(field(s, 'success', sPath), `${sPath}.success`),
    failure: expectNumber(field(s, 'failure', sPath), `${sPath}.failure`),
    abandon: expectNumber(field(s, 'abandon', sPath), `${sPath}.abandon`),
    min: expectNumber(field(s, 'min', sPath), `${sPath}.min`),
    max: expectNumber(field(s, 'max', sPath), `${sPath}.max`),
  };
  if (standing.min >= 0 || standing.max <= 0) {
    throw new ContentValidationError(sPath, 'standing must be able to fall below and rise above neutral');
  }
  if (standing.success <= 0 || standing.failure >= 0 || standing.abandon >= 0) {
    throw new ContentValidationError(sPath, 'success must raise standing; failure and abandoning must lower it');
  }

  const bPath = `${FILE}.board`;
  const b = expectObject(field(root, 'board', FILE), bPath);
  const board: BoardRules = {
    size: positiveInteger(field(b, 'size', bPath), `${bPath}.size`),
    refreshSteps: positiveInteger(field(b, 'refreshSteps', bPath), `${bPath}.refreshSteps`),
  };

  const factionsPath = `${FILE}.factions`;
  const factions = expectArray(field(root, 'factions', FILE), factionsPath).map((value, i): FactionDef => {
    const p = `${factionsPath}[${i}]`;
    const o = expectObject(value, p);
    return { id: expectString(field(o, 'id', p), `${p}.id`), name: expectString(field(o, 'name', p), `${p}.name`) };
  });
  assertUniqueIds(factions.map((f) => f.id), factionsPath);

  const templatesPath = `${FILE}.templates`;
  const templates = expectArray(field(root, 'templates', FILE), templatesPath).map((value, i): ContractTemplate => {
    const p = `${templatesPath}[${i}]`;
    const o = expectObject(value, p);
    const challenge = parseChallenge(optionalField(o, 'challenge'), `${p}.challenge`);
    return {
      id: expectString(field(o, 'id', p), `${p}.id`),
      name: expectString(field(o, 'name', p), `${p}.name`),
      factionId: expectString(field(o, 'factionId', p), `${p}.factionId`),
      regionId: expectString(field(o, 'regionId', p), `${p}.regionId`),
      objective: expectEnum(field(o, 'objective', p), `${p}.objective`, CONTRACT_OBJECTIVES),
      tier: positiveInteger(field(o, 'tier', p), `${p}.tier`),
      requires: parseRequirements(optionalField(o, 'requires'), `${p}.requires`),
      ...(challenge ? { challenge } : {}),
      reward: parseReward(field(o, 'reward', p), `${p}.reward`),
      reputation: nonNegative(field(o, 'reputation', p), `${p}.reputation`),
    };
  });
  assertUniqueIds(templates.map((t) => t.id), templatesPath);

  // A board that can never fill at the start of a save is a board a new player never sees.
  const openFromStart = templates.filter(
    (t) => t.requires.reputation === undefined && t.requires.capability === undefined && t.requires.standing === undefined,
  );
  if (openFromStart.length === 0) {
    throw new ContentValidationError(templatesPath, 'at least one contract must be open to a brand-new guild');
  }

  return { standing, board, factions, templates };
}
