/**
 * The baked building sprites, found at build time by Vite. `npm run art:bake` (run automatically
 * before `dev` and `build`) writes them to art/buildings/greybox/. If they are absent — a fresh
 * checkout that has not baked, or a test — the index is undefined and the scene falls back to the
 * CSS buildings, so nothing breaks.
 *
 * `?no-inline` matters: Vite would otherwise inline every sprite under 4 KB into the JavaScript as
 * base64. Measured, that doubled the bundle from 533 KB to 1,056 KB. As separate files, a sprite is
 * fetched only when a building on screen needs it.
 */

import type { BuildingArtIndex } from './sceneModel.js';

const indexes = import.meta.glob<BuildingArtIndex>('../../../art/buildings/greybox/index.json', { eager: true, import: 'default' });
const urls = import.meta.glob<string>('../../../art/buildings/greybox/*.png', { eager: true, query: '?no-inline', import: 'default' });

export const buildingArtIndex: BuildingArtIndex | undefined = Object.values(indexes)[0];

const byFile = new Map(Object.entries(urls).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]));
const images = new Map<string, HTMLImageElement>();

/** A decoded image for a sprite file, loading it on first use. `onLoad` fires once it can be drawn. */
export function spriteImage(file: string, onLoad: () => void): HTMLImageElement | undefined {
  const cached = images.get(file);
  if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : undefined;
  const url = byFile.get(file);
  if (!url) return undefined;
  const img = new Image();
  img.decoding = 'async';
  img.onload = onLoad;
  img.src = url;
  images.set(file, img);
  return undefined;
}
