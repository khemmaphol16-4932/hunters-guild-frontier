/**
 * Item generation and the loot table.
 *
 * REQ-LOT-001 (weighted random, pity on some systems) and REQ-EQP-002/003.
 *
 * The pity counter lives here rather than in the caller because it has to survive across
 * drops to mean anything, and because a pity rule the caller can forget to apply is not a
 * pity rule. It is explicitly *not* a guarantee of good items — it forces a tier floor
 * after a long unlucky run, which is the difference between protecting a player from
 * bad luck and removing luck.
 */

import type { GameContent } from '../../data/loader.js';
import type { EquipmentSlot, ItemTypeDef, RarityDef } from '../../data/itemSchema.js';
import type { Rng } from '../../core/rng.js';
import { mintId, asItemId, type ItemId } from '../../core/ids.js';
import type { Item } from '../../core/items/Item.js';
import { Substats } from './Substats.js';

export interface GenerateOptions {
  readonly itemLevel: number;
  /** Force a rarity, bypassing the weighted roll and the pity counter. */
  readonly rarity?: string;
  readonly slot?: EquipmentSlot;
  readonly typeId?: string;
  /** Force a set, if the rarity permits one. */
  readonly setId?: string;
  /** Chance a set-capable item rolls as a set piece. */
  readonly setChance?: number;
}

export interface PityState {
  /** Drops since the last item at or above the pity tier. */
  readonly sinceTier: number;
}

const DEFAULT_SET_CHANCE = 0.35;

export class ItemGenerator {
  private readonly substats: Substats;
  private readonly rarityRank: ReadonlyMap<string, number>;
  private pitySinceTier = 0;

  constructor(private readonly content: GameContent) {
    this.substats = new Substats(content.substats);
    this.rarityRank = new Map(content.rarities.order.map((id, index) => [id, index]));
  }

  get pity(): PityState {
    return { sinceTier: this.pitySinceTier };
  }

  restorePity(state: PityState): void {
    this.pitySinceTier = Math.max(0, Math.floor(state.sinceTier));
  }

  /** Weighted rarity roll, with the pity floor applied. */
  rollRarity(rng: Rng): string {
    const { tier, threshold, resetsOnTierOrBetter } = this.content.balance.loot.pity;
    const pityRank = this.rarityRank.get(tier) ?? 0;

    if (this.pitySinceTier >= threshold) {
      this.pitySinceTier = 0;
      return tier;
    }

    const rolled =
      rng.weighted(
        this.content.rarities.rarities.map((r) => ({ value: r.id, weight: r.lootWeight })),
      ) ?? this.content.rarities.order[0] ?? 'common';

    const rolledRank = this.rarityRank.get(rolled) ?? 0;
    if (resetsOnTierOrBetter && rolledRank >= pityRank) this.pitySinceTier = 0;
    else this.pitySinceTier += 1;

    return rolled;
  }

  /**
   * Generate one item.
   *
   * Order is deliberate: type, then rarity, then sockets, then substats, then set, then
   * unique effect. Each stage draws from the same stream in the same order every time, so
   * changing a later stage cannot perturb an earlier one's results for a given seed.
   */
  generate(rng: Rng, options: GenerateOptions): Item {
    const type = this.pickType(rng, options);
    const rarityId = options.rarity ?? this.rollRarity(rng);
    const rarity = this.content.raritiesById.get(rarityId);
    if (!rarity) throw new Error(`ItemGenerator: unknown rarity "${rarityId}"`);

    const itemLevel = Math.max(1, Math.floor(options.itemLevel));
    const sockets = rng.int(rarity.sockets.min, rarity.sockets.max + 1);
    const substats = this.substats.roll(rng, type.substatPool, rarity.substatCount, itemLevel);

    const setId = this.pickSet(rng, rarity, options);
    const uniqueEffectId = this.pickUniqueEffect(rng, rarity, type);

    const id: ItemId = asItemId(mintId(rng, 'itm'));

    return {
      id,
      typeId: type.id,
      name: this.nameFor(type, rarity, setId, uniqueEffectId),
      slot: type.slot,
      rarity: rarity.id,
      itemLevel,
      substats,
      socketed: new Array<null>(sockets).fill(null),
      refinement: 0,
      setId,
      uniqueEffectId,
      locked: false,
    };
  }

  /** Generate a batch, sharing one pity counter. */
  generateMany(rng: Rng, count: number, options: GenerateOptions): readonly Item[] {
    const items: Item[] = [];
    for (let i = 0; i < count; i++) items.push(this.generate(rng, options));
    return items;
  }

  private pickType(rng: Rng, options: GenerateOptions): ItemTypeDef {
    if (options.typeId) {
      const type = this.content.itemTypesById.get(options.typeId);
      if (!type) throw new Error(`ItemGenerator: unknown item type "${options.typeId}"`);
      return type;
    }

    const candidates = options.slot
      ? this.content.itemTypes.types.filter((t) => t.slot === options.slot)
      : this.content.itemTypes.types;

    const picked = rng.pick(candidates);
    if (!picked) throw new Error('ItemGenerator: no item type matches the requested slot');
    return picked;
  }

  private pickSet(
    rng: Rng,
    rarity: RarityDef,
    options: GenerateOptions,
  ): string | undefined {
    if (!rarity.canCarrySet) return undefined;

    if (options.setId) {
      if (!this.content.setsById.has(options.setId)) {
        throw new Error(`ItemGenerator: unknown set "${options.setId}"`);
      }
      return options.setId;
    }

    const chance = options.setChance ?? DEFAULT_SET_CHANCE;
    if (!rng.bool(chance)) return undefined;
    return rng.pick(this.content.sets)?.id;
  }

  private pickUniqueEffect(
    rng: Rng,
    rarity: RarityDef,
    type: ItemTypeDef,
  ): string | undefined {
    if (!rarity.canCarryUniqueEffect) return undefined;

    // A legendary in a slot with no unique effect defined gets none rather than an
    // effect belonging to a different slot — content validation guarantees at least one
    // exists overall, not one per slot.
    const candidates = this.content.uniqueEffects.filter((e) => e.slots.includes(type.slot));
    return rng.pick(candidates)?.id;
  }

  private nameFor(
    type: ItemTypeDef,
    rarity: RarityDef,
    setId: string | undefined,
    uniqueEffectId: string | undefined,
  ): string {
    // A legendary is named for its effect — that is what the player will remember it by.
    if (uniqueEffectId) {
      const unique = this.content.uniqueEffectsById.get(uniqueEffectId);
      if (unique) return `${type.name} of ${unique.name}`;
    }
    if (setId) {
      const set = this.content.setsById.get(setId);
      if (set) return `${set.name} ${type.name}`;
    }
    return `${rarity.name} ${type.name}`;
  }
}
