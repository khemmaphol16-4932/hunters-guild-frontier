import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/data/loader.js';
import { Market } from '../src/systems/economy/Market.js';
import { Resources } from '../src/systems/economy/Resources.js';

const market = () => { const content = loadContent(); const resources = new Resources(content.economy.resources); return { resources, market: new Market(content.economy.market, resources) }; };

describe('bounded market (REQ-ECO-005)', () => {
  it('buys and sells through one atomic ledger transaction', () => {
    const h = market(); const gold = h.resources.amount('gold'); const food = h.resources.amount('food');
    const bought = h.market.buy('food', 10); expect(bought.ok).toBe(true); if (!bought.ok) return;
    expect(h.resources.amount('food')).toBe(food + 10); expect(h.resources.amount('gold')).toBe(gold - bought.value.total);
    const sold = h.market.sell('food', 5); expect(sold.ok).toBe(true); if (!sold.ok) return;
    expect(h.resources.amount('gold')).toBe(gold - bought.value.total + sold.value.total);
  });
  it('moves prices with demand, clamps them, and reverts toward baseline', () => {
    const h = market(); const first = h.market.quote('food', 1, 'buy'); expect(first.ok).toBe(true);
    for (let i = 0; i < 30; i++) h.market.buy('food', 1);
    const high = h.market.quote('food', 1, 'buy'); expect(high.ok && first.ok && high.value.unitPrice).toBeGreaterThan(first.ok ? first.value.unitPrice : 0);
    h.market.step(100);
    const reverted = h.market.quote('food', 1, 'buy'); expect(reverted.ok && first.ok ? reverted.value.unitPrice : 0).toBe(first.ok ? first.value.unitPrice : 0);
  });
  it('never permits buy-low/sell-high profit inside one unchanged quote cycle', () => {
    const h = market(); const before = h.resources.amount('gold'); expect(h.market.buy('materials', 5).ok).toBe(true); expect(h.market.sell('materials', 5).ok).toBe(true); expect(h.resources.amount('gold')).toBeLessThan(before);
  });
  it('round-trips market state', () => {
    const first = market(); first.market.buy('food', 7); const second = market(); second.market.restore(first.market.snapshot()); expect(second.market.snapshot()).toEqual(first.market.snapshot());
  });
});
