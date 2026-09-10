/**
 * Phase 6b — town hunting and town defense.
 *
 * REQ-TWN-007: *"Town hunting is real: hunters physically walk to hunting areas and fight
 * using the same combat system."* REQ-TWN-008: defense events can damage buildings, the
 * player sets guard policy, the AI organises guards, and when hunters are away the AI weighs
 * severity.
 *
 * "Real" is the claim to test hardest, because the cheap implementation — a dice roll that
 * produces loot and calls itself a hunt — passes any test that only checks the outputs. So
 * the tests here assert on the *combat log*: a hunt that produced no combat entries did not
 * happen, whatever it returned.
 *
 * The other claim worth care is that defense can genuinely cost the player something. A
 * defense system that never damages a building is a notification, not an event.
 */

import { describe, expect, it } from 'vitest';
import { testSession } from './helpers.js';
import { createRng } from '../src/core/rng.js';
import { migratePayload } from '../src/save/migrations/index.js';
import { CURRENT_SAVE_VERSION } from '../src/save/envelope.js';
import { parseThreats, crossValidateThreats } from '../src/data/threatSchema.js';
import { withAvailability } from '../src/core/hunter/Hunter.js';
import type { ThreatDef } from '../src/data/threatSchema.js';

function guildWithHunters(seed = 'town-combat', count = 3) {
  const harness = testSession(seed);
  harness.commands.foundTown();
  for (let i = 0; i < count; i++) {
    harness.debug.spawnHunter({ archetype: 'vanguard', level: 12, fullyEquipped: true });
  }
  harness.session.townJobs.refresh();
  return harness;
}

/** Put a hunting camp up and re-run the rota so somebody is posted to it. */
function withHuntingCamp(harness: ReturnType<typeof guildWithHunters>) {
  const spot = harness.session.town.grid.legalPlacements('hunting_camp').at(-1)!;
  expect(harness.commands.placeBuilding('hunting_camp', spot.x, spot.y).ok).toBe(true);
  harness.session.townJobs.refresh();
  return harness;
}

const threatOf = (harness: ReturnType<typeof guildWithHunters>, id: string): ThreatDef =>
  harness.session.content.threats.defense.threats.find((t) => t.id === id)!;

// ---------------------------------------------------------------------------
// REQ-TWN-007 — town hunting is real combat
// ---------------------------------------------------------------------------

describe('town hunting (REQ-TWN-007)', () => {
  it('runs an actual fight, not a dice roll wearing a fight’s name', () => {
    // The cheap implementation passes any test that only checks the outputs, so this checks
    // the combat log: no entries means no combat happened.
    const harness = guildWithHunters('hunt-real');
    const ground = harness.session.content.threats.hunting.grounds[0]!;
    const hunters = harness.session.roster.all().map((h) => h.id);

    const result = harness.session.townCombat.hunt(createRng('hunt'), ground, hunters);

    expect(result.log.length).toBeGreaterThan(0);
    expect(result.elapsedSeconds).toBeGreaterThan(0);
    expect(result.hunterIds).toEqual(hunters);
  });

  it('cannot kill anyone — town work runs at blue-zone rules', () => {
    // Permanent death belongs to the zone tiers (REQ-ZON-001). The safest activity in the
    // game must not become the deadliest by sheer volume.
    const harness = guildWithHunters('hunt-safe', 1);
    const ground = harness.session.content.threats.hunting.grounds[1]!;
    const before = harness.session.roster.size;

    for (let i = 0; i < 40; i++) {
      harness.session.townCombat.hunt(
        createRng(`hunt:${i}`),
        ground,
        harness.session.roster.all().map((h) => h.id),
      );
    }
    expect(harness.session.roster.size).toBe(before);
  });

  it('is staffed by the ordinary work rota, under the ordinary policy', () => {
    // REQ-TWN-007's "AI chooses workers" reuses the REQ-TWN-009/010 machinery rather than
    // adding a second assignment path that would drift out of step with the first.
    const harness = withHuntingCamp(guildWithHunters('hunt-rota'));
    const posted = harness.session.townJobs.all().filter((a) => a.jobId === 'town_hunting');
    expect(posted.length).toBeGreaterThan(0);
    expect(posted[0]?.explanation).toMatch(/Town hunting/);
  });

  it('produces nothing at all when no hunting camp stands', () => {
    const harness = guildWithHunters('hunt-nobuilding');
    expect(harness.session.town.jobSlots()['town_hunting']).toBeUndefined();

    const result = harness.commands.advanceTown(40);
    expect(result.hunts).toEqual([]);
  });

  it('yields experience to the hunters who went', () => {
    const harness = withHuntingCamp(guildWithHunters('hunt-yield'));
    const hunter = harness.session.roster
      .all()
      .find((h) =>
        harness.session.townJobs.all().some(
          (a) => a.hunterId === h.id && a.jobId === 'town_hunting',
        ),
      )!;
    const before = { xp: hunter.xp, level: hunter.level };

    const result = harness.commands.advanceTown(40);
    expect(result.hunts.length).toBeGreaterThan(0);

    const after = harness.session.roster.require(hunter.id);
    expect(after.xp > before.xp || after.level > before.level).toBe(true);
  });

  it('costs fatigue, measured against a guild that did not hunt', () => {
    // Asserting that fatigue simply *rises* over a span of steps is wrong now that idle
    // hunters rest: across forty steps, resting outweighs five outings and the net change
    // is zero. The real claim is comparative — hunting costs something — so the test holds
    // everything fixed except whether the camp exists.
    const hunting = withHuntingCamp(guildWithHunters('hunt-cost'));
    const idle = guildWithHunters('hunt-cost');

    for (const harness of [hunting, idle]) {
      for (const hunter of harness.session.roster.all()) {
        harness.session.roster.update(
          harness.session.condition.set(hunter, {
            fatigue: 0.7,
            hunger: 0,
            morale: 0.7,
          }),
        );
      }
      // Exactly one hunting window. A longer span lets resting floor both guilds at zero,
      // which measures nothing.
      harness.commands.advanceTown(8);
    }

    const meanFatigue = (harness: typeof hunting): number => {
      const all = harness.session.roster.all();
      return all.reduce((sum, h) => sum + h.condition.fatigue, 0) / all.length;
    };

    expect(hunting.commands.advanceTown(0).hunts).toEqual([]);
    expect(meanFatigue(hunting)).toBeGreaterThan(meanFatigue(idle));
  });

  it('rests hunters who are in town, so a work rota is sustainable', () => {
    // Nothing rested an `available` hunter until Phase 6b: town work added fatigue and
    // nothing removed it, so a hunter eventually passed the work ceiling and became
    // permanently unemployable — too tired for the rota, not injured enough to be resting.
    const harness = guildWithHunters('rest');
    for (const hunter of harness.session.roster.all()) {
      harness.session.roster.update(
        harness.session.condition.set(hunter, { fatigue: 1, hunger: 0, morale: 0.7 }),
      );
    }
    expect(harness.session.townJobs.refresh()).toEqual([]);

    harness.commands.advanceTown(30);

    for (const hunter of harness.session.roster.all()) {
      expect(hunter.condition.fatigue).toBeLessThan(1);
    }
    expect(harness.session.townJobs.refresh().length).toBeGreaterThan(0);
  });

  it('does not rest a hunter who is out in the field', () => {
    // Somebody on an expedition is not sitting in the bathhouse.
    const harness = guildWithHunters('rest-away');
    const hunter = harness.session.roster.all()[0]!;
    harness.session.roster.update(
      withAvailability(
        harness.session.condition.set(hunter, { fatigue: 0.6, hunger: 0, morale: 0.7 }),
        {
          state: 'assigned',
          assignment: 'an expedition',
          recallCompletesAtTick: undefined,
          readyAtTick: undefined,
        },
      ),
    );

    harness.commands.advanceTown(30);
    expect(harness.session.roster.require(hunter.id).condition.fatigue).toBe(0.6);
  });

  it('replays identically on the same seed', () => {
    // Town work runs on the same determinism rules as everything else (REQ-OFF-002).
    const a = withHuntingCamp(guildWithHunters('hunt-determinism'));
    const b = withHuntingCamp(guildWithHunters('hunt-determinism'));

    const first = a.commands.advanceTown(40);
    const second = b.commands.advanceTown(40);

    expect(first.hunts.map((h) => [h.groundId, h.won, h.xp])).toEqual(
      second.hunts.map((h) => [h.groundId, h.won, h.xp]),
    );
  });
});

// ---------------------------------------------------------------------------
// REQ-TWN-008 — town defense
// ---------------------------------------------------------------------------

describe('town defense (REQ-TWN-008)', () => {
  it('leaves a new guild alone long enough to raise a wall', () => {
    // A first hour spent losing buildings teaches the player nothing except that the game
    // is unfair.
    const harness = guildWithHunters('defense-grace');
    expect(harness.session.defense.ticksUntilThreat()).toBeGreaterThan(0);
    expect(harness.commands.advanceTown(1).defense).toBeUndefined();
  });

  it('fights a threat with the real combat system', () => {
    const harness = guildWithHunters('defense-real');
    const threat = threatOf(harness, 'wolf_pack');
    const defenders = harness.session.roster.all().map((h) => h.id);

    const result = harness.session.townCombat.defend(createRng('defend'), threat, defenders);
    expect(result.log.length).toBeGreaterThan(0);
    expect(result.defenderIds).toEqual(defenders);
  });

  it('damages buildings when the wall does not hold', () => {
    // A defense system that never costs the player a building is a notification.
    const harness = guildWithHunters('defense-damage', 0);
    const threat = threatOf(harness, 'wasp_swarm');

    // Nobody in town at all, so the threat is unopposed by construction.
    const result = harness.session.townCombat.defend(createRng('x'), threat, []);
    expect(result.held).toBe(false);
    expect(result.buildingsDamaged).toBeGreaterThan(0);
    expect(result.summary).toMatch(/Nobody was at the wall/);
  });

  it('takes a damaged building out of service without removing it', () => {
    // It is a burnt roof, not a cleared plot: it keeps its cells and stops contributing.
    const harness = guildWithHunters('defense-capacity');
    const bunkhouse = harness.session.town.grid
      .all()
      .find((p) => p.buildingId === 'bunkhouse')!;

    const housingBefore = harness.session.town.capacity().housing;
    const cellsBefore = harness.session.town.grid.freeCells();
    const countBefore = harness.session.town.grid.size;

    expect(harness.session.town.grid.damage(bunkhouse.instanceId).ok).toBe(true);

    expect(harness.session.town.capacity().housing).toBeLessThan(housingBefore);
    expect(harness.session.town.grid.freeCells()).toBe(cellsBefore);
    expect(harness.session.town.grid.size).toBe(countBefore);
  });

  it('never demotes the town for losing a building (REQ-TWN-002, DL-037)', () => {
    // Defense is the only thing that lowers capacity, which is precisely why the stage
    // ladder is stored rather than derived. A burnt granary must not undo a Village.
    const harness = guildWithHunters('defense-stage');
    harness.session.population.adjust(40);
    harness.session.town.refreshStage();
    expect(harness.session.town.stage().id).toBe('village');

    for (const placement of harness.session.town.grid.all()) {
      harness.session.town.grid.damage(placement.instanceId);
    }
    harness.session.town.refreshStage();
    expect(harness.session.town.stage().id).toBe('village');
  });

  it('restores a repaired building to service', () => {
    const harness = guildWithHunters('defense-repair');
    const camp = withHuntingCamp(harness).session.town.grid
      .all()
      .find((p) => p.buildingId === 'hunting_camp')!;

    expect(harness.session.town.jobSlots()['town_hunting']).toBeGreaterThan(0);
    harness.session.town.grid.damage(camp.instanceId);
    expect(harness.session.town.jobSlots()['town_hunting']).toBeUndefined();

    expect(harness.commands.repairBuilding(camp.instanceId).ok).toBe(true);
    expect(harness.session.town.jobSlots()['town_hunting']).toBeGreaterThan(0);
  });

  it('refuses to repair something that is not damaged', () => {
    const harness = guildWithHunters('defense-repair-noop');
    const placement = harness.session.town.grid.all()[0]!;
    const result = harness.commands.repairBuilding(placement.instanceId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not damaged/);
  });
});

// ---------------------------------------------------------------------------
// Guard policy — the player sets it, the AI organises under it
// ---------------------------------------------------------------------------

describe('guard policy (REQ-TWN-008)', () => {
  it('sends only the posted watch under guards-only', () => {
    const harness = withHuntingCamp(guildWithHunters('policy-guards'));
    // Put a watchtower up so somebody is actually posted to the defense department.
    const spot = harness.session.town.grid.legalPlacements('watchtower').at(-1)!;
    expect(harness.commands.placeBuilding('watchtower', spot.x, spot.y).ok).toBe(true);
    harness.session.townJobs.refresh();

    expect(harness.commands.setGuardPolicy('guards_only').ok).toBe(true);
    const chosen = harness.session.defense.defenders(threatOf(harness, 'wolf_pack'));
    const posted = harness.session.townJobs
      .all()
      .filter((a) => harness.session.content.townJobsById.get(a.jobId)?.department === 'defense')
      .map((a) => a.hunterId);

    expect([...chosen].sort()).toEqual([...posted].sort());
  });

  it('calls everyone in town under all-hands', () => {
    const harness = guildWithHunters('policy-all');
    expect(harness.commands.setGuardPolicy('all_available').ok).toBe(true);

    const chosen = harness.session.defense.defenders(threatOf(harness, 'wolf_pack'));
    expect(chosen.length).toBe(harness.session.roster.size);
  });

  it('escalates with severity when the Guild AI is deciding', () => {
    // The requirement's own "the AI evaluates severity", offered as a policy the player can
    // choose rather than as behaviour hidden inside the system.
    const harness = guildWithHunters('policy-severity', 5);
    const spot = harness.session.town.grid.legalPlacements('watchtower').at(-1)!;
    harness.commands.placeBuilding('watchtower', spot.x, spot.y);
    harness.session.townJobs.refresh();
    expect(harness.commands.setGuardPolicy('severity_based').ok).toBe(true);

    const small = harness.session.defense.defenders(threatOf(harness, 'wolf_pack'));
    const large = harness.session.defense.defenders(threatOf(harness, 'barrow_raid'));

    expect(large.length).toBeGreaterThanOrEqual(small.length);
    expect(large.length).toBe(harness.session.roster.size);
    expect(harness.session.defense.explainDefenders(threatOf(harness, 'barrow_raid'), large))
      .toMatch(/called everyone out/);
  });

  it('leaves the wall empty when the whole roster is in the field', () => {
    // REQ-TWN-008's "if hunters are away" doing real work rather than being a caveat.
    const harness = guildWithHunters('policy-away');
    harness.commands.setGuardPolicy('all_available');

    for (const hunter of harness.session.roster.all()) {
      harness.session.roster.update(
        withAvailability(hunter, {
          state: 'assigned',
          assignment: 'an expedition',
          recallCompletesAtTick: undefined,
          readyAtTick: undefined,
        }),
      );
    }

    const chosen = harness.session.defense.defenders(threatOf(harness, 'wolf_pack'));
    expect(chosen).toEqual([]);
    expect(harness.session.defense.explainDefenders(threatOf(harness, 'wolf_pack'), chosen))
      .toMatch(/nobody was in town/i);
  });

  it('refuses a policy that does not exist', () => {
    const harness = guildWithHunters('policy-unknown');
    expect(harness.commands.setGuardPolicy('fight_bravely').ok).toBe(false);
  });

  it('keeps a record of how the walls have held', () => {
    const harness = guildWithHunters('policy-record');
    expect(harness.session.defense.record).toEqual({ faced: 0, held: 0 });
    harness.session.defense.recordOutcome(true);
    harness.session.defense.recordOutcome(false);
    expect(harness.session.defense.record).toEqual({ faced: 2, held: 1 });
  });
});

// ---------------------------------------------------------------------------
// Content validation and save
// ---------------------------------------------------------------------------

describe('town combat content', () => {
  const base = {
    hunting: {
      everySteps: 8,
      fatiguePerHunt: 0.05,
      grounds: [
        {
          id: 'g',
          name: 'G',
          description: 'x',
          monsters: ['moss_crawler'],
          count: { min: 1, max: 2 },
          itemLevel: 4,
          lootChance: 0.3,
        },
      ],
    },
    defense: {
      everySteps: 90,
      graceSteps: 100,
      threats: [
        {
          id: 't',
          name: 'T',
          description: 'x',
          severity: 1,
          weight: 10,
          monsters: ['moss_crawler'],
          count: { min: 1, max: 2 },
          buildingDamage: 1,
          populationLoss: 0,
        },
      ],
      guardPolicies: [{ id: 'guards_only', name: 'G', description: 'x' }],
      defaultPolicy: 'guards_only',
    },
  };

  it('rejects a default guard policy that is not one of the policies', () => {
    expect(() =>
      parseThreats({
        ...base,
        defense: { ...base.defense, defaultPolicy: 'ghost' },
      }),
    ).toThrow(/not one of the guard policies/);
  });

  it('rejects content where every threat is gated behind reputation', () => {
    // Defense would then be content the early game never sees.
    expect(() =>
      parseThreats({
        ...base,
        defense: {
          ...base.defense,
          threats: [{ ...base.defense.threats[0], reputationAtLeast: 10 }],
        },
      }),
    ).toThrow(/never be attacked/);
  });

  it('rejects a hunting ground spawning a monster that does not exist', () => {
    // It would produce an empty fight the party walks through untouched — which reads as an
    // AI bug rather than a content one.
    expect(() =>
      crossValidateThreats({
        threats: parseThreats({
          ...base,
          hunting: {
            ...base.hunting,
            grounds: [{ ...base.hunting.grounds[0], monsters: ['direwolf'] }],
          },
        }),
        monsterIds: new Set(['moss_crawler']),
        reputationMax: 100,
      }),
    ).toThrow(/does not exist/);
  });

  it('loads the authored grounds and threats', () => {
    const { session } = testSession();
    expect(session.content.threats.hunting.grounds.length).toBeGreaterThan(0);
    expect(session.content.threats.defense.threats.length).toBeGreaterThan(0);
    expect(session.content.threats.defense.guardPolicies.length).toBeGreaterThan(1);
  });
});

describe('save v10', () => {
  it('round-trips guard policy, the threat timer and building damage', () => {
    const harness = guildWithHunters('save-defense');
    expect(harness.commands.setGuardPolicy('guards_only').ok).toBe(true);
    harness.session.defense.recordOutcome(false);

    const bunkhouse = harness.session.town.grid
      .all()
      .find((p) => p.buildingId === 'bunkhouse')!;
    harness.session.town.grid.damage(bunkhouse.instanceId);

    const before = {
      policy: harness.session.defense.policy,
      record: harness.session.defense.record,
      nextThreat: harness.session.defense.snapshot().nextThreatTick,
      damaged: harness.session.town.grid.damaged().map((p) => p.instanceId),
    };

    expect(harness.commands.saveGuild('slot').ok).toBe(true);
    expect(harness.commands.loadGuild('slot').ok).toBe(true);

    expect(harness.session.defense.policy).toBe(before.policy);
    expect(harness.session.defense.record).toEqual(before.record);
    expect(harness.session.defense.snapshot().nextThreatTick).toBe(before.nextThreat);
    expect(harness.session.town.grid.damaged().map((p) => p.instanceId)).toEqual(before.damaged);
  });

  it('gives a migrated v9 guild the authored default policy and a full grace period', () => {
    const migrated = migratePayload(
      {
        hunters: [],
        chronicles: [],
        clock: { tick: 0, accumulatorMs: 0 },
        rngStreams: {},
        armoury: { items: [], cardCounts: {}, cardsSeen: [], skillBooks: [] },
        lootPity: { sinceTier: 0 },
        audit: [],
        emergencyAuthorisations: [],
        worldKnowledge: { regions: [] },
        town: { grid: { placements: [], nextInstance: 1 }, highestStageIndex: 0 },
        departments: { departments: [] },
        townJobs: { assignments: [] },
        reputation: { value: 0, recent: [] },
        research: { completed: [], progress: 0 },
        recruitment: { candidates: [], nextRefreshTick: 0 },
      },
      9,
      CURRENT_SAVE_VERSION,
    ) as Record<string, unknown>;

    // The policy is absent so `restore` falls back to the *authored* default rather than a
    // hardcoded one — and the timer is absent so the guild gets its grace period back.
    expect(migrated['defense']).toEqual({ threatsFaced: 0, threatsHeld: 0 });

    const { session } = testSession('migrated-defense');
    session.restore(migrated as never);
    expect(session.defense.policy).toBe(
      session.content.threats.defense.defaultPolicy,
    );
    expect(session.defense.ticksUntilThreat()).toBeGreaterThan(0);
  });
});
