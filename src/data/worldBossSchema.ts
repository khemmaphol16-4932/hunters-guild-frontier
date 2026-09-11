import { ContentValidationError, expectNumber, expectObject, expectString, field } from './schema.js';

/** The world boss and where and when it walks the world (REQ-BOS-003). */
export interface WorldBossDef {
  readonly id: string;
  readonly bossId: string;
  readonly regionId: string;
  /** Coarse steps into a save before it first appears. */
  readonly firstAppearanceSteps: number;
  /** Coarse steps after a defeat before it returns. */
  readonly respawnSteps: number;
}

const FILE = 'world/worldBoss.json';

function wholeSteps(value: unknown, path: string, min: number): number {
  const n = expectNumber(value, path);
  if (!Number.isInteger(n) || n < min) throw new ContentValidationError(path, `must be a whole number of steps, at least ${min}`);
  return n;
}

export function parseWorldBoss(raw: unknown): WorldBossDef {
  const o = expectObject(raw, FILE);
  return {
    id: expectString(field(o, 'id', FILE), `${FILE}.id`),
    bossId: expectString(field(o, 'bossId', FILE), `${FILE}.bossId`),
    regionId: expectString(field(o, 'regionId', FILE), `${FILE}.regionId`),
    firstAppearanceSteps: wholeSteps(field(o, 'firstAppearanceSteps', FILE), `${FILE}.firstAppearanceSteps`, 0),
    respawnSteps: wholeSteps(field(o, 'respawnSteps', FILE), `${FILE}.respawnSteps`, 1),
  };
}
