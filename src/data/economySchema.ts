import { ContentValidationError } from './schema.js';

export type ResourceCategory =
  | 'currency'
  | 'core'
  | 'construction'
  | 'crafting'
  | 'specialized'
  | 'rare';

export interface ResourceDef {
  readonly id: string;
  readonly name: string;
  readonly category: ResourceCategory;
  readonly starting: number;
}

export interface EconomyData {
  readonly resources: readonly ResourceDef[];
  readonly repairCostScale: number;
}

const CATEGORIES = new Set<ResourceCategory>([
  'currency', 'core', 'construction', 'crafting', 'specialized', 'rare',
]);

export function parseEconomy(value: unknown): EconomyData {
  if (typeof value !== 'object' || value === null) {
    throw new ContentValidationError('resources.json', 'must be an object');
  }
  const raw = (value as Record<string, unknown>)['resources'];
  const repairCostScale = (value as Record<string, unknown>)['repairCostScale'];
  if (typeof repairCostScale !== 'number' || repairCostScale <= 0 || repairCostScale > 1) {
    throw new ContentValidationError('resources.json.repairCostScale', 'must be above 0 and at most 1');
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ContentValidationError('resources.json.resources', 'must be a non-empty array');
  }
  const seen = new Set<string>();
  const resources = raw.map((entry, index): ResourceDef => {
    const path = `resources.json.resources[${index}]`;
    if (typeof entry !== 'object' || entry === null) {
      throw new ContentValidationError(path, 'must be an object');
    }
    const record = entry as Record<string, unknown>;
    const id = record['id'];
    const name = record['name'];
    const category = record['category'];
    const starting = record['starting'];
    if (typeof id !== 'string' || id.length === 0) throw new ContentValidationError(`${path}.id`, 'must be a non-empty string');
    if (seen.has(id)) throw new ContentValidationError(`${path}.id`, `duplicate resource "${id}"`);
    seen.add(id);
    if (typeof name !== 'string' || name.length === 0) throw new ContentValidationError(`${path}.name`, 'must be a non-empty string');
    if (typeof category !== 'string' || !CATEGORIES.has(category as ResourceCategory)) throw new ContentValidationError(`${path}.category`, 'is not a valid category');
    if (typeof starting !== 'number' || !Number.isFinite(starting) || starting < 0) throw new ContentValidationError(`${path}.starting`, 'must be a non-negative number');
    return { id, name, category: category as ResourceCategory, starting };
  });
  if (!seen.has('gold')) throw new ContentValidationError('resources.json', 'must define the gold ledger');
  return { resources, repairCostScale };
}
