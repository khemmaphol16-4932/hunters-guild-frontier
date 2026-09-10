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
  readonly foodConsumptionPerResidentPerStep: number;
  readonly expeditionRewards: Readonly<Record<'blue' | 'yellow' | 'red' | 'black', EconomyReward>>;
  readonly townHuntRewards: EconomyReward;
}

export interface EconomyReward { readonly gold: number; readonly food: number; readonly materials: number }

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
  const foodConsumption = (value as Record<string, unknown>)['foodConsumptionPerResidentPerStep'];
  if (typeof foodConsumption !== 'number' || !Number.isFinite(foodConsumption) || foodConsumption <= 0) {
    throw new ContentValidationError('resources.json.foodConsumptionPerResidentPerStep', 'must be positive');
  }
  const reward = (rawReward: unknown, path: string): EconomyReward => {
    if (typeof rawReward !== 'object' || rawReward === null) throw new ContentValidationError(path, 'must be an object');
    const record = rawReward as Record<string, unknown>;
    const read = (key: keyof EconomyReward): number => {
      const amount = record[key];
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) throw new ContentValidationError(`${path}.${key}`, 'must be non-negative');
      return amount;
    };
    return { gold: read('gold'), food: read('food'), materials: read('materials') };
  };
  const rewardsRaw = (value as Record<string, unknown>)['expeditionRewards'];
  if (typeof rewardsRaw !== 'object' || rewardsRaw === null) throw new ContentValidationError('resources.json.expeditionRewards', 'must be an object');
  const rewardRecord = rewardsRaw as Record<string, unknown>;
  const expeditionRewards = {
    blue: reward(rewardRecord['blue'], 'resources.json.expeditionRewards.blue'),
    yellow: reward(rewardRecord['yellow'], 'resources.json.expeditionRewards.yellow'),
    red: reward(rewardRecord['red'], 'resources.json.expeditionRewards.red'),
    black: reward(rewardRecord['black'], 'resources.json.expeditionRewards.black'),
  };
  const townHuntRewards = reward((value as Record<string, unknown>)['townHuntRewards'], 'resources.json.townHuntRewards');
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
  return { resources, repairCostScale, foodConsumptionPerResidentPerStep: foodConsumption, expeditionRewards, townHuntRewards };
}
