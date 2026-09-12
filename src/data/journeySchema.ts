import { ContentValidationError, expectNumber, expectObject, field } from './schema.js';
import type { ZoneTier } from './combatSchema.js';

/** How long an expedition takes in the world, in simulation steps (DL-070). */
export interface JourneyBalance {
  /** Steps spent at each node of the route. */
  readonly stepsPerNode: number;
  /** Steps of travel each way, by the region's zone tier. */
  readonly travelSteps: Readonly<Record<ZoneTier, number>>;
}

const FILE = 'balance/journey.json';
const ZONES: readonly ZoneTier[] = ['blue', 'yellow', 'red', 'black'];

function wholeSteps(value: unknown, path: string, allowZero: boolean): number {
  const n = expectNumber(value, path);
  if (!Number.isInteger(n) || n < (allowZero ? 0 : 1)) {
    throw new ContentValidationError(path, allowZero ? 'must be a whole number of steps, zero or more' : 'must be a whole number of steps, at least one');
  }
  return n;
}

export function parseJourney(raw: unknown): JourneyBalance {
  const o = expectObject(raw, FILE);
  const travel = expectObject(field(o, 'travelSteps', FILE), `${FILE}.travelSteps`);
  const travelSteps = Object.fromEntries(
    ZONES.map((zone) => [zone, wholeSteps(field(travel, zone, `${FILE}.travelSteps`), `${FILE}.travelSteps.${zone}`, true)]),
  ) as Record<ZoneTier, number>;
  return { stepsPerNode: wholeSteps(field(o, 'stepsPerNode', FILE), `${FILE}.stepsPerNode`, false), travelSteps };
}
