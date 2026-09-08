/**
 * Fixed-timestep simulation clock.
 *
 * DL-003 / risk R1. This is the single most load-bearing architectural decision in the
 * project. §38 wants real-time combat, §57 requires offline progression to run the same
 * combat AI, and §117 requires determinism. All three hold only if gameplay advances in
 * fixed steps rather than on frame delta:
 *
 *   - real-time play  : advance(realDeltaMs) — steps run, renderer interpolates
 *   - offline catch-up: advance(hoursOfMissedTime) with a raised step budget
 *   - balance harness : runSteps(n) with no renderer at all
 *
 * All three paths run the *same* stepper, so an offline expedition cannot silently
 * diverge from the same expedition watched live.
 *
 * No gameplay code may read wall-clock time or requestAnimationFrame delta directly;
 * tests/architecture.test.ts enforces this.
 */

export interface ClockOptions {
  /** Simulation step size. 50ms = 20 steps/second: fine enough for combat, cheap enough for 3-day catch-up. */
  readonly stepMs?: number;
  /**
   * Maximum steps a single advance() may run. Prevents a long stall (a background tab,
   * a breakpoint) from freezing the game while it catches up in one frame.
   */
  readonly maxStepsPerAdvance?: number;
}

export interface StepContext {
  /** Monotonic step index since the clock was created. */
  readonly tick: number;
  /** Step size in seconds — the only delta gameplay code should ever use. */
  readonly dt: number;
  /** Total simulated milliseconds elapsed. */
  readonly elapsedMs: number;
}

export const DEFAULT_STEP_MS = 50;
export const DEFAULT_MAX_STEPS_PER_ADVANCE = 240;

export class SimulationClock {
  readonly stepMs: number;
  readonly maxStepsPerAdvance: number;

  private currentTick = 0;
  private accumulatorMs = 0;
  /** Steps dropped because a single advance() exceeded its budget. Surfaced for diagnostics. */
  private droppedSteps = 0;

  constructor(options: ClockOptions = {}) {
    this.stepMs = options.stepMs ?? DEFAULT_STEP_MS;
    this.maxStepsPerAdvance = options.maxStepsPerAdvance ?? DEFAULT_MAX_STEPS_PER_ADVANCE;
    if (this.stepMs <= 0) throw new Error('SimulationClock: stepMs must be positive');
    if (this.maxStepsPerAdvance <= 0) {
      throw new Error('SimulationClock: maxStepsPerAdvance must be positive');
    }
  }

  get tick(): number {
    return this.currentTick;
  }

  get elapsedMs(): number {
    return this.currentTick * this.stepMs;
  }

  get elapsedSeconds(): number {
    return this.elapsedMs / 1000;
  }

  get dt(): number {
    return this.stepMs / 1000;
  }

  get dropped(): number {
    return this.droppedSteps;
  }

  /**
   * Fraction of a step accumulated but not yet run, in [0, 1).
   * The renderer uses this to interpolate between the last two simulation states so that
   * a 20Hz simulation still looks smooth at 60fps. Gameplay must never read it.
   */
  get interpolationAlpha(): number {
    return this.accumulatorMs / this.stepMs;
  }

  /**
   * Feed elapsed real (or simulated) time and run whole steps.
   * Returns the number of steps actually run.
   */
  advance(deltaMs: number, onStep: (ctx: StepContext) => void): number {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) return 0;
    this.accumulatorMs += deltaMs;

    let steps = 0;
    while (this.accumulatorMs >= this.stepMs && steps < this.maxStepsPerAdvance) {
      this.accumulatorMs -= this.stepMs;
      this.currentTick += 1;
      steps += 1;
      onStep({ tick: this.currentTick, dt: this.dt, elapsedMs: this.elapsedMs });
    }

    if (this.accumulatorMs >= this.stepMs) {
      // Budget exhausted. Discard the backlog rather than spiralling: a clock that can
      // never catch up would make every subsequent frame worse than the last.
      const backlog = Math.floor(this.accumulatorMs / this.stepMs);
      this.droppedSteps += backlog;
      this.accumulatorMs -= backlog * this.stepMs;
    }

    return steps;
  }

  /**
   * Run exactly n steps, ignoring the per-advance budget.
   * Used by offline catch-up (REQ-OFF-001) and the balance harness (REQ-TEC-009),
   * where there is no frame to keep responsive.
   */
  runSteps(n: number, onStep: (ctx: StepContext) => void): number {
    const count = Math.max(0, Math.floor(n));
    for (let i = 0; i < count; i++) {
      this.currentTick += 1;
      onStep({ tick: this.currentTick, dt: this.dt, elapsedMs: this.elapsedMs });
    }
    return count;
  }

  /** How many steps a span of real time corresponds to. */
  stepsForMs(ms: number): number {
    return Math.max(0, Math.floor(ms / this.stepMs));
  }

  /** Serialisable state, so a save resumes mid-simulation exactly where it stopped. */
  snapshot(): { tick: number; accumulatorMs: number } {
    return { tick: this.currentTick, accumulatorMs: this.accumulatorMs };
  }

  restore(state: { tick: number; accumulatorMs: number }): void {
    this.currentTick = Math.max(0, Math.floor(state.tick));
    this.accumulatorMs = Math.max(0, state.accumulatorMs);
  }
}

/** Maximum offline catch-up the design permits (REQ-OFF-001: 3 days). */
export const MAX_OFFLINE_MS = 3 * 24 * 60 * 60 * 1000;

/** Clamp a real elapsed-time span to the permitted offline window. */
export function clampOfflineMs(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return Math.min(elapsedMs, MAX_OFFLINE_MS);
}
