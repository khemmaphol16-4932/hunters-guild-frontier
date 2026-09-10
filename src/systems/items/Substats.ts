/**
 * Substat rolling.
 *
 * REQ-EQP-002/021 and REQ-TEC-005. Every roll comes from an injected RNG stream, so a
 * given seed always produces the same item — which is what lets a loot table be tested,
 * an offline expedition's drops be reproduced, and a balance simulation be re-run.
 *
 * Each roll records its own quality (where in its range it landed). That is the whole
 * reason two copies of the same item can be worth wildly different amounts, and it is
 * what makes a perfect item (every roll at maximum) a coherent, extremely rare goal
 * rather than a special item type.
 */

import type { SubstatData, SubstatDef } from '../../data/itemSchema.js';
import type { Rng } from '../../core/rng.js';
import type { SubstatRoll } from '../../core/items/Item.js';

export class Substats {
  constructor(private readonly data: SubstatData) {}

  pool(name: string): readonly SubstatDef[] {
    return this.data.pools[name] ?? [];
  }

  get perfectThreshold(): number {
    return this.data.perfectThreshold;
  }

  /**
   * Roll `count` distinct substats from a pool.
   *
   * Distinct matters: an item with "physical attack" twice reads as a bug even when the
   * total is identical, and it makes comparing two items harder than it needs to be.
   * If the pool is smaller than the requested count, the item simply gets fewer.
   */
  roll(rng: Rng, poolName: string, count: number, itemLevel: number, qualityFloor = 0): readonly SubstatRoll[] {
    const pool = this.pool(poolName);
    if (pool.length === 0 || count <= 0) return [];

    const remaining = [...pool];
    const rolls: SubstatRoll[] = [];

    for (let i = 0; i < count && remaining.length > 0; i++) {
      const picked = rng.weighted(remaining.map((def) => ({ value: def, weight: def.weight })));
      if (!picked) break;

      remaining.splice(remaining.indexOf(picked), 1);
      rolls.push(this.rollOne(rng, picked, itemLevel, qualityFloor));
    }

    return rolls;
  }

  private rollOne(rng: Rng, def: SubstatDef, itemLevel: number, qualityFloor: number): SubstatRoll {
    const floor = Math.max(0, Math.min(1, qualityFloor));
    const quality = floor + rng.next() * (1 - floor);
    const perLevel = def.min + (def.max - def.min) * quality;
    return {
      stat: def.stat,
      // Substat ranges are per item level, matching main stats, so a level-60 item is
      // meaningfully better than a level-10 one at the same rarity.
      value: perLevel * itemLevel,
      quality,
    };
  }

  /** Sum substats into a flat stat map, for feeding the derived-stat model. */
  static aggregate(rolls: readonly SubstatRoll[]): Readonly<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const roll of rolls) {
      out[roll.stat] = (out[roll.stat] ?? 0) + roll.value;
    }
    return out;
  }
}
