/**
 * Phase 6b — guild research.
 *
 * REQ-RES-001 asks for a branching tree where *some choices lock others*, so that the tree
 * becomes an identity rather than a checklist. REQ-RES-002 keeps research (technology) and
 * Guild Mastery (experience) on separate ledgers.
 *
 * The second one is the easier requirement to satisfy on paper and the easier one to break
 * by accident, so it is tested by where the points come from rather than by asserting that
 * two numbers differ: if any code path let hunter activity produce a research point, the
 * ledgers would have merged no matter what the docs said.
 */

import { describe, expect, it } from 'vitest';
import { testSession } from './helpers.js';
import { migratePayload } from '../src/save/migrations/index.js';
import { CURRENT_SAVE_VERSION } from '../src/save/envelope.js';
import { validateResearchGraph, type ResearchNodeDef } from '../src/data/researchSchema.js';

function foundedGuild(seed = 'research') {
  const harness = testSession(seed);
  harness.commands.foundTown();
  return harness;
}

/** Complete a node outright, bypassing the department, so effects can be tested directly. */
function complete(harness: ReturnType<typeof foundedGuild>, nodeId: string): void {
  const begun = harness.session.research.begin(nodeId);
  expect(begun.ok, `begin ${nodeId}`).toBe(true);
  if (!begun.ok) return;
  harness.session.research.contribute(begun.value.cost);
  expect(harness.session.research.isComplete(nodeId)).toBe(true);
}

/** A minimal well-formed node, so graph tests can vary exactly one thing. */
function node(over: Partial<ResearchNodeDef> & { id: string }): ResearchNodeDef {
  return {
    name: over.id,
    branch: 'town',
    description: 'x',
    cost: 10,
    requires: [],
    conflictsWith: [],
    effects: [{ kind: 'recovery', value: 1.1, axis: undefined, describe: 'x' }],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// REQ-RES-001 — a tree where choices lock other choices
// ---------------------------------------------------------------------------

describe('the research tree (REQ-RES-001)', () => {
  it('spans all three branches v1.0 §10 fixes', () => {
    const { session } = testSession();
    const branches = new Set(session.content.research.nodes.map((n) => n.branch));
    for (const branch of ['combat', 'town', 'economy']) {
      expect([...branches], branch).toContain(branch);
    }
  });

  it('says which prerequisites are missing, not merely that some are', () => {
    // REQ-RES-001 asks for "partial requirements" to be shown.
    const { session } = foundedGuild();
    const availability = session.research.availabilityOf('masonry');
    expect(availability.state).toBe('blocked');
    if (availability.state === 'blocked') {
      expect(availability.missing).toContain('Record Keeping');
    }
  });

  it('refuses to begin research whose prerequisites are unmet', () => {
    const { commands } = foundedGuild();
    const result = commands.beginResearch('public_works');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/needs/);
  });

  it('forecloses the conflicting branch permanently once a choice is made', () => {
    const harness = foundedGuild('conflict');
    complete(harness, 'guild_charter');

    expect(harness.session.research.availabilityOf('travel_light').state).toBe('available');
    complete(harness, 'standing_watch');

    const foreclosed = harness.session.research.availabilityOf('travel_light');
    expect(foreclosed.state).toBe('foreclosed');
    if (foreclosed.state === 'foreclosed') {
      expect(foreclosed.by).toContain('Standing Watch');
    }
    // And it cannot be started by going around the availability check.
    const attempt = harness.commands.beginResearch('travel_light');
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.error).toMatch(/ruled out by/);
  });

  it('releases the locks on a reset, which is the only way an identity changes', () => {
    const harness = foundedGuild('reset');
    complete(harness, 'guild_charter');
    complete(harness, 'standing_watch');
    expect(harness.session.research.availabilityOf('travel_light').state).toBe('foreclosed');

    const reset = harness.commands.resetResearch();
    expect(reset.ok).toBe(false);
    harness.session.resources.transact({ credits: { insight_crystal: 3 } });
    const paidReset = harness.commands.resetResearch();
    expect(paidReset.ok && paidReset.value.cleared).toBe(2);
    expect(paidReset.ok && paidReset.value.cost).toMatch(/Insight Crystal/);

    // The lock is gone, and so is everything that had been learned.
    expect(harness.session.research.isComplete('standing_watch')).toBe(false);
    expect(harness.session.research.availabilityOf('travel_light').state).toBe('blocked');
  });

  it('keeps banked progress when the player changes their mind', () => {
    // A guild that reconsiders should not be punished for having thought about something.
    const harness = foundedGuild('switch');
    expect(harness.commands.beginResearch('field_medicine').ok).toBe(true);
    harness.session.research.contribute(5);

    expect(harness.commands.beginResearch('guild_charter').ok).toBe(true);
    expect(harness.session.research.current?.progress).toBe(0);

    expect(harness.commands.beginResearch('field_medicine').ok).toBe(true);
    expect(harness.session.research.current?.progress).toBe(5);
  });

  it('carries overflow into whatever is started next', () => {
    const harness = foundedGuild('overflow');
    const charter = harness.session.content.researchById.get('guild_charter')!;
    expect(harness.commands.beginResearch('guild_charter').ok).toBe(true);

    harness.session.research.contribute(charter.cost + 7);
    expect(harness.session.research.isComplete('guild_charter')).toBe(true);

    expect(harness.commands.beginResearch('field_medicine').ok).toBe(true);
    expect(harness.session.research.current?.progress).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// REQ-RES-002 — technology and experience are separate ledgers
// ---------------------------------------------------------------------------

describe('research is technology, not experience (REQ-RES-002)', () => {
  it('makes no progress from hunter activity, only from the department', () => {
    const harness = foundedGuild('ledgers');
    const hunter = harness.debug.spawnHunter({ archetype: 'adept', level: 20, fullyEquipped: true });
    expect(harness.commands.beginResearch('field_medicine').ok).toBe(true);

    // Everything a hunter can do well, done repeatedly.
    const skill = harness.session.roster.require(hunter.id).knownSkills[0];
    if (skill) harness.commands.practiseSkill(hunter.id, skill, 50, 'decisive');
    harness.commands.findLoot(5, 10);

    // The Research Department has no building, so it has no output and no progress is made.
    expect(harness.session.departments.report('research').slots).toBe(0);
    harness.commands.advanceTown(20);
    expect(harness.session.research.current?.progress).toBe(0);
  });

  it('progresses when the Research Department is actually staffed', () => {
    const harness = foundedGuild('staffed');
    const { session, commands } = harness;

    // Research is gated behind Record Keeping, which is itself research — so the first
    // advance has to come from the Guild Hall's own archive post, which appears at tier 2.
    // Found by id rather than by position: `grid.all()` is sorted by instance id for stable
    // snapshots, so `[0]` is a bunkhouse, not the hall.
    const hall = session.town.grid.all().find((p) => p.buildingId === 'guild_hall')!;
    expect(commands.upgradeBuilding(hall.instanceId).ok).toBe(true);
    for (let i = 0; i < 4; i++) {
      harness.debug.spawnHunter({ archetype: 'adept', level: 25, fullyEquipped: true });
    }
    complete(harness, 'record_keeping');
    expect(session.departments.isUnlocked('research')).toBe(true);

    session.townJobs.refresh();
    expect(commands.beginResearch('masonry').ok).toBe(true);

    const output = session.departments.report('research').output;
    expect(output).toBeGreaterThan(0);

    const before = session.research.current?.progress ?? 0;
    commands.advanceTown(3);
    expect(session.research.current?.progress ?? 0).toBeGreaterThan(before);
  });
});

// ---------------------------------------------------------------------------
// Effects reach the systems that own them
// ---------------------------------------------------------------------------

describe('research effects reach real systems', () => {
  it('opens a department that was closed (REQ-DEP-001)', () => {
    const harness = foundedGuild('dept-unlock');
    expect(harness.session.departments.isUnlocked('crafting')).toBe(false);

    complete(harness, 'applied_metallurgy');
    expect(harness.session.departments.isUnlocked('crafting')).toBe(true);
  });

  it('opens a building the town had not grown into yet', () => {
    // Research is a second *route* to a locked building, not a third requirement.
    const harness = foundedGuild('build-unlock');
    expect(harness.session.town.canBuild('longhouse').ok).toBe(false);

    complete(harness, 'record_keeping');
    complete(harness, 'masonry');
    expect(harness.session.town.canBuild('longhouse').ok).toBe(true);
  });

  it('adds real capacity the population can feel', () => {
    const harness = foundedGuild('capacity');
    complete(harness, 'applied_metallurgy');

    const before = harness.session.town.capacity().food;
    complete(harness, 'provisioning');
    expect(harness.session.town.capacity().food).toBeGreaterThan(before);
  });

  it('improves housing quality without any building being added', () => {
    const harness = foundedGuild('quality');
    const before = harness.session.town.housingQuality();
    const buildings = harness.session.town.grid.size;

    complete(harness, 'record_keeping');
    complete(harness, 'masonry');

    expect(harness.session.town.grid.size).toBe(buildings);
    expect(harness.session.town.housingQuality()).toBeGreaterThan(before);
  });

  it('shortens recovery, and says so in words', () => {
    const harness = foundedGuild('recovery');
    const hunter = harness.debug.spawnHunter({ archetype: 'vanguard', level: 10 });
    const tired = harness.session.roster.require(hunter.id);
    harness.session.roster.update({
      ...tired,
      condition: { hunger: 0.1, fatigue: 0.6, morale: 0.6 },
    });

    const before = harness.session.recovery.estimate(
      harness.session.roster.require(hunter.id),
      { injured: true },
    );
    complete(harness, 'field_medicine');
    const after = harness.session.recovery.estimate(
      harness.session.roster.require(hunter.id),
      { injured: true },
    );

    expect(after.steps).toBeLessThan(before.steps);
    expect(after.explanation).toMatch(/knows its medicine/);
  });

  it('scales reputation gains but never softens a loss', () => {
    // Research is meant to make good work count for more. Letting it cushion a wipe would
    // turn a reputation system into an insurance policy.
    const plain = foundedGuild('rep-plain');
    const learned = foundedGuild('rep-learned');
    complete(learned, 'guild_charter');

    const outcome = {
      zoneTier: 'red',
      bossDefeated: false,
      worldBoss: false,
      wiped: false,
      deaths: 0,
      regionName: 'The Ashfall Barrows',
    } as const;
    expect(learned.session.reputation.recordExpedition(outcome)).toBeGreaterThan(
      plain.session.reputation.recordExpedition(outcome),
    );

    // Now the loss, from an identical starting point.
    for (const harness of [plain, learned]) {
      harness.session.reputation.change(-harness.session.reputation.current, 'level the field');
      harness.session.reputation.change(30, 'a good season');
    }
    const plainBefore = plain.session.reputation.current;
    const learnedBefore = learned.session.reputation.current;

    const wipe = { ...outcome, wiped: true, deaths: 2 } as const;
    plain.session.reputation.recordExpedition(wipe);
    learned.session.reputation.recordExpedition(wipe);

    expect(plainBefore - plain.session.reputation.current).toBeCloseTo(
      learnedBefore - learned.session.reputation.current,
      6,
    );
  });
});

// ---------------------------------------------------------------------------
// Content validation
// ---------------------------------------------------------------------------

describe('research content validation', () => {
  it('rejects a one-way conflict', () => {
    // Asymmetry would make the *order* of research decide what a guild could become, which
    // is a rule nobody wrote and no player could discover.
    expect(() =>
      validateResearchGraph([
        node({ id: 'a', conflictsWith: ['b'] }),
        node({ id: 'b' }),
      ]),
    ).toThrow(/symmetric/);
  });

  it('rejects a node that conflicts with something it depends on', () => {
    // It could never be taken, and nothing would fail — it would sit there looking like
    // content.
    expect(() =>
      validateResearchGraph([
        node({ id: 'root', conflictsWith: ['leaf'] }),
        node({ id: 'leaf', requires: ['root'], conflictsWith: ['root'] }),
      ]),
    ).toThrow(/can never be taken/);
  });

  it('rejects a prerequisite cycle', () => {
    expect(() =>
      validateResearchGraph([
        node({ id: 'a', requires: ['b'] }),
        node({ id: 'b', requires: ['a'] }),
      ]),
    ).toThrow(/cycle/);
  });

  it('rejects a prerequisite that does not exist', () => {
    expect(() => validateResearchGraph([node({ id: 'a', requires: ['ghost'] })])).toThrow(
      /does not exist/,
    );
  });

  it('loads the authored tree with every unlock pointing at something real', () => {
    const { session } = testSession();
    const buildingIds = new Set(session.content.town.buildings.map((b) => b.id));
    const departmentIds = new Set(session.content.departments.departments.map((d) => d.id));

    for (const node of session.content.research.nodes) {
      for (const effect of node.effects) {
        if (effect.kind === 'building') expect([...buildingIds]).toContain(String(effect.value));
        if (effect.kind === 'department') {
          expect([...departmentIds]).toContain(String(effect.value));
        }
      }
    }
  });

  it('never gates the Research Department behind research', () => {
    // A real deadlock, found by playing rather than by review: research points come only
    // from this department's output, so gating it behind a node meant no department, no
    // points, and no way to open the department. Every other department may be gated.
    const { session } = testSession();
    const research = session.content.departments.departments.find((d) => d.id === 'research');
    expect(research?.unlockedFromStart).toBe(true);
    expect(session.departments.isUnlocked('research')).toBe(true);
  });

  it('lets a brand-new guild actually complete something', () => {
    // The end-to-end version of the same claim: found a town, staff the Guild Hall's archive
    // post, and research must eventually finish. This is the test that would have caught the
    // deadlock without anyone having to play the game.
    const harness = foundedGuild('bootstrap');
    const hall = harness.session.town.grid.all().find((p) => p.buildingId === 'guild_hall')!;
    expect(harness.commands.upgradeBuilding(hall.instanceId).ok).toBe(true);
    for (let i = 0; i < 4; i++) {
      harness.debug.spawnHunter({ archetype: 'adept', level: 20, fullyEquipped: true });
    }
    harness.session.townJobs.refresh();

    expect(harness.commands.beginResearch('field_medicine').ok).toBe(true);
    expect(harness.session.departments.report('research').output).toBeGreaterThan(0);

    const result = harness.commands.advanceTown(60);
    expect(result.researchCompleted).toContain('Field Medicine');
  });

  it('opens every department that is not open from the start', () => {
    // The check that would have caught Phase 6a's stand-in predicate becoming permanent.
    const { session } = testSession();
    const opened = new Set(
      session.content.research.nodes.flatMap((n) =>
        n.effects.filter((e) => e.kind === 'department').map((e) => String(e.value)),
      ),
    );
    for (const department of session.content.departments.departments) {
      if (department.unlockedFromStart) continue;
      expect([...opened], department.id).toContain(department.id);
    }
  });
});

describe('save v8', () => {
  it('round-trips completed research and its locks', () => {
    const harness = foundedGuild('save-research');
    complete(harness, 'guild_charter');
    complete(harness, 'standing_watch');
    expect(harness.commands.beginResearch('hunters_creed').ok).toBe(true);
    harness.session.research.contribute(5);

    expect(harness.commands.saveGuild('slot').ok).toBe(true);
    expect(harness.commands.loadGuild('slot').ok).toBe(true);

    expect(harness.session.research.isComplete('standing_watch')).toBe(true);
    expect(harness.session.research.current?.node.id).toBe('hunters_creed');
    expect(harness.session.research.current?.progress).toBe(5);
    // The foreclosure survives, which is the part that matters most.
    expect(harness.session.research.availabilityOf('travel_light').state).toBe('foreclosed');
  });

  it('migrates a v7 save to a guild that has learned nothing', () => {
    const v7 = {
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
    };
    const migrated = migratePayload(v7, 7, CURRENT_SAVE_VERSION) as Record<string, unknown>;

    // Empty is the truth here, not a default: a guild predating research has learned
    // nothing *and* foreclosed nothing.
    expect(migrated['research']).toMatchObject({ completed: [], progress: 0 });
  });

  it('drops research that no longer exists rather than carrying a dangling id', () => {
    const { session } = testSession('stale-research');
    session.research.restore({
      completed: ['guild_charter', 'a_node_that_was_removed'],
      active: 'also_gone',
      progress: 12,
    });

    expect(session.research.isComplete('guild_charter')).toBe(true);
    expect(session.research.isComplete('a_node_that_was_removed')).toBe(false);
    expect(session.research.current).toBeUndefined();
  });
});
