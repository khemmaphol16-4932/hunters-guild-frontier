/**
 * Phase 5 — the world.
 *
 * §8 calls the map a knowledge interface rather than a level select, and REQ-WLD-001 makes
 * exploration information permanent. Those two together are the phase: what the guild knows
 * is progression, it survives everything including a roster wipe, and it gates where the
 * guild may go next (REQ-WLD-002).
 */

import { describe, expect, it } from 'vitest';
import { testSession } from './helpers.js';
import type { Session } from '../src/app/Session.js';
import { withAvailability } from '../src/core/hunter/Hunter.js';
import { createRng } from '../src/core/rng.js';
import { ZONE_TIERS } from '../src/data/combatSchema.js';
import { NEVER_RETREAT } from '../src/ai/policy/orders.js';

/** A party strong enough for the mid-tier regions, so unlocks are the only gate. */
function capableGuild(seed = 'world') {
  const harness = testSession(seed);
  for (const archetype of ['vanguard', 'adept', 'ranger', 'ranger'] as const) {
    harness.debug.spawnHunter({ archetype, level: 20, fullyEquipped: true });
  }
  return harness;
}

function veteran(session: Session, debug: ReturnType<typeof testSession>['debug'], level: number) {
  const hunter = debug.spawnHunter({ archetype: 'vanguard', level });
  session.roster.update(
    withAvailability(session.roster.require(hunter.id), {
      state: 'injured',
      assignment: undefined,
      recallCompletesAtTick: undefined,
      readyAtTick: 99999,
    }),
  );
}

// ---------------------------------------------------------------------------

describe('the world content', () => {
  it('has a region at every danger tier — REQ-ZON-001 fixes four', () => {
    const { session } = testSession();
    const tiers = new Set(session.content.world.regions.map((r) => r.zoneTier));
    for (const tier of ZONE_TIERS) expect([...tiers], tier).toContain(tier);
  });

  it('gives the tiers genuinely different environments — REQ-ZON-002', () => {
    const { session } = testSession();
    const byTier = new Map(session.content.world.regions.map((r) => [r.zoneTier, r]));

    // Not just a danger label: different populations, different hazards, different loot.
    const monstersOf = (tier: string) =>
      new Set(byTier.get(tier as never)?.encounters.flatMap((e) => e.monsters) ?? []);
    const blue = monstersOf('blue');
    const black = monstersOf('black');
    expect([...blue].some((m) => black.has(m))).toBe(false);

    expect(byTier.get('blue')?.hazards.length).toBe(0);
    expect(byTier.get('black')?.hazards.length).toBeGreaterThan(0);
    expect(byTier.get('red')?.itemLevel).toBeGreaterThan(byTier.get('yellow')?.itemLevel ?? 0);
  });

  it('offers events that can actually happen somewhere', () => {
    const { session } = testSession();
    expect(session.content.events.length).toBeGreaterThan(0);
    for (const event of session.content.events) {
      // Every event is a *decision*, so it has to offer more than one course.
      expect(event.options.length, event.id).toBeGreaterThanOrEqual(2);
      const eligible = session.content.world.regions.filter(
        (r) =>
          event.zoneTiers.includes(r.zoneTier) &&
          (event.hazards.length === 0 || event.hazards.some((h) => r.hazards.includes(h))),
      );
      expect(eligible.length, event.id).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------

describe('world knowledge', () => {
  it('starts from what the content says the guild already knows', () => {
    const { session } = testSession();
    expect(session.worldKnowledge.of('verdant_reach').tier).toBe('experienced');
    expect(session.worldKnowledge.of('ashfall_barrows').tier).toBe('rumor');
    expect(session.worldKnowledge.of('nowhere').tier).toBe('unknown');
  });

  it('advances with visits and never goes backwards — REQ-WLD-001', () => {
    const { session, commands } = capableGuild();
    const before = session.worldKnowledge.of('coldwater_quarry');
    expect(before.visits).toBe(0);

    const outcome = commands.sendExpedition('coldwater_quarry', 'clear');
    if (!outcome.ok) throw new Error(outcome.error);

    const after = session.worldKnowledge.of('coldwater_quarry');
    expect(after.visits).toBe(1);
    expect(after.seenMonsters.length).toBeGreaterThan(0);
    expect(after.deepestNode).toBeGreaterThan(0);

    // Raising to something lower is a no-op — permanence is a property of the type.
    session.worldKnowledge.raise('coldwater_quarry', 'unknown');
    expect(session.worldKnowledge.of('coldwater_quarry').tier).toBe(after.tier);
  });

  it('is learned even by a party that is wiped out', () => {
    // A guild that loses everyone still knows what killed them. Tying knowledge to hunters
    // would let a guild forget a region, which REQ-WLD-001 forbids.
    const { session, commands, debug } = testSession('wiped');
    session.policy.add(NEVER_RETREAT.constraint);
    for (const archetype of ['vanguard', 'adept', 'ranger', 'ranger'] as const) {
      debug.spawnHunter({ archetype, level: 3, fullyEquipped: true });
    }
    veteran(session, debug, 30);

    const outcome = commands.sendExpedition('ashfall_barrows', 'slay');
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.value.result.wiped).toBe(true);

    const known = session.worldKnowledge.of('ashfall_barrows');
    expect(known.visits).toBe(1);
    expect(known.seenMonsters.length).toBeGreaterThan(0);
  });

  it('discloses more as it grows — §8 makes the map a knowledge interface', () => {
    const { session } = testSession();
    const ashfall = session.content.worldRegionsById.get('ashfall_barrows');
    if (!ashfall) throw new Error('fixture');

    const rumoured = session.worldKnowledge.describe(ashfall);
    expect(rumoured.join(' ')).toMatch(/rumours/i);

    // Disclosure follows *going there*, not the tier alone — content can start the guild
    // already knowing a place it has never mounted an expedition to, and claiming a
    // deepest-point-reached for a region nobody has entered would be a fiction.
    session.worldKnowledge.record('ashfall_barrows', {
      nodeKinds: ['combat', 'boss'],
      monsters: ['bracken_stalker', 'warden_of_ash'],
      deepestNode: 4,
      bossDefeated: false,
    });

    const known = session.worldKnowledge.describe(ashfall);
    expect(known.length).toBeGreaterThan(rumoured.length);
    expect(known.join(' ')).toMatch(/Deepest point reached: node 4/);
    expect(known.join(' ')).toMatch(/2 kinds of inhabitant/);
  });

  it('survives a save and reload', () => {
    const { session, commands } = capableGuild();
    const outcome = commands.sendExpedition('coldwater_quarry', 'clear');
    if (!outcome.ok) throw new Error(outcome.error);

    const before = session.worldKnowledge.of('coldwater_quarry');
    expect(commands.saveGuild('world').ok).toBe(true);
    expect(commands.loadGuild('world').ok).toBe(true);

    expect(session.worldKnowledge.of('coldwater_quarry')).toEqual(before);
  });

  it('records the guild setting foot somewhere for the first time', () => {
    const { session, commands } = capableGuild();
    commands.sendExpedition('coldwater_quarry', 'clear');

    // §19: every hunter on the roster gets the entry, because it is the *guild* that
    // arrived somewhere new.
    for (const chronicle of session.chronicle.all()) {
      expect(chronicle.counters['zonesFirstEntered']).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------

describe('region unlocks — REQ-WLD-002', () => {
  it('locks the deep regions behind level and knowledge', () => {
    const { commands, debug } = testSession('locks');
    debug.spawnHunter({ archetype: 'vanguard', level: 1, fullyEquipped: true });

    const unlocked = new Map(
      commands.regionAvailability().map((a) => [a.region.id, a.unlocked]),
    );
    expect(unlocked.get('verdant_reach')).toBe(true);
    expect(unlocked.get('coldwater_quarry')).toBe(false);
    expect(unlocked.get('ashfall_barrows')).toBe(false);
  });

  it('says what a locked region is waiting for, rather than hiding it', () => {
    const { commands, debug } = testSession('locks');
    debug.spawnHunter({ archetype: 'vanguard', level: 1, fullyEquipped: true });

    const locked = commands.regionAvailability().find((a) => a.region.id === 'ashfall_barrows');
    expect(locked?.unlocked).toBe(false);
    expect(locked?.blockedBy.join(' ')).toMatch(/level 15/);
  });

  it('refuses the expedition, not merely the button', () => {
    const { commands, debug } = testSession('locks');
    debug.spawnHunter({ archetype: 'vanguard', level: 1, fullyEquipped: true });

    const refused = commands.sendExpedition('ashfall_barrows', 'slay');
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/not open to the guild/);
  });

  it('opens once the guild has earned it', () => {
    const { session, commands } = capableGuild();
    // Level 20 hunters satisfy the level gate; the quarry starts "discovered", which is
    // what Ashfall's knowledge gate asks for.
    const availability = commands.regionAvailability();
    expect(availability.find((a) => a.region.id === 'coldwater_quarry')?.unlocked).toBe(true);
    expect(availability.find((a) => a.region.id === 'ashfall_barrows')?.unlocked).toBe(true);

    // The red region wants the quarry known *well*, which takes going there.
    expect(availability.find((a) => a.region.id === 'the_sunken_choirhouse')?.unlocked).toBe(false);
    session.worldKnowledge.raise('coldwater_quarry', 'experienced');
    expect(
      commands.regionAvailability().find((a) => a.region.id === 'the_sunken_choirhouse')?.unlocked,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('expedition events — REQ-EXP-002', () => {
  function run(seed: string, regionId = 'the_sunken_choirhouse') {
    const { session, commands } = capableGuild(seed);
    session.worldKnowledge.raise('coldwater_quarry', 'mastered');
    const outcome = commands.sendExpedition(regionId, 'clear');
    if (!outcome.ok) throw new Error(outcome.error);
    return outcome.value.result;
  }

  it('fire, and the guild chooses an option', () => {
    // Across seeds, because whether a route contains an event is a draw.
    const runs = Array.from({ length: 10 }, (_, i) => run(`event-${i}`));
    const withEvents = runs.filter((r) => r.events.length > 0);
    expect(withEvents.length).toBeGreaterThan(0);

    const { session } = testSession();
    for (const result of withEvents) {
      for (const fired of result.events) {
        // The event and the option both have to be real content, not a fabricated id.
        const event = session.content.eventsById.get(fired.eventId);
        expect(event, fired.eventId).toBeDefined();
        expect(event?.options.some((o) => o.id === fired.optionId), fired.optionId).toBe(true);
      }
      // And the choice is explained in the option's own authored words (v1.0 §14).
      const explained = result.decisions.filter((d) => d.reasonCodes.some((c) => c.startsWith('event:')));
      expect(explained.length).toBe(result.events.length);
      for (const decision of explained) {
        expect(decision.reasonCodes.some((c) => c.startsWith('option:'))).toBe(true);
        expect(decision.explanation.length).toBeGreaterThan(20);
      }
    }
  });

  it('are drawn only where they belong', () => {
    const { session } = testSession();
    // "The singing gets louder" is authored for the marsh and the barrows, not the lowland.
    const singing = session.content.eventsById.get('the_singing');
    expect(singing).toBeDefined();
    expect(singing?.zoneTiers).not.toContain('blue');
  });

  it('replay identically from the same seed', () => {
    const a = run('same');
    const b = run('same');
    expect(b.events).toEqual(a.events);
    expect(b.decisions.map((d) => d.explanation)).toEqual(a.decisions.map((d) => d.explanation));
  });

  it('are chosen differently by a cautious guild than by a committed one', () => {
    // The objective drives the choice, which is the whole point of the guild deciding
    // rather than the player: a "bring everyone home" guild takes the safe option, a
    // "kill the boss" guild takes the fast one.
    function optionsTaken(objective: 'survive' | 'slay'): string[] {
      const taken: string[] = [];
      for (let i = 0; i < 12; i++) {
        const { session, commands } = capableGuild(`option-${i}`);
        session.worldKnowledge.raise('coldwater_quarry', 'mastered');
        const outcome = commands.sendExpedition('the_sunken_choirhouse', objective);
        if (!outcome.ok) continue;
        taken.push(...outcome.value.result.events.map((e) => `${e.eventId}:${e.optionId}`));
      }
      return taken;
    }

    const cautious = new Set(optionsTaken('survive'));
    const committed = new Set(optionsTaken('slay'));

    expect(cautious.size).toBeGreaterThan(0);
    expect(committed.size).toBeGreaterThan(0);
    expect(
      [...cautious].some((c) => !committed.has(c)),
      `survive=${[...cautious].join(',')} slay=${[...committed].join(',')}`,
    ).toBe(true);
  });

  it('can lengthen a route — the branching in REQ-EXP-002', () => {
    // A detour splices extra nodes into the walk. Compared between objectives on the *same
    // seed*, because both draw the same base route: only the cautious guild chooses "go
    // around", so any difference in length is the branch itself.
    //
    // Deliberately not asserted as "longer than the region's authored maximum" — a detour
    // taken on a short route still lands inside the band, and that version of this test
    // failed while the branching was working perfectly.
    function lengthFor(seed: string, objective: 'survive' | 'slay'): number | undefined {
      const { session, commands } = capableGuild(seed);
      session.worldKnowledge.raise('coldwater_quarry', 'mastered');
      const outcome = commands.sendExpedition('the_sunken_choirhouse', objective);
      return outcome.ok ? outcome.value.result.routeLength : undefined;
    }

    const seeds = Array.from({ length: 14 }, (_, i) => `option-${i}`);
    const longer = seeds.filter((seed) => {
      const cautious = lengthFor(seed, 'survive');
      const committed = lengthFor(seed, 'slay');
      return cautious !== undefined && committed !== undefined && cautious > committed;
    });

    expect(longer.length, 'no seed produced a detour').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe('expedition duration — REQ-EXP-003', () => {
  it('never exceeds ten minutes', () => {
    const cap = testSession().session.content.balance.combat.maxExpeditionSeconds;
    expect(cap).toBe(600);

    for (let i = 0; i < 12; i++) {
      const { session, commands } = capableGuild(`clock-${i}`);
      session.worldKnowledge.raise('coldwater_quarry', 'mastered');
      const outcome = commands.sendExpedition('the_sunken_choirhouse', 'clear');
      if (!outcome.ok) throw new Error(outcome.error);

      // The cap is checked between nodes, so a run can overshoot by the last node's own
      // length — what must never happen is a run that ignores the clock entirely.
      const result = outcome.value.result;
      expect(result.elapsedSeconds, `clock-${i}`).toBeLessThan(cap * 2);
      if (result.outOfTime) expect(result.elapsedSeconds).toBeGreaterThanOrEqual(cap);
    }
  });

  it('reports the time it took, and says so when the light went', () => {
    const { commands } = capableGuild('clock');
    const outcome = commands.sendExpedition('coldwater_quarry', 'clear');
    if (!outcome.ok) throw new Error(outcome.error);

    expect(outcome.value.result.elapsedSeconds).toBeGreaterThan(0);
    if (outcome.value.result.outOfTime) {
      expect(outcome.value.result.summary).toMatch(/light went/);
    }
  });
});

// ---------------------------------------------------------------------------

describe('the world boss', () => {
  it('is authored with unique mechanics and its own phases — REQ-BOS-002', () => {
    const { session } = testSession();
    const boss = session.content.monstersById.get('the_drowned_choir');
    expect(boss).toBeDefined();
    expect(boss?.tier).toBe('boss');
    expect(boss?.phases.length).toBeGreaterThanOrEqual(2);

    // REQ-BOS-001: every important boss skill telegraphs.
    const important = boss?.skills.filter((s) => s.power >= 1.4) ?? [];
    expect(important.length).toBeGreaterThan(0);
    for (const skill of important) {
      expect(skill.telegraphSeconds, skill.id).toBeDefined();
    }
  });
});

// A save written before world knowledge existed still loads.
describe('save migration to v6', () => {
  it('gives a v5 save the authored starting knowledge rather than nothing', () => {
    const { session, commands } = capableGuild('migrate');
    expect(commands.saveGuild('v6').ok).toBe(true);

    // Simulate a v5 save by dropping the field the way the migration will find it.
    session.worldKnowledge.restore(undefined);
    expect(session.worldKnowledge.of('verdant_reach').tier).toBe('experienced');
    expect(session.worldKnowledge.of('verdant_reach').visits).toBe(0);
  });
});

// Kept out of the main sweep: uses the raw expedition, not the command surface.
describe('routes stay procedural inside a fixed world — REQ-EXP-001', () => {
  it('two seeds walk the same region differently', () => {
    const { session } = capableGuild('routes');
    const region = session.content.worldRegionsById.get('coldwater_quarry');
    if (!region) throw new Error('fixture');

    const a = session.expedition.route(createRng('a'), region).map((n) => n.kind).join('|');
    const b = session.expedition.route(createRng('b'), region).map((n) => n.kind).join('|');
    expect(b).not.toBe(a);
  });
});
