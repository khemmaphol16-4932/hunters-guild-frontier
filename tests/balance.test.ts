import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/data/loader.js';
import { runEconomyBalance } from '../src/sim/Balance.js';
describe('long-run economy balance (risk R5 / §141)',()=>{
  it('keeps every tracked quantity bounded for ten thousand steps',()=>{const report=runEconomyBalance(loadContent());expect(report.violations).toEqual([]);expect(report.steps).toBe(10000);});
  it('is deterministic and a sustainable town recovers from its founding stock drawdown',()=>{const a=runEconomyBalance(loadContent(),1000);const b=runEconomyBalance(loadContent(),1000);expect(a).toEqual(b);expect(a.finalBalances['food']).toBeGreaterThan(0);});
});
