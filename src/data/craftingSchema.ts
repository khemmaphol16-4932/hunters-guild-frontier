import { ContentValidationError } from './schema.js';

export interface RecipeDef {
  readonly id: string; readonly name: string; readonly typeId: string; readonly rarity: string;
  readonly itemLevel: number; readonly durationSteps: number; readonly cost: Readonly<Record<string, number>>;
}
export interface CraftingData { readonly recipes: readonly RecipeDef[] }

export function parseCrafting(raw: unknown): CraftingData {
  if (typeof raw !== 'object' || raw === null) throw new ContentValidationError('recipes.json', 'must be an object');
  const entries = (raw as Record<string, unknown>)['recipes'];
  if (!Array.isArray(entries)) throw new ContentValidationError('recipes.json.recipes', 'must be an array');
  const seen = new Set<string>();
  const recipes = entries.map((entry, index): RecipeDef => {
    const path = `recipes.json.recipes[${index}]`;
    if (typeof entry !== 'object' || entry === null) throw new ContentValidationError(path, 'must be an object');
    const value = entry as Record<string, unknown>;
    const string = (key: string): string => { const v = value[key]; if (typeof v !== 'string' || !v) throw new ContentValidationError(`${path}.${key}`, 'must be a non-empty string'); return v; };
    const number = (key: string): number => { const v = value[key]; if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new ContentValidationError(`${path}.${key}`, 'must be positive'); return v; };
    const id = string('id');
    if (seen.has(id)) throw new ContentValidationError(`${path}.id`, `duplicate recipe "${id}"`); seen.add(id);
    const costRaw = value['cost'];
    if (typeof costRaw !== 'object' || costRaw === null) throw new ContentValidationError(`${path}.cost`, 'must be an object');
    const cost: Record<string, number> = {};
    for (const [resource, amount] of Object.entries(costRaw)) {
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) throw new ContentValidationError(`${path}.cost.${resource}`, 'must be positive');
      cost[resource] = amount;
    }
    return { id, name: string('name'), typeId: string('typeId'), rarity: string('rarity'), itemLevel: number('itemLevel'), durationSteps: number('durationSteps'), cost };
  });
  return { recipes };
}
