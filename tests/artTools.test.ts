import { describe, expect, it } from 'vitest';
import { blank, decodePng, encodePng, type Rgba } from '../art/tools/png.mjs';
import { bbox, downsample, halve, place, quantize, removeDarkMatte, validate } from '../art/tools/sprite.mjs';

/** A w × h image filled by f(x, y) → [r, g, b, a]. */
function paint(w: number, h: number, f: (x: number, y: number) => readonly number[]): Rgba {
  const img = blank(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data.set(f(x, y), (y * w + x) * 4);
  return img;
}
const alphas = (img: Rgba): Set<number> => new Set(Array.from({ length: img.width * img.height }, (_, i) => img.data[i * 4 + 3]!));

describe('art tools: PNG codec', () => {
  it('round-trips RGBA exactly and deterministically', () => {
    const img = paint(7, 5, (x, y) => [x * 30, y * 50, (x + y) * 10, x === 0 ? 0 : 200]);
    const bytes = encodePng(img);
    expect(Buffer.compare(bytes, encodePng(img))).toBe(0);
    const back = decodePng(bytes);
    expect([back.width, back.height]).toEqual([7, 5]);
    expect(Array.from(back.data)).toEqual(Array.from(img.data));
  });

  it('rejects what it cannot read rather than guessing', () => {
    expect(() => decodePng(Buffer.from('not a png'))).toThrow(/not a PNG/);
  });
});

describe('art tools: sprite export (ART_BIBLE §13)', () => {
  // A soft-edged, never fully opaque blob — the shape generated source art arrives in.
  const source = paint(64, 64, (x, y) => {
    const d = Math.hypot(x - 32, y - 32);
    return d < 20 ? [140, 90, 60, 230] : d < 23 ? [140, 90, 60, 90] : [0, 0, 0, 0];
  });

  it('downsampling snaps alpha to 0 or 255', () => {
    const out = downsample(source, bbox(source)!, 12, 12);
    expect([...alphas(out)].every((a) => a === 0 || a === 255)).toBe(true);
    expect(alphas(out).has(255)).toBe(true);
  });

  it('quantization never exceeds the colour cap', () => {
    const noisy = paint(20, 20, (x, y) => [x * 12, y * 12, (x * y) % 255, 255]);
    const { img, palette } = quantize(noisy, 16);
    const colours = new Set<string>();
    for (let i = 0; i < img.data.length; i += 4) colours.add(`${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`);
    expect(colours.size).toBeLessThanOrEqual(16);
    expect(palette.length).toBeLessThanOrEqual(16);
  });

  it('removes a dark matte connected to the outside but keeps enclosed dark detail', () => {
    // bright ring with a dark centre, surrounded by a dark halo, on transparency
    const img = paint(21, 21, (x, y) => {
      const d = Math.hypot(x - 10, y - 10);
      if (d < 2) return [20, 20, 20, 255]; // enclosed dark detail
      if (d < 6) return [200, 180, 120, 255]; // bright subject
      if (d < 9) return [15, 25, 15, 240]; // baked-in halo
      return [0, 0, 0, 0];
    });
    const { img: out, cleared } = removeDarkMatte(img, 40);
    expect(cleared).toBeGreaterThan(0);
    expect(out.data[(10 * 21 + 10) * 4 + 3]).toBe(255); // centre survives
    expect(out.data[(10 * 21 + 18) * 4 + 3]).toBe(0); // halo gone
  });

  it('places the subject on the pivot and passes the machine checks', () => {
    const subject = downsample(source, bbox(source)!, 20, 20);
    const sprite = place(quantize(subject, 24).img, 64, 48, [32, 44]);
    const box = bbox(sprite)!;
    expect(box.y + box.h - 1).toBe(44);
    const result = validate(sprite, { canvas: [64, 48], pivot: [32, 44], category: '05', halfImg: halve(sprite) });
    expect(result.checks.filter((c) => !c.pass)).toEqual([]);
  });

  it('flags semi-transparency, pure black and functional hues', () => {
    const bad = paint(8, 8, (x) => (x < 2 ? [0, 0, 0, 255] : x < 4 ? [91, 141, 214, 255] : x < 6 ? [100, 100, 100, 128] : [0, 0, 0, 0]));
    const failed = validate(bad, { category: '05' }).checks.filter((c) => !c.pass).map((c) => c.name);
    expect(failed).toEqual(expect.arrayContaining(['binary alpha', 'no pure black or white', 'no functional hue']));
  });
});
