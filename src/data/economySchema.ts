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
  readonly market: MarketConfig;
}

export interface EconomyReward { readonly gold: number; readonly food: number; readonly materials: number }
export interface MarketGood { readonly basePrice: number; readonly startingStock: number }
export interface MarketConfig {
  readonly minPriceScale: number; readonly maxPriceScale: number; readonly buyMarkup: number;
  readonly sellMarkdown: number; readonly impactPerUnit: number; readonly reversionPerStep: number;
  readonly goods: Readonly<Record<string, MarketGood>>;
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
  const marketRaw = (value as Record<string, unknown>)['market'];
  if (typeof marketRaw !== 'object' || marketRaw === null) throw new ContentValidationError('resources.json.market', 'must be an object');
  const marketRecord = marketRaw as Record<string, unknown>;
  const marketNumber = (key: string): number => { const n = marketRecord[key]; if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) throw new ContentValidationError(`resources.json.market.${key}`, 'must be positive'); return n; };
  const goodsRaw = marketRecord['goods'];
  if (typeof goodsRaw !== 'object' || goodsRaw === null) throw new ContentValidationError('resources.json.market.goods', 'must be an object');
  const goods: Record<string, MarketGood> = {};
  for (const [id, entry] of Object.entries(goodsRaw)) {
    if (typeof entry !== 'object' || entry === null) throw new ContentValidationError(`resources.json.market.goods.${id}`, 'must be an object');
    const record = entry as Record<string, unknown>; const basePrice = record['basePrice']; const startingStock = record['startingStock'];
    if (typeof basePrice !== 'number' || basePrice <= 0 || typeof startingStock !== 'number' || startingStock < 0) throw new ContentValidationError(`resources.json.market.goods.${id}`, 'price must be positive and stock non-negative');
    goods[id] = { basePrice, startingStock };
  }
  const market: MarketConfig = { minPriceScale: marketNumber('minPriceScale'), maxPriceScale: marketNumber('maxPriceScale'), buyMarkup: marketNumber('buyMarkup'), sellMarkdown: marketNumber('sellMarkdown'), impactPerUnit: marketNumber('impactPerUnit'), reversionPerStep: marketNumber('reversionPerStep'), goods };
  if (market.minPriceScale >= market.maxPriceScale) throw new ContentValidationError('resources.json.market', 'minPriceScale must be below maxPriceScale');
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
  return { resources, repairCostScale, foodConsumptionPerResidentPerStep: foodConsumption, expeditionRewards, townHuntRewards, market };
}
