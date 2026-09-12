/**
 * Where each building sprite goes in the world scene, and in what order — pure, so it is tested
 * without a browser. The canvas layer in worldView only executes this list.
 *
 * Scene space is the 1600 × 1000 world at @1x, projected in true 2:1 (DL-068): grid point (x, y)
 * lands at (740 + (x − y)·32, 300 + (x + y)·16). Sprites are authored at @2x, so each draws at half
 * size, with its pivot — the footprint centre on the ground — on the footprint's projected centre.
 */

export const TILE_HALF_W = 32;
export const TILE_HALF_H = 16;
export const SCENE_ORIGIN = { x: 740, y: 300 } as const;

export function projectTile(x: number, y: number): { x: number; y: number } {
  return { x: SCENE_ORIGIN.x + (x - y) * TILE_HALF_W, y: SCENE_ORIGIN.y + (x + y) * TILE_HALF_H };
}

/** One baked sprite, as listed in art/buildings/greybox/index.json (sizes and pivot at @2x). */
export interface BuildingSprite {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly pivot: readonly [number, number];
  readonly footprint: readonly [number, number];
}
export interface BuildingArtIndex {
  readonly buildings: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, BuildingSprite>>>>>>;
}

export interface PlacedBuilding {
  readonly instanceId: string;
  readonly buildingId: string;
  readonly tier: number;
  readonly rotation: number;
  readonly damaged: boolean;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface DrawItem {
  readonly instanceId: string;
  readonly file: string;
  /** Destination rectangle in scene @1x pixels, whole numbers so pixel art stays on the grid. */
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
  readonly damaged: boolean;
  /** Painter's order: the footprint's near corner, x + y, in grid units. */
  readonly depth: number;
}

/**
 * A string that changes exactly when the drawn town changes. The canvas redraws only when it
 * does — not on every autonomous tick, which is when the old DOM scene rebuilt itself.
 */
export function layoutKey(placed: readonly PlacedBuilding[]): string {
  return placed
    .map((p) => `${p.instanceId}:${p.buildingId}:${p.tier}:${p.rotation}:${p.damaged ? 1 : 0}:${p.rect.x},${p.rect.y},${p.rect.width},${p.rect.height}`)
    .sort()
    .join('|');
}

/**
 * The draw list for the town, back to front. A placement with no baked sprite (the bake has not
 * run, or a footprint no longer matches) is reported in `missing` so the caller can fall back.
 */
export function buildDrawList(placed: readonly PlacedBuilding[], index: BuildingArtIndex | undefined): { items: DrawItem[]; missing: string[] } {
  const items: DrawItem[] = [];
  const missing: string[] = [];
  for (const p of placed) {
    const sprite = index?.buildings[p.buildingId]?.[String(p.tier)]?.[String(p.rotation)];
    // A sprite baked for a different footprint would sit on the wrong tiles; refuse it.
    if (!sprite || sprite.footprint[0] !== p.rect.width || sprite.footprint[1] !== p.rect.height) {
      missing.push(p.instanceId);
      continue;
    }
    const centre = projectTile(p.rect.x + p.rect.width / 2, p.rect.y + p.rect.height / 2);
    items.push({
      instanceId: p.instanceId,
      file: sprite.file,
      dx: Math.round(centre.x - sprite.pivot[0] / 2),
      dy: Math.round(centre.y - sprite.pivot[1] / 2),
      dw: sprite.width / 2,
      dh: sprite.height / 2,
      damaged: p.damaged,
      depth: p.rect.x + p.rect.width + p.rect.y + p.rect.height,
    });
  }
  items.sort((a, b) => a.depth - b.depth || a.dy + a.dh - (b.dy + b.dh) || a.instanceId.localeCompare(b.instanceId));
  return { items, missing };
}
