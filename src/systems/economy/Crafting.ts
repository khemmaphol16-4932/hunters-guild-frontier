import type { Hunter } from '../../core/hunter/Hunter.js';
import type { Item } from '../../core/items/Item.js';
import type { Rng } from '../../core/rng.js';
import { err, ok, type Result } from '../../core/result.js';
import type { CraftingData, RecipeDef } from '../../data/craftingSchema.js';
import type { Resources } from './Resources.js';

export interface CraftPreview {
  readonly recipe: RecipeDef;
  readonly affordable: boolean;
  /** Whether the recipe's workshop stands in the town. */
  readonly workshopBuilt: boolean;
  readonly durationSteps: number;
  readonly qualityFloor: number;
  readonly qualityCeiling: number;
}
export interface CraftOrder {
  readonly id: string;
  readonly recipeId: string;
  readonly crafterId: string;
  readonly startedAtTick: number;
  readonly readyAtTick: number;
  readonly item: Item;
}
export interface CraftingSnapshot { readonly orders: readonly CraftOrder[]; readonly nextOrder: number }

export interface CraftingDeps {
  readonly data: CraftingData;
  readonly resources: Resources;
  readonly generate: (rng: Rng, recipe: RecipeDef, qualityFloor: number) => Item;
  readonly currentTick: () => number;
  readonly ticksPerStep: () => number;
  /** Whether a working (undamaged) building of this id stands in the town. */
  readonly hasBuilding: (buildingId: string) => boolean;
}

/**
 * Targeted crafting (REQ-ECO-004): craft is certainty, loot is the jackpot.
 *
 * Every recipe needs its workshop. The first version let a guild with no smithy forge
 * blades, which made the town's crafting buildings decorative and put crafting within reach
 * from the first minute of a save.
 */
export class Crafting {
  private readonly byId: ReadonlyMap<string, RecipeDef>;
  private orders: CraftOrder[] = [];
  private nextOrder = 1;

  constructor(private readonly deps: CraftingDeps) {
    this.byId = new Map(deps.data.recipes.map((recipe) => [recipe.id, recipe]));
  }

  recipes(): readonly RecipeDef[] { return this.deps.data.recipes; }

  preview(recipeId: string, crafter: Hunter): Result<CraftPreview, string> {
    const recipe = this.byId.get(recipeId);
    if (!recipe) return err(`unknown recipe "${recipeId}"`);
    const balance = this.deps.data.crafter;
    const capability = Math.min(
      1,
      (crafter.attributes.dex + crafter.attributes.int + crafter.level * balance.levelWeight) /
        balance.attributeDivisor,
    );
    return ok({
      recipe,
      affordable: this.deps.resources.canAfford(recipe.cost),
      workshopBuilt: this.deps.hasBuilding(recipe.building),
      durationSteps: Math.max(1, Math.ceil(recipe.durationSteps * (1 - capability * balance.speedGain))),
      qualityFloor: balance.qualityFloorBase + capability * balance.qualityFloorGain,
      qualityCeiling: 1,
    });
  }

  active(): readonly CraftOrder[] { return [...this.orders]; }

  start(rng: Rng, recipeId: string, crafter: Hunter): Result<{ order: CraftOrder; preview: CraftPreview }, string> {
    if (this.orders.some((order) => order.crafterId === crafter.id)) return err(`${crafter.name} is already crafting`);
    const preview = this.preview(recipeId, crafter);
    if (!preview.ok) return preview;
    if (!preview.value.workshopBuilt) {
      return err(`${preview.value.recipe.name} needs a working ${preview.value.recipe.building.replace(/_/g, ' ')}`);
    }
    const paid = this.deps.resources.transact({ debits: preview.value.recipe.cost });
    if (!paid.ok) return err(paid.error);
    const item = this.deps.generate(rng, preview.value.recipe, preview.value.qualityFloor);
    const startedAtTick = this.deps.currentTick();
    const order: CraftOrder = {
      id: `craft_${this.nextOrder++}`,
      recipeId,
      crafterId: String(crafter.id),
      startedAtTick,
      readyAtTick: startedAtTick + preview.value.durationSteps * this.deps.ticksPerStep(),
      item,
    };
    this.orders.push(order);
    return ok({ order, preview: preview.value });
  }

  completeReady(): readonly CraftOrder[] {
    const ready = this.orders.filter((order) => order.readyAtTick <= this.deps.currentTick());
    const ids = new Set(ready.map((order) => order.id));
    this.orders = this.orders.filter((order) => !ids.has(order.id));
    return ready;
  }

  snapshot(): CraftingSnapshot { return { orders: this.active(), nextOrder: this.nextOrder }; }

  restore(snapshot: CraftingSnapshot | undefined): void {
    this.orders = snapshot ? [...snapshot.orders] : [];
    this.nextOrder = Math.max(1, snapshot?.nextOrder ?? 1);
  }
}
