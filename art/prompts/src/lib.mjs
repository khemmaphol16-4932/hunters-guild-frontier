/** Helpers shared by the prompt sources. Sources hold only what is unique to each asset. */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Read a content file from src/data, so data-driven sources cannot drift from the game. */
export const data = (path) => JSON.parse(readFileSync(join(ROOT, 'src', 'data', path), 'utf8'));

/** `moss_crawler` → `MOSS_CRAWLER` */
export const upper = (id) => id.toUpperCase();

/** Human phrase for a data id: `moss_crawler` → `moss crawler`. */
export const words = (id) => id.replace(/_/g, ' ');
