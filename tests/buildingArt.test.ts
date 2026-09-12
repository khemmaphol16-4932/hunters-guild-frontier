import { describe, expect, it } from 'vitest';
import buildingsJson from '../src/data/town/buildings.json';
import artJson from '../src/data/town/building-art.json';

/**
 * The art recipes (art/specs/04-buildings.md, O-6) must cover the game's real buildings exactly,
 * and must keep the rule that makes a modular kit readable: every building shows its category's
 * identity part, so the ten categories can be told apart from silhouettes alone.
 */

interface Feature { readonly type: string }
interface Tier {
  readonly inherits?: string;
  readonly wall?: number;
  readonly roof?: string;
  readonly walls?: string;
  readonly material?: string;
  readonly mass?: readonly number[];
  readonly features?: readonly Feature[];
  readonly add?: readonly Feature[];
}
const art = artJson as unknown as { buildings: Record<string, { tiers: Record<string, Tier> }> };
const buildings = (buildingsJson as unknown as { buildings: { id: string; category: string; tiers: { tier: number }[] }[] }).buildings;

/** Resolve `inherits` + `add` the way the bake step does. */
function resolve(tiers: Record<string, Tier>, key: string, depth = 0): Required<Omit<Tier, 'inherits' | 'add' | 'mass'>> & { mass?: readonly number[] } {
  const t = tiers[key];
  if (!t) throw new Error(`missing tier ${key}`);
  if (depth > 3) throw new Error('inheritance too deep');
  const base = t.inherits ? resolve(tiers, t.inherits, depth + 1) : { wall: 0, roof: 'none', walls: 'solid', material: 't1', features: [] as Feature[] };
  return {
    wall: t.wall ?? base.wall,
    roof: t.roof ?? base.roof,
    walls: t.walls ?? base.walls,
    material: t.material ?? base.material,
    features: [...(t.features ?? base.features), ...(t.add ?? [])],
    ...(t.mass ?? base.mass ? { mass: t.mass ?? base.mass } : {}),
  };
}

const IDENTITY: Record<string, readonly string[]> = {
  management: ['tower', 'map_table'],
  housing: ['windows_row'],
  services: ['counter', 'vent'],
  healing: ['porch'],
  revival: ['stone'],
  crafting: ['chimney'],
  economy: ['platform'],
  research: ['lantern'],
  defense: ['merlons', 'stakes'],
  recruitment: ['arch'],
};
/** Spec 04 §4: the drill yard is a yard, not a building; the well is a one-tile landmark. */
const IDENTITY_EXEMPT = new Set(['drill_yard', 'well']);
const WALL_RANGE: Record<string, readonly [number, number]> = { t1: [56, 72], t2: [80, 112], t3: [120, 160] };
const ROOFS = new Set(['gable', 'hip', 'flat', 'canvas', 'awning', 'none']);
const WALLS = new Set(['solid', 'open', 'stakes', 'none']);
const FEATURES = new Set(['flue', 'lookout', 'door', 'windows', 'windows_row', 'chimney', 'tower', 'banner', 'trophy', 'map_table', 'stilts', 'vent', 'counter', 'well', 'trough', 'porch', 'stone', 'brazier', 'forge', 'frames', 'platform', 'logs', 'stonepile', 'crates', 'lantern', 'merlons', 'stair', 'arch', 'notice', 'fence', 'posts', 'rack', 'drying_rack', 'firepit']);

describe('building art recipes (O-6)', () => {
  it('cover every building and every tier in town/buildings.json, and nothing else', () => {
    expect(Object.keys(art.buildings).sort()).toEqual(buildings.map((b) => b.id).sort());
    for (const b of buildings) {
      expect(Object.keys(art.buildings[b.id]!.tiers).sort(), b.id).toEqual(b.tiers.map((t) => String(t.tier)).sort());
    }
  });

  it('use only known roofs, wall styles and features', () => {
    for (const [id, { tiers }] of Object.entries(art.buildings)) {
      for (const key of Object.keys(tiers)) {
        const t = resolve(tiers, key);
        expect(ROOFS.has(t.roof), `${id} t${key} roof ${t.roof}`).toBe(true);
        expect(WALLS.has(t.walls), `${id} t${key} walls ${t.walls}`).toBe(true);
        for (const f of t.features) expect(FEATURES.has(f.type), `${id} t${key} feature ${f.type}`).toBe(true);
      }
    }
  });

  it('keep building bodies inside the ART_BIBLE §5.2 wall height for their material tier', () => {
    for (const [id, { tiers }] of Object.entries(art.buildings)) {
      for (const key of Object.keys(tiers)) {
        const t = resolve(tiers, key);
        if (t.walls === 'none') continue;
        const [lo, hi] = WALL_RANGE[t.material]!;
        expect(t.wall, `${id} t${key}`).toBeGreaterThanOrEqual(lo);
        expect(t.wall, `${id} t${key}`).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('reserve each identity part for its own category, so a silhouette means one thing', () => {
    const owner = new Map(Object.entries(IDENTITY).flatMap(([cat, types]) => types.map((type) => [type, cat] as const)));
    for (const b of buildings) {
      for (const key of Object.keys(art.buildings[b.id]!.tiers)) {
        for (const f of resolve(art.buildings[b.id]!.tiers, key).features) {
          const cat = owner.get(f.type);
          if (cat) expect(cat, `${b.id} t${key} uses ${f.type}, the ${cat} identity`).toBe(b.category);
        }
      }
    }
  });

  it('give every building its category identity part, so the ten categories read as silhouettes', () => {
    for (const b of buildings) {
      if (IDENTITY_EXEMPT.has(b.id)) continue;
      const allowed = IDENTITY[b.category];
      expect(allowed, `category ${b.category}`).toBeDefined();
      for (const key of Object.keys(art.buildings[b.id]!.tiers)) {
        const t = resolve(art.buildings[b.id]!.tiers, key);
        const has = t.features.some((f) => allowed!.includes(f.type)) || (b.category === 'defense' && t.walls === 'stakes');
        expect(has, `${b.id} t${key} lacks a ${b.category} identity part`).toBe(true);
      }
    }
  });
});
