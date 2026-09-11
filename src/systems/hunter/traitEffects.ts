/**
 * Reading a hunter's traits as numbers.
 *
 * A trait's `effects` are named multipliers and shifts. They only do anything where a system
 * asks for them by name, and `tests/legacyTraits.test.ts` checks that every effect named in
 * `traits.json` is asked for somewhere — or is listed as a known gap in TECH_DEBT. The Phase
 * 7–8 review found seven of the eight innate traits with no effect anything read, which is the
 * same failure as a Legacy unlock with no consumer: shown to the player, valued by the
 * recruiter, and inert.
 */

import type { Hunter } from '../../core/hunter/Hunter.js';
import type { TraitDef } from '../../data/schema.js';

/** The product of every multiplier this hunter's traits carry for `effect` (1 when none do). */
export function traitMultiplier(
  hunter: Hunter,
  traitsById: ReadonlyMap<string, TraitDef>,
  effect: string,
): number {
  let multiplier = 1;
  for (const traitId of hunter.traitIds) {
    const value = traitsById.get(traitId)?.effects[effect];
    if (typeof value === 'number') multiplier *= value;
  }
  return multiplier;
}

/** The sum of every additive shift this hunter's traits carry for `effect` (0 when none do). */
export function traitSum(
  hunter: Hunter,
  traitsById: ReadonlyMap<string, TraitDef>,
  effect: string,
): number {
  let total = 0;
  for (const traitId of hunter.traitIds) {
    const value = traitsById.get(traitId)?.effects[effect];
    if (typeof value === 'number') total += value;
  }
  return total;
}
