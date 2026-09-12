import { describe, expect, it } from 'vitest';
import { bake, ROTATIONS } from '../art/tools/bake-buildings.mjs';
import buildingsJson from '../src/data/town/buildings.json';

const buildings = (buildingsJson as unknown as { buildings: { id: string; footprint: { width: number; height: number } }[] }).buildings;

describe('greybox building bake (art/tools/bake-buildings.mjs)', () => {
  it('is deterministic', () => {
    const a = bake('guild_hall', '3', 0).img.data;
    const b = bake('guild_hall', '3', 0).img.data;
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });

  it('draws with binary alpha and keeps the pivot on the canvas', () => {
    const { img, pivot } = bake('smithy', '2', 0);
    for (let i = 3; i < img.data.length; i += 4) expect([0, 255]).toContain(img.data[i]);
    expect(pivot[0]).toBeGreaterThan(0);
    expect(pivot[0]).toBeLessThan(img.width);
    expect(pivot[1]).toBeLessThan(img.height);
  });

  it('swaps the footprint on the quarter turns, as TownGrid does', () => {
    for (const b of buildings.filter((x) => x.footprint.width !== x.footprint.height).slice(0, 3)) {
      for (const rot of ROTATIONS) {
        const [w, h] = bake(b.id, '1', rot).footprint;
        expect([w, h], `${b.id} r${rot}`).toEqual(rot % 180 ? [b.footprint.height, b.footprint.width] : [b.footprint.width, b.footprint.height]);
      }
    }
  });
});
