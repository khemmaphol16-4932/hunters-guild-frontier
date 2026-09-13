import { describe, expect, it } from 'vitest';
import { testSession } from './helpers.js';
import { arrivalTick, phaseAt } from '../src/sim/expedition/Journey.js';
import type { JourneyRecord } from '../src/sim/expedition/Journey.js';
import type { HunterId } from '../src/core/ids.js';
import { describeAway, describeParty } from '../src/ui/fieldParty.js';

/**
 * Journeys (CONTINUOUS_WORLD_ARCHITECTURE.md §Migration, DL-070, DL-074): an expedition that takes
 * time in the world and resolves a stop at a time on the tick. The promises pinned here are the
 * ones the migration must not break — a journey whose guild does not change while it is out lands
 * the same outcome as the instant path, nothing is applied before the party is home, the party is
 * truly away meanwhile, the return time is emergent, and the same return lands on the same step
 * offline, live and across a reload.
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

/** The finished result of an in-flight journey, from its live run. */
function resultOf(h: ReturnType<typeof founded>, journey: JourneyRecord) {
  return h.commands.finalizedResult(journey);
}

describe('journeys (DL-070, DL-074)', () => {
  it('resolve the same route the instant path resolves, when the guild does not change', () => {
    const instant = founded();
    const walked = founded();
    const a = instant.commands.sendExpedition('verdant_reach', 'clear');
    const b = walked.commands.departExpedition('verdant_reach', 'clear');
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // The journey resolves stop by stop as town time passes; its finished result matches the
    // instant one because an away party's hunters are frozen while it is out.
    stepUntilHome(walked);
    expect(JSON.stringify(walked.commands.latestReturn()?.result)).toBe(JSON.stringify(a.value.result));
  });

  it('apply nothing at departure, mark the party away, and leave the return unknown', () => {
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
      // Not known yet — the party has not turned for home (DL-074).
      expect(hunter.availability.readyAtTick).toBeUndefined();
      expect(hunter.xp).toBe(0);
      expect(h.session.townJobs.all().some((j) => j.hunterId === id)).toBe(false);
    }
    expect(journey.departedAtTick).toBe(tick);
    expect(journey.arrivesAtTick).toBe(arrivalTick(tick, 'blue', h.session.content.journey, h.session.clock.coarseStepRatio));
    expect(journey.returnsAtTick).toBeUndefined();
    expect(phaseAt(journey, tick).phase).toBe('outbound');
    stepUntilHome(h);
    expect(h.session.journeys.all()).toHaveLength(0);
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

  it('come home and land the same consequences the instant path would', () => {
    const instant = founded();
    const walked = founded();
    const a = instant.commands.sendExpedition('verdant_reach', 'clear');
    const b = walked.commands.departExpedition('verdant_reach', 'clear');
    if (!a.ok || !b.ok) throw new Error('dispatch failed');
    const ids = b.value.hunterIds;
    stepUntilHome(walked);
    // Same experience and levels as the instant path; only *when* differs.
    const levels = (h: ReturnType<typeof founded>) => snapshotOf(h, ids).map((s) => ('gone' in s ? s : { id: s.id, level: s.level, xp: s.xp }));
    expect(levels(walked)).toEqual(levels(instant));
    for (const s of snapshotOf(walked, ids)) if (!('gone' in s)) expect(['recovering', 'injured']).toContain(s.state);
  });

  it('report the return in the Guild Report', () => {
    const h = founded();
    const res = h.commands.departExpedition('verdant_reach', 'clear');
    if (!res.ok) throw new Error(res.error);
    // Enough steps for a Blue run (out, its stops, back) to finish inside one report.
    const report = h.commands.passTime(50);
    expect(report.expeditions).toHaveLength(1);
    expect(h.session.journeys.all()).toHaveLength(0);
  });

  it('come home on the same step offline as live', () => {
    const live = founded();
    const offline = founded();
    const a = live.commands.departExpedition('verdant_reach', 'clear');
    const b = offline.commands.departExpedition('verdant_reach', 'clear');
    if (!a.ok || !b.ok) throw new Error('dispatch failed');
    const steps = 50;
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
    // Resolve a stop or two so the run carries a fight's facts.
    h.commands.passTime(2);
    const live = h.session.journeys.all()[0];
    expect(live?.run?.reports.some((n) => n.facts !== undefined || n.highlights.length > 0)).toBe(true);
    // The saved copy carries none of the presentation-only replay data.
    const snap = h.session.snapshot();
    const saved = JSON.parse(JSON.stringify(snap)) as typeof snap;
    for (const n of saved.journeys.active[0]!.run!.reports) {
      expect(n.facts).toBeUndefined();
      expect(n.story).toBeUndefined();
      expect(n.highlights).toEqual([]);
    }
    // A journey reloaded from that slimmed save lands the same consequences as one never saved.
    const straight = founded();
    const b = straight.commands.departExpedition('verdant_reach', 'clear');
    if (!b.ok) throw new Error(b.error);
    straight.commands.passTime(2);
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
    straight.commands.passTime(2);
    reloaded.commands.passTime(2);
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

describe('recalling a journey (REQ-CW-010, DL-071, DL-074)', () => {
  /** Depart and walk until the party is working its first stop, with more ahead of it. */
  function atFirstNode(seed = 'journey-seed') {
    const h = founded(seed);
    const res = h.commands.departExpedition('verdant_reach', 'clear');
    if (!res.ok) throw new Error(res.error);
    const journey = res.value;
    const ratio = h.session.clock.coarseStepRatio;
    h.commands.passTime((journey.arrivesAtTick - journey.departedAtTick) / ratio);
    return { h, journey: h.session.journeys.get(journey.id)! };
  }

  it('keep every stop already worked exactly as it was, and give up only the rest', () => {
    // A full instant run of the same seed, for the byte-for-byte comparison of the first stop.
    const full = founded().commands.sendExpedition('verdant_reach', 'clear');
    if (!full.ok) throw new Error(full.error);
    expect(full.value.result.nodesEntered).toBeGreaterThan(1);

    const { h, journey } = atFirstNode();
    expect(phaseAt(journey, h.session.clock.tick)).toEqual({ phase: 'working', node: 1 });
    const res = h.commands.recallJourney(journey.id);
    if (!res.ok) throw new Error(res.error);
    const recalled = res.value;
    const result = resultOf(h, recalled);
    expect(result.nodesEntered).toBe(1);
    expect(JSON.stringify(result.nodes[0])).toBe(JSON.stringify(full.value.result.nodes[0]));
    expect(result.retreated).toBe(true);
    expect(result.decisions.at(-1)?.reasonCodes).toContain('order:recalled');
    for (const id of recalled.hunterIds) expect(h.session.roster.require(id).availability.readyAtTick).toBe(recalled.returnsAtTick);
  });

  it('bring home a party still walking out, over the ground it covered, with nothing gained', () => {
    const h = founded();
    const res = h.commands.departExpedition('verdant_reach', 'clear');
    if (!res.ok) throw new Error(res.error);
    const recalled = h.commands.recallJourney(res.value.id);
    if (!recalled.ok) throw new Error(recalled.error);
    expect(resultOf(h, recalled.value).nodesEntered).toBe(0);
    expect(recalled.value.returnsAtTick).toBe(h.session.clock.tick);
    h.commands.passTime(1);
    expect(h.session.journeys.all()).toHaveLength(0);
    for (const id of res.value.hunterIds) expect(h.session.roster.require(id).xp).toBe(0);
  });

  it('refuse a recall once the party has already turned for home', () => {
    const { h, journey } = atFirstNode();
    const first = h.commands.recallJourney(journey.id);
    expect(first.ok).toBe(true);
    // Now on its way home: a second recall changes nothing.
    expect(h.commands.recallJourney(journey.id).ok).toBe(false);
    expect(h.commands.recallJourney('journey-999').ok).toBe(false);
  });

  it('land the same on return offline as live', () => {
    const live = atFirstNode();
    const offline = atFirstNode();
    const a = live.h.commands.recallJourney(live.journey.id);
    const b = offline.h.commands.recallJourney(offline.journey.id);
    if (!a.ok || !b.ok) throw new Error('recall failed');
    const steps = 20;
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

describe('parties in the field, as the player sees them (DL-074)', () => {
  it('follow a party out, count its stops up, then count down once it turns home', () => {
    const h = founded();
    const res = h.commands.departExpedition('verdant_reach', 'clear');
    if (!res.ok) throw new Error(res.error);
    const seen: { phase: string; node: number; turnedHome: boolean; recall: boolean }[] = [];
    for (let guard = 0; h.commands.partiesInField().length > 0 && guard < 60; guard++) {
      const [party] = h.commands.partiesInField();
      if (!party) break;
      expect(party.hunterIds).toEqual(res.value.hunterIds);
      expect(h.commands.partyOf(party.hunterIds[0]!)?.journeyId).toBe(res.value.id);
      seen.push({ phase: party.phase, node: party.node, turnedHome: party.turnedHome, recall: party.recallBlockedBy === undefined });
      h.commands.passTime(1);
    }
    // Walks out first, working stops count up from 1, and a recall is offered until it turns home.
    expect(seen[0]).toEqual({ phase: 'outbound', node: 0, turnedHome: false, recall: true });
    const working = seen.filter((s) => s.phase === 'working');
    expect(working.map((s) => s.node)).toEqual(working.map((_, i) => i + 1));
    for (const s of working) {
      expect(s.turnedHome).toBe(false);
      expect(s.recall).toBe(true);
    }
    // Once heading home the recall is gone and the countdown has begun.
    const inbound = seen.filter((s) => s.phase === 'inbound');
    expect(inbound.length).toBeGreaterThan(0);
    for (const s of inbound) {
      expect(s.turnedHome).toBe(true);
      expect(s.recall).toBe(false);
    }
    expect(h.commands.partyOf(res.value.hunterIds[0]!)).toBeUndefined();
  });

  it('keep the return for the route replay and announce it', () => {
    const instant = founded();
    const h = founded();
    const full = instant.commands.sendExpedition('verdant_reach', 'clear');
    expect(h.commands.latestReturn()).toBeUndefined();
    const res = h.commands.departExpedition('verdant_reach', 'clear');
    if (!res.ok || !full.ok) throw new Error('dispatch failed');
    stepUntilHome(h);
    expect(JSON.stringify(h.commands.latestReturn()?.result.nodes)).toBe(JSON.stringify(full.value.result.nodes));
    const notice = h.session.notifications.all().find((n) => n.kind === 'partyReturned');
    expect(notice?.text).toBe('The party is home from The Verdant Reach.');
  });

  it('read in plain words', () => {
    const base = { journeyId: 'journey-1', regionName: 'Verdant Reach', hunterIds: [], hunterNames: [], node: 2, recalled: false } as const;
    expect(describeParty({ ...base, phase: 'working', turnedHome: false })).toBe('At stop 2 in Verdant Reach · still out');
    expect(describeParty({ ...base, phase: 'inbound', turnedHome: true, recalled: true, stepsUntilHome: 1 })).toBe('Recalled — heading home from Verdant Reach · home in 1 step');
    expect(describeParty({ ...base, phase: 'outbound', turnedHome: false })).toBe('Walking out to Verdant Reach · still out');
    expect(describeAway({ ...base, phase: 'working', turnedHome: false })).toBe('Verdant Reach · stop 2');
  });
});
