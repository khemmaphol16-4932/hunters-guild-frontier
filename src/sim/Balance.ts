import type { GameContent } from '../data/loader.js';
import { Resources } from '../systems/economy/Resources.js';
import { Food } from '../systems/economy/Food.js';
import { Market } from '../systems/economy/Market.js';
import { createRng } from '../core/rng.js';

export interface BalanceReport {
  readonly steps: number;
  readonly finalBalances: Readonly<Record<string, number>>;
  readonly minFoodFulfilment: number;
  /** Largest gold gain any market round trip produced. Must never be positive. */
  readonly bestRoundTripProfit: number;
  readonly violations: readonly string[];
}

/**
 * The Phase 7 exit gate: a long deterministic soak of the economy (risk R5 / §141).
 *
 * The first version of this harness could not fail. It fed the town a fixed 2.2 food against
 * 2.0 eaten, traded one unit of materials every fifty steps, and checked for "exceeded
 * capacity" on a ledger that had already clamped the value — while the market had an
 * infinite-money loop that only appears on orders larger than one unit (DL-046). A gate that
 * cannot fail is not a gate, so each check below is written against a way the economy has
 * actually broken or plausibly could:
 *
 *   1. **Round trips never profit.** Every traded good, at the bottom, middle and top of its
 *      price band, bought and sold back — and sold and bought back — at sizes from one unit
 *      to the whole stock.
 *   2. **Nothing is paid for and lost.** A purchase that cannot be stored is refused, and a
 *      reward that overflows is reported rather than silently dropped.
 *   3. **Food fails, and recovers.** A long soak alternates a surplus town and a starving
 *      one: stock stays inside its capacity, shortage is visible as fulfilment below one, and
 *      the town recovers when production does.
 *   4. **Prices stay in their band** under a long run of seeded trades.
 */
export function runEconomyBalance(content: GameContent, steps = 10000): BalanceReport {
  const violations: string[] = [];
  const config = content.economy.market;

  // --- 1. Round trips --------------------------------------------------------------------
  let bestRoundTripProfit = -Infinity;
  for (const id of Object.keys(config.goods)) {
    for (const start of ['low', 'mid', 'high'] as const) {
      for (const order of ['buyFirst', 'sellFirst'] as const) {
        for (const size of [1, 5, 20, 50, 150, 400]) {
          const resources = new Resources(content.economy.resources);
          const market = new Market(config, resources);
          // Stock the guild so every size can be sold, and move the price to its start.
          resources.transact({ credits: { gold: 500_000, [id]: resources.room(id) } });
          const pushSide = start === 'low' ? 'sell' : 'buy';
          if (start !== 'mid') {
            for (let i = 0; i < 400; i++) {
              const pushed = pushSide === 'sell' ? market.sell(id, 1) : market.buy(id, 1);
              if (!pushed.ok) break;
            }
          }
          const before = resources.amount('gold');
          const units = Math.min(size, market.stockOf(id), resources.amount(id));
          if (units <= 0) continue;
          const first = order === 'buyFirst' ? market.buy(id, units) : market.sell(id, units);
          if (!first.ok) continue;
          const second = order === 'buyFirst' ? market.sell(id, units) : market.buy(id, units);
          if (!second.ok) continue;
          const profit = resources.amount('gold') - before;
          bestRoundTripProfit = Math.max(bestRoundTripProfit, profit);
          if (profit > 0) {
            violations.push(`${order} round trip of ${units} ${id} from a ${start} price earned ${profit} gold`);
          }
        }
      }
    }
  }

  // --- 2. Nothing paid for and lost -------------------------------------------------------
  {
    const resources = new Resources(content.economy.resources);
    const market = new Market(config, resources);
    const id = Object.keys(config.goods).find((good) => good !== 'gold');
    if (id) {
      resources.transact({ credits: { [id]: resources.room(id) } });
      const gold = resources.amount('gold');
      const bought = market.buy(id, 1);
      if (bought.ok || resources.amount('gold') !== gold) {
        violations.push(`buying ${id} into a full store was accepted or charged gold`);
      }
      const reward = resources.transact({ credits: { [id]: 10 } });
      if (!reward.ok || reward.value.discarded[id] !== 10) {
        violations.push(`an overflowing ${id} reward was not reported as discarded`);
      }
    }
  }

  // --- 3 & 4. The long soak --------------------------------------------------------------
  const resources = new Resources(content.economy.resources);
  const food = new Food(resources, content.economy.foodConsumptionPerResidentPerStep);
  const market = new Market(config, resources);
  const rng = createRng('economy-balance');
  const population = 20;
  const eaten = population * content.economy.foodConsumptionPerResidentPerStep;
  const phase = Math.max(1, Math.floor(steps / 10));
  let minFoodFulfilment = 1;
  let sawShortage = false;
  let recoveredAfterShortage = false;
  const goods = Object.keys(config.goods);

  for (let step = 0; step < steps; step++) {
    // Alternate a comfortable surplus with a real famine so both paths run for a long time.
    // The final phase is always a surplus, so the soak ends by proving recovery.
    const famine = Math.floor(step / phase) % 2 === 1 && step < steps - phase;
    const produced = famine ? eaten * 0.25 : eaten * 1.4;
    const report = food.step(population, 1, produced);
    minFoodFulfilment = Math.min(minFoodFulfilment, report.fedFraction);
    if (report.fedFraction < 1) sawShortage = true;
    if (sawShortage && !famine && report.fedFraction === 1) recoveredAfterShortage = true;

    market.step(1);
    const good = goods[Math.floor(rng.next() * goods.length)];
    if (good !== undefined) {
      const amount = 1 + Math.floor(rng.next() * 12);
      if (rng.next() < 0.5) market.buy(good, amount);
      else market.sell(good, Math.min(amount, Math.floor(resources.amount(good))));
    }

    for (const [id, amount] of Object.entries(resources.all())) {
      if (amount < 0) violations.push(`${id} fell below zero at step ${step}`);
      if (amount > resources.capacity(id)) violations.push(`${id} exceeded capacity at step ${step}`);
    }
    for (const id of goods) {
      const scale = market.scaleOf(id);
      if (scale < config.minPriceScale - 1e-9 || scale > config.maxPriceScale + 1e-9) {
        violations.push(`${id} price scale ${scale} left its band at step ${step}`);
      }
    }
  }

  if (steps >= phase * 2 && !sawShortage) violations.push('the famine phases never produced a shortage');
  if (steps >= phase * 3 && !recoveredAfterShortage) violations.push('the town never recovered from a shortage');
  if (resources.amount('food') <= 0) violations.push('food ended the soak in collapse');

  return {
    steps,
    finalBalances: resources.all(),
    minFoodFulfilment,
    bestRoundTripProfit,
    violations: [...new Set(violations)].slice(0, 50),
  };
}
