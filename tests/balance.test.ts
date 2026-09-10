import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/data/loader.js';
import { runEconomyBalance } from '../src/sim/Balance.js';

describe('long-run economy balance (risk R5 / §141)', () => {
  it('keeps every tracked quantity bounded for ten thousand steps and finds no free profit', () => {
    const report = runEconomyBalance(loadContent());
    expect(report.violations).toEqual([]);
    expect(report.steps).toBe(10000);
    expect(report.bestRoundTripProfit).toBeLessThanOrEqual(0);
  });

  it('is deterministic, sees real shortages, and the town recovers from them', () => {
    const a = runEconomyBalance(loadContent(), 1000);
    const b = runEconomyBalance(loadContent(), 1000);
    expect(a).toEqual(b);
    expect(a.minFoodFulfilment).toBeLessThan(1);
    expect(a.finalBalances['food']).toBeGreaterThan(0);
  });
});
