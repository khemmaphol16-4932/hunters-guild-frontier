import { describe, expect, it } from 'vitest';
import { testSession } from './helpers.js';
import { phaseAt, timetable } from '../src/sim/expedition/Journey.js';
import type { HunterId } from '../src/core/ids.js';
import { describeAway, describeParty } from '../src/ui/fieldParty.js';

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
    const expected = timetable(tick, 'blue', journey.result.nodesEntered, h.session.content.journey, ratio);
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

  it('leave the combat facts out of the save, keeping the consequences exact', () => {
    const h = founded();
    const res = h.commands.departExpedition('verdant_reach', 'clear');
    if (!res.ok) throw new Error(res.error);
    // The live record still carries a fight's facts for a same-session replay...
    expect(res.value.result.nodes.some((n) => n.facts !== undefined || n.highlights.length > 0)).toBe(true);
    // ...but the saved copy carries none of the presentation-only replay data.
    const snap = h.session.snapshot();
    const saved = JSON.parse(JSON.stringify(snap)) as typeof snap;
    const savedNodes = saved.journeys.active[0]!.result.nodes;
    for (const n of savedNodes) {
      expect(n.facts).toBeUndefined();
      expect(n.story).toBeUndefined();
      expect(n.highlights).toEqual([]);
    }

    // A journey reloaded from that slimmed save lands the same consequences as one never saved.
    const straight = founded();
    const b = straight.commands.departExpedition('verdant_reach', 'clear');
    if (!b.ok) throw new Error(b.error);
    const fresh = testSession('journey-seed');
    fresh.session.restore(saved);
    stepUntilHome(straight);
    stepUntilHome(fresh);
    expect(snapshotOf(fresh, res.value.hunterIds)).toEqual(snapshotOf(straight, b.value.hunterIds));
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

describe('recalling a journey (REQ-CW-010, DL-071)', () => {
  /** Depart and walk until the party is working its first node, with more ahead of it. */
  function atFirstNode(seed = 'journey-seed') {
    const h = founded(seed);
    const res = h.commands.departExpedition('verdant_reach', 'clear');
    if (!res.ok) throw new Error(res.error);
    const journey = res.value;
    const ratio = h.session.clock.coarseStepRatio;
    h.commands.passTime((journey.arrivesAtTick - journey.departedAtTick) / ratio);
    return { h, journey };
  }

  it('keep every node already worked exactly as it was, and give up only the rest', () => {
    const { h, journey } = atFirstNode();
    expect(journey.result.nodesEntered).toBeGreaterThan(1);
    expect(phaseAt(journey, h.session.clock.tick)).toEqual({ phase: 'working', node: 1 });
    const res = h.commands.recallJourney(journey.id);
    if (!res.ok) throw new Error(res.error);
    const recalled = res.value;
    expect(recalled.result.nodesEntered).toBe(1);
    expect(JSON.stringify(recalled.result.nodes[0])).toBe(JSON.stringify(journey.result.nodes[0]));
    expect(recalled.result.retreated).toBe(true);
    expect(recalled.result.decisions.at(-1)?.reasonCodes).toContain('order:recalled');
    expect(recalled.returnsAtTick).toBeLessThan(journey.returnsAtTick);
    for (const id of recalled.hunterIds) expect(h.session.roster.require(id).availability.readyAtTick).toBe(recalled.returnsAtTick);
  });

  it('bring home a party still walking out, over the ground it covered, with nothing gained', () => {
    const h = founded();
    const res = h.commands.departExpedition('verdant_reach', 'clear');
    if (!res.ok) throw new Error(res.error);
    const recalled = h.commands.recallJourney(res.value.id);
    if (!recalled.ok) throw new Error(recalled.error);
    expect(recalled.value.result.nodesEntered).toBe(0);
    expect(recalled.value.returnsAtTick).toBe(h.session.clock.tick);
    h.commands.passTime(1);
    expect(h.session.journeys.all()).toHaveLength(0);
    for (const id of res.value.hunterIds) expect(h.session.roster.require(id).xp).toBe(0);
  });

  it('refuse a recall that changes nothing', () => {
    const { h, journey } = atFirstNode();
    const ratio = h.session.clock.coarseStepRatio;
    h.commands.passTime((journey.turnsHomeAtTick - h.session.clock.tick) / ratio);
    expect(h.commands.recallJourney(journey.id).ok).toBe(false);
    expect(h.commands.recallJourney('journey-999').ok).toBe(false);
  });

  it('land the same on return offline as live', () => {
    const live = atFirstNode();
    const offline = atFirstNode();
    const a = live.h.commands.recallJourney(live.journey.id);
    const b = offline.h.commands.recallJourney(offline.journey.id);
    if (!a.ok || !b.ok) throw new Error('recall failed');
    const steps = (a.value.returnsAtTick - live.h.session.clock.tick) / live.h.session.clock.coarseStepRatio + 2;
    for (let i = 0; i < steps; i++) live.h.commands.passTime(1);
    offline.h.commands.passTime(steps, { offline: true });
    expect(snapshotOf(offline.h, b.value.hunterIds)).toEqual(snapshotOf(live.h, a.value.hunterIds));
  });

  it('keep an away hunter out of reach of the armoury and the Mentor Hall', () => {
    const { h, journey } = atFirstNode();
    const id = journey.hunterIds[0]!;
    for (const res of [h.commands.unequipSlot(id, 'weapon'), h.commands.respec(id), h.commands.retireHunter(id)]) {
      expect(res.ok).toBe(false);
    }
    const away = h.commands.unequipSlot(id, 'weapon');
    if (!away.ok) expect(away.error).toMatch(/away on an expedition/);
  });
});

describe('parties in the field, as the player sees them (DL-071)', () => {
  it('follow a party out, through its stops, and home', () => {
    const h = founded();
    const res = h.commands.departExpedition('verdant_reach', 'clear');
    if (!res.ok) throw new Error(res.error);
    const seen: string[] = [];
    for (let guard = 0; h.commands.partiesInField().length > 0 && guard < 50; guard++) {
      const [party] = h.commands.partiesInField();
      if (!party) break;
      expect(party.hunterIds).toEqual(res.value.hunterIds);
      expect(h.commands.partyOf(party.hunterIds[0]!)?.journeyId).toBe(res.value.id);
      seen.push(`${party.phase}:${party.node}:${party.stepsUntilHome}:${party.recallBlockedBy ? 'no' : 'yes'}`);
      h.commands.passTime(1);
    }
    const n = res.value.result.nodesEntered;
    // Out, one line per stop, then home: steps to home count down by one each step, and the
    // recall is offered until the party is at its last stop.
    expect(seen[0]).toBe(`outbound:0:${n + 2}:yes`);
    expect(seen.at(-1)).toBe('inbound:' + n + ':1:no');
    expect(seen.map((line) => Number(line.split(':')[2]))).toEqual(Array.from({ length: n + 2 }, (_, i) => n + 2 - i));
    expect(seen.filter((line) => line.startsWith('working:')).map((line) => line.split(':')[1])).toEqual(Array.from({ length: n }, (_, i) => String(i + 1)));
    expect(h.commands.partyOf(res.value.hunterIds[0]!)).toBeUndefined();
  });

  it('keep the return for the route replay and announce it', () => {
    const h = founded();
    expect(h.commands.latestReturn()).toBeUndefined();
    const res = h.commands.departExpedition('verdant_reach', 'clear');
    if (!res.ok) throw new Error(res.error);
    stepUntilHome(h);
    expect(JSON.stringify(h.commands.latestReturn()?.result.nodes)).toBe(JSON.stringify(res.value.result.nodes));
    const notice = h.session.notifications.all().find((n) => n.kind === 'partyReturned');
    expect(notice?.text).toBe('The party is home from The Verdant Reach.');
  });

  it('read in plain words', () => {
    const base = { journeyId: 'journey-1', regionName: 'Verdant Reach', hunterIds: [], hunterNames: [], node: 2, nodes: 4, stepsUntilHome: 3, recalled: false } as const;
    expect(describeParty({ ...base, phase: 'working' })).toBe('At stop 2 of 4 in Verdant Reach · home in 3 steps');
    expect(describeParty({ ...base, phase: 'inbound', recalled: true, stepsUntilHome: 1 })).toBe('Recalled — heading home from Verdant Reach · home in 1 step');
    expect(describeParty({ ...base, phase: 'outbound' })).toBe('Walking out to Verdant Reach · home in 3 steps');
    expect(describeAway({ ...base, phase: 'working' })).toBe('Verdant Reach · stop 2/4');
  });
});
