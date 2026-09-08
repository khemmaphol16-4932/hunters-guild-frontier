/**
 * Attributes, derived stats, levelling, respec, potential.
 * REQ-HUN-001 through REQ-HUN-009.
 */

import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/data/loader.js';
import {
  baseAttributes,
  computeDerivedStats,
  conditionMultiplier,
  withAttribute,
} from '../src/core/hunter/attributes.js';
import {
  allocate,
  applyExperience,
  attributePointBudget,
  isAtLevelCap,
  respecCost,
  respecToBase,
  totalXpToReach,
  unspentPoints,
  xpToNextLevel,
} from '../src/core/hunter/leveling.js';
import { rollPotential, tierForComposite } from '../src/core/hunter/potential.js';
import { createRng } from '../src/core/rng.js';

const content = loadContent();
const balance = content.balance.attributes;

describe('derived stats', () => {
  it('follows the linear model in the balance data', () => {
    const attributes = baseAttributes(balance); // all 5
    const stats = computeDerivedStats(attributes, 1, balance);

    // maxHp: base 80 + perLevel 6*1 + vit 9*5 + str 2*5 = 80 + 6 + 45 + 10 = 141
    expect(stats['maxHp']).toBeCloseTo(141, 6);
    // physicalAttack: 5 + 1*1 + str 2.2*5 + dex 0.6*5 = 5 + 1 + 11 + 3 = 20
    expect(stats['physicalAttack']).toBeCloseTo(20, 6);
  });

  it('responds to the attribute that governs it', () => {
    const base = baseAttributes(balance);
    const beefy = withAttribute(base, 'vit', 50);

    const before = computeDerivedStats(base, 10, balance)['maxHp'] ?? 0;
    const after = computeDerivedStats(beefy, 10, balance)['maxHp'] ?? 0;

    expect(after).toBeGreaterThan(before);
    // 45 extra VIT at 9 HP each.
    expect(after - before).toBeCloseTo(45 * 9, 6);
  });

  it('applies caps last, so a penalty cannot be absorbed by headroom', () => {
    const attributes = { ...baseAttributes(balance), luk: 400 };
    const uncapped = computeDerivedStats(attributes, 1, balance, { globalMultiplier: 1 });
    expect(uncapped['critChance']).toBe(balance.caps['critChance']);

    const penalised = computeDerivedStats(attributes, 1, balance, { globalMultiplier: 0.5 });
    // Half of a very large pre-cap value is still above the cap, so it stays capped —
    // but a stat with less headroom does drop.
    expect(penalised['maxHp']).toBeLessThan(uncapped['maxHp'] ?? 0);
  });

  it('scales everything by the condition multiplier', () => {
    const attributes = baseAttributes(balance);
    const rested = computeDerivedStats(attributes, 20, balance, { globalMultiplier: 1 });
    const exhausted = computeDerivedStats(attributes, 20, balance, { globalMultiplier: 0.8 });
    expect(exhausted['maxHp']).toBeCloseTo((rested['maxHp'] ?? 0) * 0.8, 6);
  });

  it('derives a condition multiplier that never reaches zero', () => {
    expect(conditionMultiplier(0, 0, 0.25, 0.2)).toBe(1);
    expect(conditionMultiplier(1, 1, 0.25, 0.2)).toBeCloseTo(0.55, 6);
    expect(conditionMultiplier(1, 1, 0.9, 0.9)).toBeGreaterThan(0);
  });
});

describe('levelling', () => {
  it('has a strictly increasing xp curve', () => {
    for (let level = 1; level < 99; level++) {
      expect(xpToNextLevel(level + 1, balance)).toBeGreaterThan(xpToNextLevel(level, balance));
    }
  });

  it('reports infinite xp requirement at the cap', () => {
    expect(xpToNextLevel(balance.maxLevel, balance)).toBe(Infinity);
    expect(isAtLevelCap(100, balance)).toBe(true);
    expect(isAtLevelCap(99, balance)).toBe(false);
  });

  it('accumulates total xp consistently', () => {
    expect(totalXpToReach(1, balance)).toBe(0);
    expect(totalXpToReach(3, balance)).toBe(
      xpToNextLevel(1, balance) + xpToNextLevel(2, balance),
    );
  });

  it('grants points from the individual hunter level (REQ-HUN-002)', () => {
    expect(attributePointBudget(1, balance)).toBe(balance.startingPoints);
    expect(attributePointBudget(11, balance)).toBe(
      balance.startingPoints + 10 * balance.pointsPerLevel,
    );
  });

  it('rolls over multiple levels from one large award', () => {
    const progress = applyExperience(1, 0, 10_000_000, balance);
    expect(progress.levelsGained).toBeGreaterThan(5);
    expect(progress.level).toBeGreaterThan(6);
  });

  it('discards excess xp at the cap rather than banking it', () => {
    const progress = applyExperience(100, 0, 10_000_000, balance);
    expect(progress.level).toBe(100);
    expect(progress.xp).toBe(0);
    expect(progress.atCap).toBe(true);
  });
});

describe('allocation and respec', () => {
  it('accepts allocation within budget', () => {
    const result = allocate(baseAttributes(balance), 10, [{ attribute: 'str', amount: 5 }], balance);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.str).toBe(balance.startingValue + 5);
  });

  it('rejects allocation beyond budget', () => {
    const budget = attributePointBudget(1, balance);
    const result = allocate(
      baseAttributes(balance),
      1,
      [{ attribute: 'str', amount: budget + 1 }],
      balance,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/exceeds the point budget/);
  });

  it('refuses to drop an attribute below its starting value', () => {
    const result = allocate(baseAttributes(balance), 10, [{ attribute: 'str', amount: -1 }], balance);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/starting value/);
  });

  it('rejects fractional points', () => {
    const result = allocate(baseAttributes(balance), 10, [{ attribute: 'str', amount: 1.5 }], balance);
    expect(result.ok).toBe(false);
  });

  it('round-trips a respec: allocate, reset, reallocate identically', () => {
    // REQ-HUN-003 — respec is cheap and available, so it must be lossless.
    const start = baseAttributes(balance);
    const allocated = allocate(start, 20, [{ attribute: 'dex', amount: 12 }], balance);
    expect(allocated.ok).toBe(true);
    if (!allocated.ok) return;

    const reset = respecToBase(balance);
    expect(reset).toEqual(start);
    expect(unspentPoints(reset, 20, balance)).toBe(attributePointBudget(20, balance));

    const reallocated = allocate(reset, 20, [{ attribute: 'dex', amount: 12 }], balance);
    expect(reallocated.ok).toBe(true);
    if (reallocated.ok) expect(reallocated.value).toEqual(allocated.value);
  });

  it('charges only for points removed, not for the full redistribution', () => {
    const from = { ...baseAttributes(balance), str: 15 };
    const to = { ...baseAttributes(balance), dex: 15 };
    // 10 points off STR; the 10 added to DEX are not charged again.
    expect(respecCost(from, to, balance)).toBe(10 * balance.respec.costPerPointMoved);
  });
});

describe('potential', () => {
  const potentialBalance = content.balance.potential;

  it('is deterministic under a fixed seed', () => {
    const a = rollPotential(createRng('pot'), potentialBalance, content.traits);
    const b = rollPotential(createRng('pot'), potentialBalance, content.traits);
    expect(a).toEqual(b);
  });

  it('is composite rather than a single scalar (REQ-HUN-009)', () => {
    const potential = rollPotential(createRng('pot2'), potentialBalance, content.traits);
    expect(Object.keys(potential.facets).length).toBeGreaterThanOrEqual(4);
  });

  it('keeps every facet inside its configured range', () => {
    const rng = createRng('ranges');
    for (let i = 0; i < 300; i++) {
      const potential = rollPotential(rng, potentialBalance, content.traits);
      for (const [name, value] of Object.entries(potential.facets)) {
        const range = potentialBalance.facets[name];
        expect(range).toBeDefined();
        if (!range) continue;
        expect(value).toBeGreaterThanOrEqual(range.min);
        expect(value).toBeLessThanOrEqual(range.max);
      }
    }
  });

  it('never grants duplicate traits', () => {
    const rng = createRng('traits');
    for (let i = 0; i < 200; i++) {
      const potential = rollPotential(rng, potentialBalance, content.traits);
      expect(new Set(potential.traitIds).size).toBe(potential.traitIds.length);
    }
  });

  it('produces a spread of tiers, with legendary genuinely rare', () => {
    const rng = createRng('tiers');
    const counts = new Map<string, number>();
    const runs = 4000;
    for (let i = 0; i < runs; i++) {
      const tier = rollPotential(rng, potentialBalance, content.traits).tier;
      counts.set(tier, (counts.get(tier) ?? 0) + 1);
    }
    // More than one tier must actually occur, or recruitment has no texture.
    expect(counts.size).toBeGreaterThan(1);
    const legendary = counts.get('legendary') ?? 0;
    expect(legendary / runs).toBeLessThan(0.05);
  });

  it('maps composites to tiers monotonically', () => {
    const order = potentialBalance.tiers.order;
    let lastIndex = -1;
    for (let c = 0; c <= 1; c += 0.02) {
      const index = order.indexOf(tierForComposite(c, potentialBalance));
      expect(index).toBeGreaterThanOrEqual(lastIndex);
      lastIndex = index;
    }
  });
});
