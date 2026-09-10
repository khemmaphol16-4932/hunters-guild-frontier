import {
  ContentValidationError,
  assertUniqueIds,
  expectArray,
  expectNumber,
  expectObject,
  expectString,
  field,
} from './schema.js';

export interface RecipeDef {
  readonly id: string;
  readonly name: string;
  readonly typeId: string;
  readonly rarity: string;
  readonly itemLevel: number;
  readonly durationSteps: number;
  /** The workshop that must stand in the town for this recipe to be started. */
  readonly building: string;
  readonly cost: Readonly<Record<string, number>>;
}

/** How a crafter's hands and experience become speed and a quality floor. */
export interface CrafterBalance {
  readonly levelWeight: number;
  readonly attributeDivisor: number;
  readonly speedGain: number;
  readonly qualityFloorBase: number;
  readonly qualityFloorGain: number;
}

export interface CraftingData {
  readonly crafter: CrafterBalance;
  readonly recipes: readonly RecipeDef[];
}

const FILE = 'recipes.json';

function positive(value: unknown, path: string): number {
  const n = expectNumber(value, path);
  if (n <= 0) throw new ContentValidationError(path, 'must be positive');
  return n;
}

export function parseCrafting(raw: unknown): CraftingData {
  const root = expectObject(raw, FILE);

  const crafterPath = `${FILE}.crafter`;
  const c = expectObject(field(root, 'crafter', FILE), crafterPath);
  const fraction = (key: keyof CrafterBalance): number => {
    const n = expectNumber(field(c, key, crafterPath), `${crafterPath}.${key}`);
    if (n < 0 || n > 1) throw new ContentValidationError(`${crafterPath}.${key}`, 'must be between 0 and 1');
    return n;
  };
  const crafter: CrafterBalance = {
    levelWeight: expectNumber(field(c, 'levelWeight', crafterPath), `${crafterPath}.levelWeight`),
    attributeDivisor: positive(field(c, 'attributeDivisor', crafterPath), `${crafterPath}.attributeDivisor`),
    speedGain: fraction('speedGain'),
    qualityFloorBase: fraction('qualityFloorBase'),
    qualityFloorGain: fraction('qualityFloorGain'),
  };
  if (crafter.qualityFloorBase + crafter.qualityFloorGain > 1) {
    throw new ContentValidationError(crafterPath, 'the best crafter\u2019s quality floor would exceed the ceiling of 1');
  }

  const recipesPath = `${FILE}.recipes`;
  const recipes = expectArray(field(root, 'recipes', FILE), recipesPath).map((entry, index): RecipeDef => {
    const path = `${recipesPath}[${index}]`;
    const value = expectObject(entry, path);
    const costPath = `${path}.cost`;
    const cost: Record<string, number> = {};
    for (const [resource, amount] of Object.entries(expectObject(field(value, 'cost', path), costPath))) {
      cost[resource] = positive(amount, `${costPath}.${resource}`);
    }
    return {
      id: expectString(field(value, 'id', path), `${path}.id`),
      name: expectString(field(value, 'name', path), `${path}.name`),
      typeId: expectString(field(value, 'typeId', path), `${path}.typeId`),
      rarity: expectString(field(value, 'rarity', path), `${path}.rarity`),
      itemLevel: positive(field(value, 'itemLevel', path), `${path}.itemLevel`),
      durationSteps: positive(field(value, 'durationSteps', path), `${path}.durationSteps`),
      building: expectString(field(value, 'building', path), `${path}.building`),
      cost,
    };
  });
  assertUniqueIds(recipes.map((recipe) => recipe.id), recipesPath);

  return { crafter, recipes };
}
