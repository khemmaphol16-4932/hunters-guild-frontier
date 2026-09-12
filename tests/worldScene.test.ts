import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { testSession } from './helpers.js';
import { buildDrawList, layoutKey, projectTile, type BuildingArtIndex, type BuildingSprite, type PlacedBuilding } from '../src/ui/world/sceneModel.js';
import { bake } from '../art/tools/bake-buildings.mjs';
import { blank, encodePng } from '../art/tools/png.mjs';

/**
 * The world scene's layout, verified without a browser: the real founded town, the real baked
 * sprites, and the same draw list the canvas executes. Set WRITE_TOWN_PREVIEW=1 to also compose
 * the town into art/qa/town/town_preview.png for a human to look at.
 */

function foundedTown(): PlacedBuilding[] {
  const h = testSession('scene-seed');
  h.commands.foundGuild();
  const town = h.session.town;
  return town.grid.all().flatMap((p) => {
    const rect = town.grid.rectFor(p);
    return rect ? [{ instanceId: p.instanceId, buildingId: p.buildingId, tier: p.tier, rotation: p.rotation, damaged: p.damaged === true, rect }] : [];
  });
}

/** Bake just the sprites a layout needs, and index them the way art/buildings/greybox/index.json does. */
function indexFor(placed: readonly PlacedBuilding[]): { index: BuildingArtIndex; pixels: Map<string, ReturnType<typeof bake>['img']> } {
  const buildings: Record<string, Record<string, Record<string, BuildingSprite>>> = {};
  const pixels = new Map<string, ReturnType<typeof bake>['img']>();
  for (const p of placed) {
    const rot = p.rotation as 0 | 90 | 180 | 270;
    const { img, pivot, footprint } = bake(p.buildingId, String(p.tier), rot);
    const file = `bld_${p.buildingId}_t${p.tier}_r${rot}@2x.png`;
    pixels.set(file, img);
    ((buildings[p.buildingId] ??= {})[String(p.tier)] ??= {})[String(rot)] = { file, width: img.width, height: img.height, pivot, footprint };
  }
  return { index: { buildings }, pixels };
}

describe('world scene (art/specs O-9)', () => {
  const placed = foundedTown();
  const { index, pixels } = indexFor(placed);

  it('draws every building in the founded town from a baked sprite', () => {
    expect(placed.length).toBeGreaterThan(0);
    const { items, missing } = buildDrawList(placed, index);
    expect(missing).toEqual([]);
    expect(items).toHaveLength(placed.length);
  });

  it('puts each sprite\'s pivot on its footprint\'s projected centre, on whole pixels', () => {
    const { items } = buildDrawList(placed, index);
    for (const d of items) {
      const p = placed.find((x) => x.instanceId === d.instanceId)!;
      const sprite = index.buildings[p.buildingId]![String(p.tier)]![String(p.rotation)]!;
      const centre = projectTile(p.rect.x + p.rect.width / 2, p.rect.y + p.rect.height / 2);
      expect(Number.isInteger(d.dx) && Number.isInteger(d.dy)).toBe(true);
      expect(Math.abs(d.dx + sprite.pivot[0] / 2 - centre.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(d.dy + sprite.pivot[1] / 2 - centre.y)).toBeLessThanOrEqual(1);
    }
  });

  it('draws back to front', () => {
    const { items } = buildDrawList(placed, index);
    for (let i = 1; i < items.length; i++) expect(items[i]!.depth).toBeGreaterThanOrEqual(items[i - 1]!.depth);
  });

  it('refuses a sprite baked for a different footprint instead of drawing it on the wrong tiles', () => {
    const p = placed[0]!;
    const wrong = { ...p, rect: { ...p.rect, width: p.rect.width + 1 } };
    expect(buildDrawList([wrong], index).missing).toEqual([p.instanceId]);
    expect(buildDrawList(placed, undefined).missing).toHaveLength(placed.length);
  });

  it('changes its layout key exactly when the drawn town changes', () => {
    const key = layoutKey(placed);
    expect(layoutKey([...placed].reverse())).toBe(key);
    expect(layoutKey(placed.map((p, i) => (i === 0 ? { ...p, tier: p.tier + 1 } : p)))).not.toBe(key);
    expect(layoutKey(placed.map((p, i) => (i === 0 ? { ...p, damaged: !p.damaged } : p)))).not.toBe(key);
  });

  it.runIf(process.env.WRITE_TOWN_PREVIEW)('writes a composed preview of the founded town', () => {
    const { items } = buildDrawList(placed, index);
    const out = blank(1600, 1000);
    for (let i = 0; i < out.data.length; i += 4) out.data.set([0x6f, 0x7f, 0x4e, 255], i);
    for (const d of items) {
      const img = pixels.get(d.file)!;
      for (let y = 0; y < d.dh; y++) for (let x = 0; x < d.dw; x++) {
        const s = (y * 2 * img.width + x * 2) * 4;
        if (img.data[s + 3] !== 255) continue;
        const tx = d.dx + x, ty = d.dy + y;
        if (tx < 0 || ty < 0 || tx >= 1600 || ty >= 1000) continue;
        out.data.set(img.data.subarray(s, s + 4), (ty * 1600 + tx) * 4);
      }
    }
    mkdirSync('art/qa/town', { recursive: true });
    writeFileSync('art/qa/town/town_preview.png', encodePng(out));
  });
});
