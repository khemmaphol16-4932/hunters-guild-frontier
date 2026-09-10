import type { Resources } from './Resources.js';

export interface FoodReport {
  readonly produced: number;
  readonly consumed: number;
  readonly shortfall: number;
  readonly stock: number;
  readonly fedFraction: number;
}
export interface FoodSnapshot { readonly fedFraction: number }

/** Stored provisions flow. Buildings limit service capacity; this decides whether food exists. */
export class Food {
  private lastFedFraction = 1;

  constructor(
    private readonly resources: Resources,
    private readonly consumptionPerResidentPerStep: number,
    /** World-variant scaling on what each resident eats (the Long Winter), 1 otherwise. */
    private readonly consumptionScale: () => number = () => 1,
  ) {}

  get fedFraction(): number { return this.lastFedFraction; }

  step(population: number, steps: number, producedPerStep: number): FoodReport {
    if (steps <= 0) {
      return { produced: 0, consumed: 0, shortfall: 0, stock: this.resources.amount('food'), fedFraction: this.lastFedFraction };
    }
    const produced = Math.max(0, producedPerStep * steps);
    if (produced > 0) this.resources.transact({ credits: { food: produced } });
    const required = Math.max(0, population * this.consumptionPerResidentPerStep * this.consumptionScale() * steps);
    const consumed = this.resources.consumeAvailable('food', required);
    if (!consumed.ok) throw new Error(consumed.error);
    this.lastFedFraction = required <= 0 ? 1 : consumed.value.consumed / required;
    return {
      produced,
      consumed: consumed.value.consumed,
      shortfall: consumed.value.shortfall,
      stock: this.resources.amount('food'),
      fedFraction: this.lastFedFraction,
    };
  }

  snapshot(): FoodSnapshot { return { fedFraction: this.lastFedFraction }; }
  restore(snapshot: FoodSnapshot | undefined): void {
    this.lastFedFraction = Math.max(0, Math.min(1, snapshot?.fedFraction ?? 1));
  }
}
