import type { Hunter } from '../../core/hunter/Hunter.js';
import type { Item } from '../../core/items/Item.js';
import type { Rng } from '../../core/rng.js';
import { err, ok, type Result } from '../../core/result.js';
import type { CraftingData, RecipeDef } from '../../data/craftingSchema.js';
import type { Resources } from './Resources.js';

export interface CraftPreview { readonly recipe: RecipeDef; readonly affordable: boolean; readonly durationSteps: number; readonly qualityFloor: number; readonly qualityCeiling: number }

export class Crafting {
  private readonly byId: ReadonlyMap<string, RecipeDef>;
  constructor(private readonly data: CraftingData, private readonly resources: Resources, private readonly generate: (rng: Rng, recipe: RecipeDef, qualityFloor: number) => Item) {
    this.byId = new Map(data.recipes.map((recipe) => [recipe.id, recipe]));
  }
  recipes(): readonly RecipeDef[] { return this.data.recipes; }
  preview(recipeId: string, crafter: Hunter): Result<CraftPreview, string> {
    const recipe = this.byId.get(recipeId); if (!recipe) return err(`unknown recipe "${recipeId}"`);
    const capability = Math.min(1, (crafter.attributes.dex + crafter.attributes.int + crafter.level * 2) / 220);
    return ok({ recipe, affordable: this.resources.canAfford(recipe.cost), durationSteps: Math.max(1, Math.ceil(recipe.durationSteps * (1 - capability * 0.35))), qualityFloor: 0.2 + capability * 0.35, qualityCeiling: 1 });
  }
  craft(rng: Rng, recipeId: string, crafter: Hunter): Result<{ item: Item; preview: CraftPreview }, string> {
    const preview = this.preview(recipeId, crafter); if (!preview.ok) return preview;
    const paid = this.resources.transact({ debits: preview.value.recipe.cost }); if (!paid.ok) return err(paid.error);
    const item = this.generate(rng, preview.value.recipe, preview.value.qualityFloor);
    return ok({ item, preview: preview.value });
  }
}
