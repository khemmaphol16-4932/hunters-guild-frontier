/**
 * Hunter availability.
 *
 * v1.0 §4 fixes five canonical states — **Available, Assigned, Recovering, Injured,
 * Unavailable** — and adds that *"recalling a hunter takes transition time"* and that
 * recovery *"depends on time + food + housing/service quality + appropriate rest; it is not
 * a manual rest-click loop or a single timer."*
 *
 * Availability is deliberately separate from condition. Condition (hunger, fatigue, morale)
 * is continuous and always present; availability is discrete and answers one question the
 * party planner and the guild AI both need: *can this hunter be deployed right now, and if
 * not, when?* Collapsing them would make "exhausted but deployable" inexpressible, and that
 * distinction is exactly what the player is trading against when they push a tired roster.
 */

import { err, ok, type Result } from '../result.js';

export const AVAILABILITY_STATES = [
  'available',
  'assigned',
  'recovering',
  'injured',
  'unavailable',
] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

export interface Availability {
  readonly state: AvailabilityState;
  /** What the hunter is assigned to, when assigned. An expedition, contract, or town job. */
  readonly assignment: string | undefined;
  /**
   * Tick at which a recall completes. While set, the hunter is in transit and cannot be
   * redeployed — this is §4's "recalling a hunter takes transition time" made explicit
   * rather than instantaneous.
   */
  readonly recallCompletesAtTick: number | undefined;
  /** Tick at which recovery or injury is expected to clear, for UI and planning. */
  readonly readyAtTick: number | undefined;
}

export const FRESH_AVAILABILITY: Availability = {
  state: 'available',
  assignment: undefined,
  recallCompletesAtTick: undefined,
  readyAtTick: undefined,
};

/**
 * Legal transitions.
 *
 * Encoded rather than left to convention because an illegal transition is how a hunter ends
 * up deployed while injured — a bug that surfaces as an unfair death rather than an error.
 */
const LEGAL_TRANSITIONS: Readonly<Record<AvailabilityState, readonly AvailabilityState[]>> = {
  available: ['assigned', 'injured', 'unavailable'],
  // A hunter can finish a job, be hurt doing it, or be recalled to recover.
  assigned: ['available', 'recovering', 'injured', 'unavailable'],
  recovering: ['available', 'injured', 'unavailable'],
  // Injury heals into recovery, never straight back to deployable.
  injured: ['recovering', 'unavailable'],
  unavailable: ['available', 'recovering', 'injured'],
};

export function canTransition(from: AvailabilityState, to: AvailabilityState): boolean {
  if (from === to) return true;
  return LEGAL_TRANSITIONS[from].includes(to);
}

export function isDeployable(availability: Availability): boolean {
  return availability.state === 'available' && availability.recallCompletesAtTick === undefined;
}

export function transition(
  current: Availability,
  to: AvailabilityState,
  options: {
    readonly assignment?: string | undefined;
    readonly readyAtTick?: number | undefined;
  } = {},
): Result<Availability, string> {
  if (!canTransition(current.state, to)) {
    return err(
      `a hunter cannot go from ${current.state} to ${to}` +
        (current.state === 'injured' ? ' — injury must heal into recovery first' : ''),
    );
  }

  return ok({
    state: to,
    assignment: to === 'assigned' ? options.assignment : undefined,
    // Any state change ends a recall in progress; the hunter has arrived somewhere.
    recallCompletesAtTick: undefined,
    readyAtTick: options.readyAtTick,
  });
}

/** Begin recalling an assigned hunter. They stay assigned until the transition completes. */
export function beginRecall(
  current: Availability,
  completesAtTick: number,
): Result<Availability, string> {
  if (current.state !== 'assigned') {
    return err(`only an assigned hunter can be recalled (this one is ${current.state})`);
  }
  if (current.recallCompletesAtTick !== undefined) {
    return err('a recall is already in progress');
  }
  return ok({ ...current, recallCompletesAtTick: completesAtTick });
}

/** Complete a recall whose transition time has elapsed. */
export function completeRecall(
  current: Availability,
  currentTick: number,
  to: AvailabilityState = 'available',
): Result<Availability, string> {
  if (current.recallCompletesAtTick === undefined) return err('no recall is in progress');
  if (currentTick < current.recallCompletesAtTick) {
    return err(`the recall completes at tick ${current.recallCompletesAtTick}`);
  }
  return transition({ ...current, recallCompletesAtTick: undefined }, to);
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export interface RecoveryInputs {
  /** 0..1, where 1 is maximally fatigued. */
  readonly fatigue: number;
  /** 0..1, where 1 is starving. */
  readonly hunger: number;
  /** Housing quality multiplier. 1 is baseline; better housing recovers faster. */
  readonly housingQuality: number;
  /** Service quality multiplier (infirmary, kitchens). 1 is baseline. */
  readonly serviceQuality: number;
  /** Whether the guild can actually feed this hunter right now. */
  readonly foodAvailable: boolean;
  /** Trait multiplier, e.g. the Tireless trait. */
  readonly traitMultiplier: number;
}

export const BASELINE_RECOVERY: Omit<RecoveryInputs, 'fatigue' | 'hunger'> = {
  housingQuality: 1,
  serviceQuality: 1,
  foodAvailable: true,
  traitMultiplier: 1,
};

/**
 * Recovery rate per coarse step, as a fraction of fatigue removed.
 *
 * v1.0 §18 requires recovery to *vary measurably* with time, food, housing and services, so
 * every one of those is a real multiplicative term here rather than decoration. A hunter with
 * no food recovers, but badly — starvation should slow recovery, not freeze it, or a food
 * shortage becomes an unrecoverable spiral rather than a pressure the player can trade against.
 */
export function recoveryRatePerStep(
  inputs: RecoveryInputs,
  baseRatePerStep: number,
): number {
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

  const housing = Math.max(0.1, inputs.housingQuality);
  const services = Math.max(0.1, inputs.serviceQuality);
  const food = inputs.foodAvailable ? 1 : 0.35;
  // Being hungry slows recovery even when food is nominally available.
  const hungerPenalty = 1 - clamp01(inputs.hunger) * 0.4;
  const traits = Math.max(0.1, inputs.traitMultiplier);

  return baseRatePerStep * housing * services * food * hungerPenalty * traits;
}

/**
 * Coarse steps until a hunter is rested, given current conditions.
 * Returns Infinity when the rate is non-positive, so callers surface "never at this rate"
 * rather than silently reporting zero.
 */
export function stepsUntilRested(
  inputs: RecoveryInputs,
  baseRatePerStep: number,
): number {
  const rate = recoveryRatePerStep(inputs, baseRatePerStep);
  if (rate <= 0) return Infinity;
  return Math.ceil(Math.max(0, inputs.fatigue) / rate);
}

/** Player-readable state, for the roster and the party planner. */
export function describeAvailability(availability: Availability): string {
  if (availability.recallCompletesAtTick !== undefined) return 'Returning to the guild';

  switch (availability.state) {
    case 'available':
      return 'Ready';
    case 'assigned':
      return availability.assignment ? `Assigned — ${availability.assignment}` : 'Assigned';
    case 'recovering':
      return 'Recovering';
    case 'injured':
      return 'Injured';
    case 'unavailable':
      return 'Unavailable';
  }
}
