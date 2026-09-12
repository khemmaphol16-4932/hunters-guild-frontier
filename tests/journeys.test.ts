import { describe, expect, it } from 'vitest';
import { testSession } from './helpers.js';
import { phaseAt, timetable } from '../src/sim/expedition/Journey.js';
import type { HunterId } from '../src/core/ids.js';

/**
 * Journeys (CONTINUOUS_WORLD_ARCHITECTURE.md §Migration step 1, DL-070): an expedition that takes
 * time in the world. The promises pinned here are the ones the migration must not break — the same
 * outcome as the instant path, nothing applied before the party is home, the party truly away
 * meanwhile, and the same return on the same step offline, live and across a reload.
 */

function founded(seed = 'journey-seed') {
  const h = testSession(seed);
  h.commands.foundGuild();
  return h;
}

const snapshotOf = (h: ReturnType<typeof founded>, ids: readonly HunterId[]) =>
  ids.map((id) => {
    const hunter = h.session.roster.get(id);
    return hunter ? { id, level: hunter.level, xp: hunter.xp, state: hunter.availability.state } : { id, gone: true };
  });

/** Step the town one step at a time until the journey is home, returning the steps taken. */
function stepUntilHome(h: ReturnType<typeof founded>): number {
  let steps = 0;
  while (h.session.journeys.all().length > 0 && steps < 500) { h.commands.passTime(1); steps++; }
  return steps;
}

describe('journeys (DL-070)', () => {
  it('resolve exactly the route the instant path resolves, from the same seeded fork', () => {
    const instant = founded();
    const walked = founded();
    const a = instant.commands.sendExpedition('verdant_reach', 'clear');
    const b = walked.commands.departExpedition('verdant_reach', 'clear');
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(b.value.result)).toBe(JSON.stringify(a.value.result));
  });

  it('apply nothing at departure, and mark the party away', () => {
    const h = founded();
    const tick = h.session.clock.tick;
    const res = h.commands.departExpedition('verdant_reach', 'clear');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const journey = res.value;
    for (const id of journey.hunterIds) {
      const hunter = h.session.roster.require(id);
      expect(hunter.availability.state).toBe('assigned');
      expect(hunter.availability.assignment).toBe(journey.id);
      expect(hunter.xp).toBe(0);
      expect(h.session.townJobs.all().some((j) => j.hunterId === id)).toBe(false);
    }
    expect(journey.departedAtTick).toBe(tick);
    const ratio = h.session.clock.coarseStepRatio;
    const expected = timetable(tick, 'blue', journey.result.reachedNode, h.session.content.journey, ratio);
    expect(journey.returnsAtTick).toBe(expected.returnsAtTick);
    expect(phaseAt(journey, tick).phase).toBe('outbound');
    expect(phaseAt(journey, journey.returnsAtTick).phase).toBe('home');
  });

  it('never send a hunter who is already away', () => {
    const h = founded();
    const first = h.commands.departExpedition('verdant_reach', 'clear');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = h.commands.departExpedition('verdant_reach', 'clear');
    if (second.ok) {
      for (const id of second.value.hunterIds) expect(first.value.hunterIds).not.toContain(id);
    } else {
      expect(second.error).toMatch(/no hunter/);
    }
  });

  it('come home on schedule and land the same consequences the instant path would', () => {
    const instant = founded();
    const walked = founded();
    const a = instant.commands.sendExpedition('verdant_reach', 'clear');
    const b = walked.commands.departExpedition('verdant_reach', 'clear');
    if (!a.ok || !b.ok) throw new Error('dispatch failed');
    const ids = b.value.hunterIds;
    const steps = stepUntilHome(walked);
    const ratio = walked.session.clock.coarseStepRatio;
    expect(steps).toBe((b.value.returnsAtTick - b.value.departedAtTick) / ratio);
    // Same experience and levels as the instant path; only *when* differs.
    const levels = (h: ReturnType<typeof founded>) => snapshotOf(h, ids).map((s) => ('gone' in s ? s : { id: s.id, level: s.level, xp: s.xp }));
    expect(levels(walked)).toEqual(levels(instant));
    for (const s of snapshotOf(walked, ids)) if (!('gone' in s)) expect(['recovering', 'injured']).toContain(s.state);
  });

  it('report the return in the Guild Report', () => {
    const h = founded();
    const res = h.commands.departExpedition('verdant_reach', 'clear');
    if (!res.ok) throw new Error(res.error);
    const report = h.commands.passTime((res.value.returnsAtTick - res.value.departedAtTick) / h.session.clock.coarseStepRatio);
    expect(report.expeditions).toHaveLength(1);
    expect(h.session.journeys.all()).toHaveLength(0);
  });

  it('come home on the same step offline as live', () => {
    const live = founded();
    const offline = founded();
    const a = live.commands.departExpedition('verdant_reach', 'clear');
    const b = offline.commands.departExpedition('verdant_reach', 'clear');
    if (!a.ok || !b.ok) throw new Error('dispatch failed');
    const steps = (a.value.returnsAtTick - a.value.departedAtTick) / live.session.clock.coarseStepRatio + 3;
    for (let i = 0; i < steps; i++) live.commands.passTime(1);
    offline.commands.passTime(steps, { offline: true });
    expect(offline.session.clock.tick).toBe(live.session.clock.tick);
    const avail = (h: ReturnType<typeof founded>) => a.value.hunterIds.map((id) => h.session.roster.get(id)?.availability);
    expect(avail(offline)).toEqual(avail(live));
  });

  it('survive a save and reload mid-journey', () => {
    const straight = founded();
    const reloaded = founded();
    const a = straight.commands.departExpedition('verdant_reach', 'clear');
    const b = reloaded.commands.departExpedition('verdant_reach', 'clear');
    if (!a.ok || !b.ok) throw new Error('dispatch failed');
    straight.commands.passTime(1);
    reloaded.commands.passTime(1);
    // Round-trip through JSON, as a real save does, into a fresh session.
    const payload = JSON.parse(JSON.stringify(reloaded.session.snapshot()));
    const fresh = testSession('journey-seed');
    fresh.session.restore(payload);
    expect(fresh.session.journeys.all()).toHaveLength(1);
    stepUntilHome(straight);
    stepUntilHome(fresh);
    expect(snapshotOf(fresh, b.value.hunterIds)).toEqual(snapshotOf(straight, a.value.hunterIds));
  });
});
