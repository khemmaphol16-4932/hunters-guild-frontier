import { describe, expect, it } from 'vitest';
import { LiveClock, type LiveTick } from '../src/app/LiveClock.js';
import { parseTime, type TimeBalance } from '../src/data/timeSchema.js';

const TIME: TimeBalance = { realSecondsPerStep: 30, maxOfflineHours: 72, catchUpChunkSteps: 10, absenceSteps: 10 };
const STEP = 30_000;

/** Fire the clock every `everyMs` for `forMs` of real time and total the live steps. */
function run(clock: LiveClock, start: number, everyMs: number, forMs: number, speed = 1): { steps: number; ticks: LiveTick[] } {
  const ticks: LiveTick[] = [];
  let steps = 0;
  for (let t = start + everyMs; t <= start + forMs; t += everyMs) {
    const tick = clock.tick(t, speed);
    ticks.push(tick);
    if (tick.kind === 'live') steps += tick.steps;
  }
  return { steps, ticks };
}

describe('live clock (REQ-OFF-001, REQ-TEC-004)', () => {
  it('advances one step per realSecondsPerStep at 1x', () => {
    expect(run(new LiveClock(0, TIME), 0, 250, 10 * STEP).steps).toBe(10);
  });

  it('keeps real time when a hidden tab throttles its timers', () => {
    // The regression: counting fires at a fixed 250 ms ran the town 4x slow when the browser
    // slowed timers to once a second, and 240x slow at once a minute.
    expect(run(new LiveClock(0, TIME), 0, 1_000, 10 * STEP).steps).toBe(10);
    expect(run(new LiveClock(0, TIME), 0, 60_000, 10 * STEP).steps).toBe(10);
  });

  it('scales live time by the chosen speed', () => {
    expect(run(new LiveClock(0, TIME), 0, 250, 10 * STEP, 2).steps).toBe(20);
    expect(run(new LiveClock(0, TIME), 0, 250, 10 * STEP, 4).steps).toBe(40);
  });

  it('carries partial steps across ticks instead of dropping them', () => {
    const clock = new LiveClock(0, TIME);
    expect(clock.tick(20_000, 1).kind).toBe('wait');
    expect(clock.tick(40_000, 1)).toEqual({ kind: 'live', steps: 1 });
    expect(clock.tick(60_000, 1)).toEqual({ kind: 'live', steps: 1 });
  });

  it('treats a gap of absenceSteps or more as an absence, at real time rather than speed', () => {
    const clock = new LiveClock(0, TIME);
    expect(clock.tick(10 * STEP, 4)).toEqual({ kind: 'absence', elapsedMs: 10 * STEP });
    // Just under the threshold is still a live (throttled) tick, and speed applies to it.
    const near = new LiveClock(0, TIME);
    expect(near.tick(10 * STEP - 1, 1)).toEqual({ kind: 'live', steps: 9 });
  });

  it('drops a partial step when an absence is caught up', () => {
    const clock = new LiveClock(0, TIME);
    clock.tick(20_000, 1);
    clock.tick(20_000 + 10 * STEP, 1);
    expect(clock.tick(20_000 + 10 * STEP + 20_000, 1).kind).toBe('wait');
  });

  it('ignores a wall clock that steps backwards', () => {
    const clock = new LiveClock(100_000, TIME);
    expect(clock.tick(50_000, 1).kind).toBe('wait');
    expect(clock.tick(50_000 + STEP, 1)).toEqual({ kind: 'live', steps: 1 });
  });
});

describe('time content (balance/time.json)', () => {
  const base = { realSecondsPerStep: 30, maxOfflineHours: 72, catchUpChunkSteps: 10, absenceSteps: 10 };

  it('reads absenceSteps', () => {
    expect(parseTime(base).absenceSteps).toBe(10);
  });

  it('rejects a missing, fractional or non-positive absenceSteps', () => {
    const { absenceSteps: _omit, ...missing } = base;
    expect(() => parseTime(missing)).toThrow();
    expect(() => parseTime({ ...base, absenceSteps: 2.5 })).toThrow(/whole number/);
    expect(() => parseTime({ ...base, absenceSteps: 0 })).toThrow(/positive/);
  });
});
