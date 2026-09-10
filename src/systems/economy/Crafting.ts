import type { Hunter } from '../../core/hunter/Hunter.js';
import type { Item } from '../../core/items/Item.js';
import type { Rng } from '../../core/rng.js';
import { err, ok, type Result } from '../../core/result.js';
import type { CraftingData, RecipeDef } from '../../data/craftingSchema.js';
import type { Resources } from './Resources.js';

export interface CraftPreview { readonly recipe: RecipeDef; readonly affordable: boolean; readonly durationSteps: number; readonly qualityFloor: number; readonly qualityCeiling: number }
export interface CraftOrder { readonly id: string; readonly recipeId: string; readonly crafterId: string; readonly startedAtTick: number; readonly readyAtTick: number; readonly item: Item }
export interface CraftingSnapshot { readonly orders: readonly CraftOrder[]; readonly nextOrder: number }

export class Crafting {
  private readonly byId: ReadonlyMap<string, RecipeDef>;
  private orders: CraftOrder[] = [];
  private nextOrder = 1;
  constructor(private readonly data: CraftingData, private readonly resources: Resources, private readonly generate: (rng: Rng, recipe: RecipeDef, qualityFloor: number) => Item, private readonly currentTick: () => number, private readonly ticksPerStep: () => number) {
    this.byId = new Map(data.recipes.map((recipe) => [recipe.id, recipe]));
  }
  recipes(): readonly RecipeDef[] { return this.data.recipes; }
  preview(recipeId: string, crafter: Hunter): Result<CraftPreview, string> {
    const recipe = this.byId.get(recipeId); if (!recipe) return err(`unknown recipe "${recipeId}"`);
    const capability = Math.min(1, (crafter.attributes.dex + crafter.attributes.int + crafter.level * 2) / 220);
    return ok({ recipe, affordable: this.resources.canAfford(recipe.cost), durationSteps: Math.max(1, Math.ceil(recipe.durationSteps * (1 - capability * 0.35))), qualityFloor: 0.2 + capability * 0.35, qualityCeiling: 1 });
  }
  active(): readonly CraftOrder[] { return [...this.orders]; }
  start(rng: Rng, recipeId: string, crafter: Hunter): Result<{ order: CraftOrder; preview: CraftPreview }, string> {
    if (this.orders.some((order) => order.crafterId === crafter.id)) return err(`${crafter.name} is already crafting`);
    const preview = this.preview(recipeId, crafter); if (!preview.ok) return preview;
    const paid = this.resources.transact({ debits: preview.value.recipe.cost }); if (!paid.ok) return err(paid.error);
    const item = this.generate(rng, preview.value.recipe, preview.value.qualityFloor);
    const startedAtTick = this.currentTick();
    const order: CraftOrder = { id: `craft_${this.nextOrder++}`, recipeId, crafterId: String(crafter.id), startedAtTick, readyAtTick: startedAtTick + preview.value.durationSteps * this.ticksPerStep(), item };
    this.orders.push(order);
    return ok({ order, preview: preview.value });
  }
  completeReady(): readonly CraftOrder[] {
    const ready = this.orders.filter((order) => order.readyAtTick <= this.currentTick());
    const ids = new Set(ready.map((order) => order.id));
    this.orders = this.orders.filter((order) => !ids.has(order.id));
    return ready;
  }
  snapshot(): CraftingSnapshot { return { orders: this.active(), nextOrder: this.nextOrder }; }
  restore(snapshot: CraftingSnapshot | undefined): void { this.orders = snapshot ? [...snapshot.orders] : []; this.nextOrder = Math.max(1, snapshot?.nextOrder ?? 1); }
}
