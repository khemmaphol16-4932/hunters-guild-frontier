/**
 * The live calendar's arithmetic: how much town time a real-time interval is worth.
 *
 * The composition root reads the wall clock and passes it in (DL-003 — nothing below
 * `main.ts` reads it), so this is pure and testable. It measures real elapsed time rather
 * than counting timer fires. Counting fires was the old bug: browsers throttle a hidden
 * tab's timers to once a second or slower, so a clock that added a fixed 250 ms per fire ran
 * the town four times slow, or worse, whenever the player looked away.
 */

import type { TimeBalance } from '../data/timeSchema.js';

export type LiveTick =
  /** Nothing to do yet: less than one step of time has accrued. */
  | { readonly kind: 'wait' }
  /** Advance the town by this many steps at the chosen speed. */
  | { readonly kind: 'live'; readonly steps: number }
  /**
   * The gap was long enough to be an absence — the tab was frozen or the machine slept.
   * Catch it up as offline time (REQ-OFF-001), with a Guild Report, exactly as a reload would.
   */
  | { readonly kind: 'absence'; readonly elapsedMs: number };

export class LiveClock {
  private last: number;
  /** Speed-scaled milliseconds accrued toward the next step. */
  private carry = 0;

  constructor(now: number, private readonly time: TimeBalance) {
    this.last = now;
  }

  tick(now: number, speed: number): LiveTick {
    // A wall clock can step backwards (manual change, NTP). Treat that as no time passing.
    const gap = Math.max(0, now - this.last);
    this.last = now;
    const stepMs = this.time.realSecondsPerStep * 1000;

    // Absence is measured in real time, before speed: the player was not watching, so the
    // speed they chose for watching does not apply. Offline catch-up runs at 1× for the same
    // reason. Any partial step already accrued is dropped with it.
    if (gap >= stepMs * this.time.absenceSteps) {
      this.carry = 0;
      return { kind: 'absence', elapsedMs: gap };
    }

    this.carry += gap * speed;
    if (this.carry < stepMs) return { kind: 'wait' };
    const steps = Math.floor(this.carry / stepMs);
    this.carry -= steps * stepMs;
    return { kind: 'live', steps };
  }
}
