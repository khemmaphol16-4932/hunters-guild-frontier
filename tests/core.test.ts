/**
 * Core foundations: RNG determinism, stream splitting, clock behavior, event bus.
 * REQ-TEC-005, DL-003, risk R1.
 */

import { describe, expect, it, vi } from 'vitest';
import { createRng, createStreams, rngFromState, RNG_STREAMS } from '../src/core/rng.js';
import { SimulationClock, clampOfflineMs, MAX_OFFLINE_MS } from '../src/core/clock.js';
import { EventBus } from '../src/core/events.js';
import { asHunterId, asSkillId } from '../src/core/ids.js';

describe('rng', () => {
  it('is deterministic for the same seed', () => {
    const a = createRng('alpha');
    const b = createRng('alpha');
    const first = Array.from({ length: 50 }, () => a.next());
    const second = Array.from({ length: 50 }, () => b.next());
    expect(first).toEqual(second);
  });

  it('produces different sequences for different seeds', () => {
    const a = Array.from({ length: 20 }, () => createRng('alpha').next());
    const b = Array.from({ length: 20 }, () => createRng('beta').next());
    expect(a).not.toEqual(b);
  });

  it('stays within [0, 1)', () => {
    const rng = createRng(12345);
    for (let i = 0; i < 5000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('resumes exactly from serialised state', () => {
    // This is what lets an interrupted expedition continue on the same sequence (v2 save).
    const rng = createRng('resume');
    for (let i = 0; i < 17; i++) rng.next();
    const state = rng.state();

    const expected = Array.from({ length: 10 }, () => rng.next());
    const resumed = rngFromState(state);
    const actual = Array.from({ length: 10 }, () => resumed.next());

    expect(actual).toEqual(expected);
  });

  it('splits streams so one system cannot perturb another', () => {
    // Drawing loot must not shift the sequence recruitment sees.
    const streams = createStreams('world');
    const recruitBefore = Array.from({ length: 5 }, () => streams.recruit.next());

    const fresh = createStreams('world');
    for (let i = 0; i < 100; i++) fresh.loot.next();
    const recruitAfter = Array.from({ length: 5 }, () => fresh.recruit.next());

    expect(recruitAfter).toEqual(recruitBefore);
  });

  it('gives every named stream an independent sequence', () => {
    const streams = createStreams('world');
    const firsts = RNG_STREAMS.map((name) => streams[name].next());
    expect(new Set(firsts).size).toBe(RNG_STREAMS.length);
  });

  it('respects weighted tables', () => {
    const rng = createRng('weights');
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 10000; i++) {
      const pick = rng.weighted([
        { value: 'a' as const, weight: 70 },
        { value: 'b' as const, weight: 30 },
        { value: 'c' as const, weight: 0 },
      ]);
      if (pick) counts[pick] += 1;
    }
    expect(counts.c).toBe(0);
    expect(counts.a / 10000).toBeGreaterThan(0.65);
    expect(counts.a / 10000).toBeLessThan(0.75);
  });

  it('returns integers within range', () => {
    const rng = createRng('ints');
    for (let i = 0; i < 1000; i++) {
      const value = rng.int(3, 7);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThan(7);
    }
  });
});

describe('simulation clock', () => {
  it('runs whole fixed steps only', () => {
    const clock = new SimulationClock({ stepMs: 50 });
    const ticks: number[] = [];
    const ran = clock.advance(125, (ctx) => ticks.push(ctx.tick));

    expect(ran).toBe(2);
    expect(ticks).toEqual([1, 2]);
    // 25ms remains banked, not lost.
    expect(clock.interpolationAlpha).toBeCloseTo(0.5, 5);
  });

  it('gives gameplay a constant dt regardless of the delta fed in', () => {
    const clock = new SimulationClock({ stepMs: 50 });
    const deltas = new Set<number>();
    clock.advance(37, (ctx) => deltas.add(ctx.dt));
    clock.advance(511, (ctx) => deltas.add(ctx.dt));
    clock.advance(3, (ctx) => deltas.add(ctx.dt));
    expect([...deltas]).toEqual([0.05]);
  });

  it('produces identical step counts for the same total time, however it is fed', () => {
    // Real-time play and offline catch-up must agree (REQ-OFF-002).
    const chunked = new SimulationClock({ stepMs: 50, maxStepsPerAdvance: 100000 });
    let chunkedSteps = 0;
    for (let i = 0; i < 100; i++) chunkedSteps += chunked.advance(17, () => {});

    const single = new SimulationClock({ stepMs: 50, maxStepsPerAdvance: 100000 });
    const singleSteps = single.advance(1700, () => {});

    expect(chunkedSteps).toBe(singleSteps);
  });

  it('caps a single advance and drops the backlog instead of spiralling', () => {
    const clock = new SimulationClock({ stepMs: 50, maxStepsPerAdvance: 4 });
    const ran = clock.advance(10_000, () => {});
    expect(ran).toBe(4);
    expect(clock.dropped).toBeGreaterThan(0);
    // The next advance must not still be catching up.
    expect(clock.advance(50, () => {})).toBe(1);
  });

  it('runs an unbounded batch for offline catch-up', () => {
    const clock = new SimulationClock({ stepMs: 50, maxStepsPerAdvance: 4 });
    expect(clock.runSteps(1000, () => {})).toBe(1000);
    expect(clock.tick).toBe(1000);
  });

  it('round-trips its state', () => {
    const clock = new SimulationClock();
    clock.advance(333, () => {});
    const snapshot = clock.snapshot();

    const restored = new SimulationClock();
    restored.restore(snapshot);
    expect(restored.tick).toBe(clock.tick);
    expect(restored.interpolationAlpha).toBeCloseTo(clock.interpolationAlpha, 10);
  });

  it('clamps offline time to three days (REQ-OFF-001)', () => {
    expect(clampOfflineMs(MAX_OFFLINE_MS * 10)).toBe(MAX_OFFLINE_MS);
    expect(clampOfflineMs(-5)).toBe(0);
    expect(clampOfflineMs(1000)).toBe(1000);
  });
});

describe('event bus', () => {
  it('delivers typed payloads to subscribers', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('skill.learned', handler);

    bus.emit('skill.learned', {
      hunterId: asHunterId('h1'),
      skillId: asSkillId('mend'),
      source: 'book',
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ source: 'book' });
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const off = bus.on('hunter.respec', handler);
    off();
    bus.emit('hunter.respec', { hunterId: asHunterId('h1') });
    expect(handler).not.toHaveBeenCalled();
  });

  it('survives a handler unsubscribing during dispatch', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const offA = bus.on('hunter.respec', () => {
      seen.push('a');
      offA();
    });
    bus.on('hunter.respec', () => seen.push('b'));

    bus.emit('hunter.respec', { hunterId: asHunterId('h1') });
    expect(seen).toEqual(['a', 'b']);
  });

  it('refuses unbounded re-entrancy', () => {
    const bus = new EventBus();
    bus.on('hunter.respec', (payload) => bus.emit('hunter.respec', payload));
    expect(() => bus.emit('hunter.respec', { hunterId: asHunterId('h1') })).toThrow(
      /re-entrancy/,
    );
  });
});
