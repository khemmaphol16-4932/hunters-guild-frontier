/**
 * Branded identifier types.
 *
 * A HunterId and a SkillId are both strings at runtime, but mixing them is a bug the
 * compiler should catch — the systems layer passes ids across many boundaries
 * (loadouts, mastery tables, chronicle entries, save payloads) and a silent mix-up
 * would surface as missing data far from its cause.
 *
 * Id minting takes an Rng so that world generation stays reproducible (REQ-TEC-005).
 */

import type { Rng } from './rng.js';

declare const brand: unique symbol;

type Branded<T, B extends string> = T & { readonly [brand]: B };

export type HunterId = Branded<string, 'HunterId'>;
export type SkillId = Branded<string, 'SkillId'>;
export type ItemId = Branded<string, 'ItemId'>;
export type CardId = Branded<string, 'CardId'>;
export type ArchetypeId = Branded<string, 'ArchetypeId'>;
export type AdvancedClassId = Branded<string, 'AdvancedClassId'>;
export type SpecializationId = Branded<string, 'SpecializationId'>;
export type PersonalityId = Branded<string, 'PersonalityId'>;
export type TraitId = Branded<string, 'TraitId'>;
export type ChronicleEntryId = Branded<string, 'ChronicleEntryId'>;

/** Cast a raw string from data or a save file into a branded id. */
export const asHunterId = (s: string): HunterId => s as HunterId;
export const asSkillId = (s: string): SkillId => s as SkillId;
export const asItemId = (s: string): ItemId => s as ItemId;
export const asCardId = (s: string): CardId => s as CardId;
export const asArchetypeId = (s: string): ArchetypeId => s as ArchetypeId;
export const asAdvancedClassId = (s: string): AdvancedClassId => s as AdvancedClassId;
export const asSpecializationId = (s: string): SpecializationId => s as SpecializationId;
export const asPersonalityId = (s: string): PersonalityId => s as PersonalityId;
export const asTraitId = (s: string): TraitId => s as TraitId;
export const asChronicleEntryId = (s: string): ChronicleEntryId => s as ChronicleEntryId;

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Mint a new opaque id from an RNG stream. Deterministic for a given stream state,
 * which is what allows a whole world — hunters included — to be regenerated from a seed.
 */
export function mintId(rng: Rng, prefix: string): string {
  let body = '';
  for (let i = 0; i < 10; i++) {
    body += ID_ALPHABET[rng.int(0, ID_ALPHABET.length)] ?? '0';
  }
  return `${prefix}_${body}`;
}

export const mintHunterId = (rng: Rng): HunterId => asHunterId(mintId(rng, 'hun'));
export const mintChronicleEntryId = (rng: Rng): ChronicleEntryId =>
  asChronicleEntryId(mintId(rng, 'chr'));
