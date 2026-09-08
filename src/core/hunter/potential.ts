/**
 * Hunter potential.
 *
 * REQ-HUN-008/009. Potential is visible at recruitment and is *composite*: a legendary
 * hunter is not the one with the biggest single number, but the one whose combination of
 * ceiling, growth, mastery aptitude, resilience, traits and unique skill suggests they
 * could become something no other hunter will become (§17).
 *
 * That matters mechanically, not just rhetorically: because the tier is a weighted blend,
 * a hunter can reach "prodigy" through exceptional mastery aptitude alone — a hunter who
 * is unremarkable on paper but becomes extraordinary through what they actually do
 * (REQ-PRIME-004). Reducing potential to one scalar would delete that possibility.
 */

import type { PotentialBalance, TraitDef } from '../../data/schema.js';
import type { TraitId } from '../ids.js';
import { asTraitId } from '../ids.js';
import type { Rng } from '../rng.js';

export interface Potential {
  /** Named multipliers: attributeCeiling, growthRate, masteryAptitude, resilience. */
  readonly facets: Readonly<Record<string, number>>;
  readonly traitIds: readonly TraitId[];
  readonly hasUniqueSkill: boolean;
  /** 0..1 blend across every facet. Internal — never shown as a power score (REQ-CAP-001). */
  readonly composite: number;
  readonly tier: string;
}

/** Normalise a facet roll to 0..1 within its own configured range. */
function normaliseFacet(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

export function rollPotential(
  rng: Rng,
  balance: PotentialBalance,
  availableTraits: readonly TraitDef[],
): Potential {
  const facets: Record<string, number> = {};
  const normalised: Record<string, number> = {};

  for (const [name, range] of Object.entries(balance.facets)) {
    const value = rng.range(range.min, range.max);
    facets[name] = value;
    normalised[name] = normaliseFacet(value, range.min, range.max);
  }

  const traitCount = rng.weighted(
    balance.traitSlots.map((slot) => ({ value: slot.value, weight: slot.weight })),
  ) ?? 0;

  const traitIds: TraitId[] = [];
  const pool = availableTraits.filter((t) => t.origin === 'innate');
  const remaining = [...pool];
  for (let i = 0; i < traitCount && remaining.length > 0; i++) {
    const index = rng.int(0, remaining.length);
    const picked = remaining[index];
    if (picked) traitIds.push(asTraitId(picked.id));
    remaining.splice(index, 1);
  }

  const hasUniqueSkill = rng.bool(balance.uniqueSkillChance);

  const maxTraitSlots = balance.traitSlots.reduce((max, s) => Math.max(max, s.value), 0);
  const contributions: Record<string, number> = {
    ...normalised,
    traitCount: maxTraitSlots > 0 ? traitIds.length / maxTraitSlots : 0,
    uniqueSkill: hasUniqueSkill ? 1 : 0,
  };

  let composite = 0;
  let weightSum = 0;
  for (const [name, weight] of Object.entries(balance.tiers.compositeWeights)) {
    composite += (contributions[name] ?? 0) * weight;
    weightSum += weight;
  }
  composite = weightSum > 0 ? composite / weightSum : 0;

  return {
    facets,
    traitIds,
    hasUniqueSkill,
    composite,
    tier: tierForComposite(composite, balance),
  };
}

export function tierForComposite(composite: number, balance: PotentialBalance): string {
  let result = balance.tiers.order[0] ?? 'common';
  for (const tier of balance.tiers.order) {
    const threshold = balance.tiers.thresholds[tier];
    if (threshold !== undefined && composite >= threshold) result = tier;
  }
  return result;
}

export function facet(potential: Potential, name: string, fallback = 1): number {
  return potential.facets[name] ?? fallback;
}

/**
 * Plain-language summary for the recruitment screen and the build dashboard.
 * REQ-RCT-002 requires an exceptional recruit to be legible at a glance, and REQ-UX-002
 * requires the easy view to avoid raw numbers.
 */
export function describePotential(potential: Potential): string[] {
  const notes: string[] = [];
  const ordered = Object.entries(potential.facets).sort((a, b) => b[1] - a[1]);
  const best = ordered[0];
  const worst = ordered[ordered.length - 1];

  const label: Record<string, string> = {
    attributeCeiling: 'raw attribute ceiling',
    growthRate: 'rate of growth',
    masteryAptitude: 'aptitude for learning from experience',
    resilience: 'resilience under pressure',
  };

  if (best) notes.push(`Strongest in ${label[best[0]] ?? best[0]}.`);
  if (worst && worst[0] !== best?.[0]) {
    notes.push(`Weakest in ${label[worst[0]] ?? worst[0]}.`);
  }
  if (potential.traitIds.length > 0) {
    notes.push(`Carries ${potential.traitIds.length} innate trait(s).`);
  }
  if (potential.hasUniqueSkill) notes.push('Shows signs of a skill no one else has.');

  return notes;
}
