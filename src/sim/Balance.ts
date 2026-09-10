import type { GameContent } from '../data/loader.js';
import { Resources } from '../systems/economy/Resources.js';
import { Food } from '../systems/economy/Food.js';
import { Market } from '../systems/economy/Market.js';

export interface BalanceReport { readonly steps: number; readonly finalBalances: Readonly<Record<string, number>>; readonly minFoodFulfilment: number; readonly violations: readonly string[] }

/** Long deterministic economy soak used by the Phase 7 exit gate (risk R5 / §141). */
export function runEconomyBalance(content: GameContent, steps = 10000): BalanceReport {
  const resources = new Resources(content.economy.resources);
  const food = new Food(resources, content.economy.foodConsumptionPerResidentPerStep);
  const market = new Market(content.economy.market, resources);
  let minFoodFulfilment = 1;
  const violations: string[] = [];
  for (let step = 0; step < steps; step++) {
    const report = food.step(20, 1, 2.2);
    minFoodFulfilment = Math.min(minFoodFulfilment, report.fedFraction);
    market.step(1);
    if (step % 50 === 0) {
      const bought = market.buy('materials', 1);
      if (bought.ok) market.sell('materials', 1);
    }
    for (const [id, amount] of Object.entries(resources.all())) {
      const capacity = content.resourcesById.get(id)?.capacity ?? Infinity;
      if (amount < 0) violations.push(`${id} fell below zero at step ${step}`);
      if (amount > capacity) violations.push(`${id} exceeded capacity at step ${step}`);
    }
  }
  if (resources.amount('food') <= 0) violations.push('sustainable food production ended in collapse');
  return { steps, finalBalances: resources.all(), minFoodFulfilment, violations };
}
