/**
 * Phase 6b — the Recruitment Hall.
 *
 * REQ-RCT-001: the pool runs through the hall, depends on town and reputation, and refreshes
 * both on a timer and for a price. REQ-RCT-002: different regions produce *clearly* different
 * pools, and an exceptional recruit is immediately legible.
 *
 * "Clearly different" is the claim worth testing carefully, because it is the one a plausible
 * implementation gets wrong: pools that differ only in the names they draw read as one pool
 * with different labels, which is exactly the state Phase 1 left this in and named in
 * TECH_DEBT. So the test measures the *distributions* an origin produces, not just its names,
 * and it sweeps rather than sampling a single draw — the lesson from every previous phase.
 */

import { describe, expect, it } from 'vitest';
import { testSession } from './helpers.js';
import { createRng } from '../src/core/rng.js';
import { migratePayload } from '../src/save/migrations/index.js';
import { CURRENT_SAVE_VERSION } from '../src/save/envelope.js';
import { crossValidateRecruitment, parseRecruitment } from '../src/data/recruitSchema.js';
import { analysePool, roleGaps } from '../src/ai/town/guildFit.js';
import type { Candidate } from '../src/core/town/recruitment.js';
import type { Session } from '../src/app/Session.js';

/** A guild with a town and a Recruitment Hall standing. */
function guildWithHall(seed = 'recruit') {
  const harness = testSession(seed);
  harness.commands.foundTown();
  // The hall needs a population of 20; give the town one rather than waiting 200 steps.
  harness.session.population.adjust(20);
  const spot = harness.session.town.grid.legalPlacements('recruitment_hall').at(-1)!;
  const placed = harness.commands.placeBuilding('recruitment_hall', spot.x, spot.y);
  expect(placed.ok, 'recruitment hall placed').toBe(true);
  return harness;
}

function fitDeps(session: Session) {
  return {
    profileOf: (hunter: Parameters<typeof session.buildIdentity.profileOf>[0]) =>
      session.buildIdentity.profileOf(hunter),
    potentialOf: (hunter: { potential: { composite: number } }) => hunter.potential.composite,
  };
}

// ---------------------------------------------------------------------------
// REQ-RCT-001 — the hall, the pool, and two ways to refresh it
// ---------------------------------------------------------------------------

describe('the Recruitment Hall (REQ-RCT-001)', () => {
  it('offers nobody at all until the hall is built', () => {
    // The building is load-bearing rather than decoration: no hall, no pool.
    const harness = testSession('no-hall');
    harness.commands.foundTown();
    expect(harness.session.town.grid.countOf('recruitment_hall')).toBe(0);

    harness.session.recruitment.refresh(harness.session.streams.recruit);
    expect(harness.session.recruitment.available()).toEqual([]);
    expect(harness.commands.refreshRecruits().ok).toBe(false);
  });

  it('draws a pool once the hall stands', () => {
    const harness = guildWithHall();
    const drawn = harness.commands.refreshRecruits();
    expect(drawn.ok).toBe(true);
    if (drawn.ok) expect(drawn.value.length).toBeGreaterThan(0);
  });

  it('empties the moment the hall comes down', () => {
    // Checked on read rather than only on refresh, so demolishing is immediate.
    const harness = guildWithHall('demolish');
    harness.commands.refreshRecruits();
    expect(harness.session.recruitment.available().length).toBeGreaterThan(0);

    const hall = harness.session.town.grid
      .all()
      .find((p) => p.buildingId === 'recruitment_hall')!;
    expect(harness.commands.demolishBuilding(hall.instanceId).ok).toBe(true);
    expect(harness.session.recruitment.available()).toEqual([]);
  });

  it('gives a better-known guild more people to choose from', () => {
    const unknown = guildWithHall('unknown');
    const famous = guildWithHall('famous');
    famous.session.reputation.change(80, 'a reputation');

    expect(famous.session.recruitment.poolSize()).toBeGreaterThan(
      unknown.session.recruitment.poolSize(),
    );
  });

  it('opens rarer origins only once the guild is known (REQ-RCT-001)', () => {
    const harness = guildWithHall('origins');
    const early = harness.session.recruitment.eligibleOrigins().map((o) => o.id);
    expect(early).toContain('frontier_born');
    expect(early).not.toContain('far_road');

    harness.session.reputation.change(60, 'word gets around');
    expect(harness.session.recruitment.eligibleOrigins().map((o) => o.id)).toContain('far_road');
  });

  it('refreshes on a timer as well as for a price', () => {
    const harness = guildWithHall('timer');
    harness.commands.refreshRecruits();
    const before = harness.session.recruitment.available().map((c) => c.hunter.id);
    expect(harness.session.recruitment.ticksUntilRefresh()).toBeGreaterThan(0);

    // Not yet due, so passing a little time changes nobody.
    harness.commands.advanceTown(1);
    expect(harness.session.recruitment.available().map((c) => c.hunter.id)).toEqual(before);

    // Past the interval, and the people waiting are different people. Advancing town time
    // is enough now that it actually moves the simulation clock — before that fix this test
    // had to shove the clock forward by hand, which was the bug wearing a workaround.
    harness.commands.advanceTown(
      harness.session.content.recruitment.pool.refreshEverySteps + 1,
    );
    expect(harness.session.recruitment.available().map((c) => c.hunter.id)).not.toEqual(before);
  });

  it('replaces everyone on a paid refresh rather than re-rolling some', () => {
    // The player is buying a different set; keeping anyone would make the price arbitrary.
    const harness = guildWithHall('paid');
    harness.commands.refreshRecruits();
    const before = new Set(harness.session.recruitment.available().map((c) => c.hunter.id));

    harness.commands.refreshRecruits();
    const after = harness.session.recruitment.available().map((c) => c.hunter.id);
    expect(after.some((id) => before.has(id))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REQ-RCT-002 — clearly different pools, and legible exceptions
// ---------------------------------------------------------------------------

describe('regional identity (REQ-RCT-002)', () => {
  it('gives every origin its own name pool', () => {
    // Phase 1 shipped one pool and named the gap in TECH_DEBT; this is the repayment.
    const { session } = testSession();
    const pools = new Set(session.content.recruitment.origins.map((o) => o.namePool));
    expect(pools.size).toBe(session.content.recruitment.origins.length);
    expect(session.content.namePools.length).toBeGreaterThan(1);
  });

  it('produces measurably different archetype mixes, swept rather than sampled', () => {
    // A single draw proves nothing about a distribution. Two origins with opposite biases,
    // forty draws each, and the difference has to show up in the aggregate.
    const { session } = testSession('distribution');
    const origins = session.content.recruitment;
    const hills = origins.origins.find((o) => o.id === 'hill_clans')!;
    const collegium = origins.origins.find((o) => o.id === 'collegium')!;

    const drawArchetypes = (origin: typeof hills): Record<string, number> => {
      const counts: Record<string, number> = {};
      for (let i = 0; i < 40; i++) {
        const archetype = pickBiased(session, origin.archetypeBias, i) ?? 'vanguard';
        const hunter = session.generateHunter({
          enlist: false,
          namePool: origin.namePool,
          potentialBias: origin.potentialBias,
          archetype,
        });
        counts[hunter.archetype] = (counts[hunter.archetype] ?? 0) + 1;
      }
      return counts;
    };

    const hillMix = drawArchetypes(hills);
    const collegiumMix = drawArchetypes(collegium);

    // The hills send fighters; the collegium sends adepts. Not "sometimes" — in aggregate.
    expect(hillMix['vanguard'] ?? 0).toBeGreaterThan(collegiumMix['vanguard'] ?? 0);
    expect(collegiumMix['adept'] ?? 0).toBeGreaterThan(hillMix['adept'] ?? 0);
  });

  it('biases without gating, so an unusual recruit is still possible', () => {
    // DL-008's reasoning applied to origins: a bias that excluded would turn recruitment
    // into a lookup table and destroy the variety the system exists to produce.
    const { session } = testSession('bias-not-gate');
    const collegium = session.content.recruitment.origins.find((o) => o.id === 'collegium')!;

    // The collegium's Vanguard bias is 0.4 — unlikely, never impossible.
    expect(collegium.archetypeBias['vanguard']).toBeGreaterThan(0);

    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(pickBiased(session, collegium.archetypeBias, i) ?? '');
    }
    expect(seen.size).toBeGreaterThan(1);
    expect([...seen]).toContain('vanguard');
  });

  it('flags an exceptional recruit rather than leaving the player to infer it', () => {
    const harness = guildWithHall('exceptional');
    const threshold = harness.session.content.recruitment.exceptional.potentialAtLeast;
    harness.session.resources.transact({ credits: { gold: 7500 } });

    // Draw enough pools that at least one exceptional candidate appears, then check the
    // flag agrees with the threshold in every case.
    let sawExceptional = false;
    for (let i = 0; i < 30; i++) {
      for (const candidate of harness.commands.refreshRecruits().ok
        ? harness.session.recruitment.available()
        : []) {
        expect(candidate.exceptional).toBe(candidate.hunter.potential.composite >= threshold);
        if (candidate.exceptional) sawExceptional = true;
      }
    }
    expect(sawExceptional).toBe(true);
  });

  it('says where a candidate came from, in words', () => {
    const harness = guildWithHall('origin-words');
    harness.commands.refreshRecruits();
    for (const candidate of harness.session.recruitment.available()) {
      expect(candidate.originName.length).toBeGreaterThan(0);
      expect(candidate.originNote.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Guild Fit (v1.0 §4)
// ---------------------------------------------------------------------------

describe('Guild Fit analysis (v1.0 §4)', () => {
  it('measures what the guild is missing, not who is strongest', () => {
    const { session } = testSession('gaps');
    // A guild of nothing but Vanguards has a healer-shaped hole.
    for (let i = 0; i < 4; i++) {
      session.generateHunter({ archetype: 'vanguard' });
    }
    const gaps = roleGaps(session.roster.all(), (h) => session.buildIdentity.profileOf(h));
    expect(gaps.healer).toBeGreaterThan(gaps.tank);
  });

  it('gives reasons, gains and concerns rather than a bare score', () => {
    // "Top candidates *with reasons*" — a ranking with no sentences is one the player has
    // to take on faith.
    const harness = guildWithHall('reasons');
    harness.debug.spawnHunter({ archetype: 'vanguard', level: 10 });
    harness.commands.refreshRecruits();

    const board = harness.commands.recruitmentBoard();
    expect(board.advice.ranked.length).toBeGreaterThan(0);
    for (const fit of board.advice.ranked) {
      expect(fit.reasons.length).toBeGreaterThan(0);
    }
    expect(board.advice.summary).toMatch(/gold/);
  });

  it('is willing to say something negative', () => {
    // A recruiter that only says good things is not giving advice. A guild deep in one role
    // should hear about it when another of that role turns up.
    const { session } = testSession('concerns');
    for (let i = 0; i < 5; i++) session.generateHunter({ archetype: 'vanguard' });

    const another = session.generateHunter({ archetype: 'vanguard', enlist: false });
    const candidate: Candidate = {
      hunter: another,
      originId: 'frontier_born',
      originName: 'Frontier-born',
      originNote: 'x',
      exceptional: false,
      cost: 100,
    };

    const advice = analysePool([candidate], {
      roster: session.roster.all(),
      deps: fitDeps(session),
    });
    expect(advice.ranked[0]?.concerns.length).toBeGreaterThan(0);
  });

  it('names an alternative only when it is best at something else', () => {
    // Not "second place" — another marginally worse generalist tells the player nothing.
    const harness = guildWithHall('alternatives');
    harness.debug.spawnHunter({ archetype: 'vanguard', level: 10 });
    harness.commands.refreshRecruits();

    const board = harness.commands.recruitmentBoard();
    for (const alternative of board.advice.alternatives) {
      expect(alternative.hunterId).not.toBe(board.advice.recommended?.hunterId);
    }
  });

  it('has nothing to say about an empty hall, without falling over', () => {
    const { session } = testSession('empty-hall');
    const advice = analysePool([], { roster: session.roster.all(), deps: fitDeps(session) });
    expect(advice.recommended).toBeUndefined();
    expect(advice.summary).toMatch(/Nobody/);
  });
});

// ---------------------------------------------------------------------------
// Hiring
// ---------------------------------------------------------------------------

describe('hiring', () => {
  it('enlists exactly the hunter the player was looking at', () => {
    // A candidate is a whole Hunter, so what the player sees is what they get — no re-roll
    // and no reconstruction from a summary.
    const harness = guildWithHall('hire');
    harness.commands.refreshRecruits();

    const candidate = harness.session.recruitment.available()[0]!;
    const before = harness.session.roster.size;

    const hired = harness.commands.hireRecruit(candidate.hunter.id);
    expect(hired.ok).toBe(true);
    if (!hired.ok) return;

    expect(hired.value.id).toBe(candidate.hunter.id);
    expect(hired.value.name).toBe(candidate.hunter.name);
    expect(hired.value.potential.composite).toBe(candidate.hunter.potential.composite);
    expect(harness.session.roster.size).toBe(before + 1);
  });

  it('develops a hire exactly like any other recruit', () => {
    // Two divergent versions of "what a new hunter knows" would be a very quiet bug.
    const harness = guildWithHall('develop');
    harness.commands.refreshRecruits();
    const candidate = harness.session.recruitment.available()[0]!;
    expect(candidate.hunter.knownSkills.length).toBe(0);

    const hired = harness.commands.hireRecruit(candidate.hunter.id);
    expect(hired.ok).toBe(true);
    if (hired.ok) {
      expect(hired.value.knownSkills.length).toBeGreaterThan(0);
      expect(hired.value.loadout.length).toBeGreaterThan(0);
    }
  });

  it('takes a hire off the board so they cannot be hired twice', () => {
    const harness = guildWithHall('twice');
    harness.commands.refreshRecruits();
    const candidate = harness.session.recruitment.available()[0]!;

    expect(harness.commands.hireRecruit(candidate.hunter.id).ok).toBe(true);
    const again = harness.commands.hireRecruit(candidate.hunter.id);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/no longer at the hall/);
  });

  it('leaves the seat empty when a candidate is turned away', () => {
    const harness = guildWithHall('turn-away');
    harness.commands.refreshRecruits();
    const before = harness.session.recruitment.available().length;
    const candidate = harness.session.recruitment.available()[0]!;

    expect(harness.commands.turnAwayRecruit(candidate.hunter.id).ok).toBe(true);
    expect(harness.session.recruitment.available().length).toBe(before - 1);
    expect(harness.session.roster.get(candidate.hunter.id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Content validation and save
// ---------------------------------------------------------------------------

describe('recruitment content validation', () => {
  const base = {
    origins: [
      {
        id: 'a',
        name: 'A',
        description: 'x',
        weight: 10,
        namePool: 'frontier',
        potentialBias: 1,
      },
    ],
    pool: {
      size: 4,
      refreshEverySteps: 10,
      paidRefreshGold: 100,
      sizePerReputation: 0,
      maxSize: 8,
    },
    exceptional: { potentialAtLeast: 0.7, label: 'x', note: 'y' },
  };

  it('rejects a pool with no timed refresh', () => {
    expect(() =>
      parseRecruitment({ ...base, pool: { ...base.pool, refreshEverySteps: 0 } }),
    ).toThrow(/timed refresh/);
  });

  it('rejects a pool with no paid refresh', () => {
    expect(() =>
      parseRecruitment({ ...base, pool: { ...base.pool, paidRefreshGold: 0 } }),
    ).toThrow(/paid refresh/);
  });

  it('rejects content where every origin is gated behind reputation', () => {
    // A new guild could then recruit nobody, and nothing would fail.
    expect(() =>
      parseRecruitment({
        ...base,
        origins: [{ ...base.origins[0], reputationAtLeast: 5 }],
      }),
    ).toThrow(/could recruit nobody/);
  });

  it('rejects an origin drawing from a name pool that does not exist', () => {
    expect(() =>
      crossValidateRecruitment({
        recruitment: parseRecruitment({
          ...base,
          origins: [{ ...base.origins[0], namePool: 'ghost' }],
        }),
        namePoolIds: new Set(['frontier']),
        archetypeIds: new Set(['vanguard']),
        personalityIds: new Set(['stoic']),
        reputationMax: 100,
      }),
    ).toThrow(/does not exist/);
  });

  it('rejects two origins that are indistinguishable (REQ-RCT-002)', () => {
    // Same names and same biases is one origin with two labels.
    expect(() =>
      crossValidateRecruitment({
        recruitment: parseRecruitment({
          ...base,
          origins: [
            base.origins[0],
            { ...base.origins[0], id: 'b', name: 'B' },
          ],
        }),
        namePoolIds: new Set(['frontier']),
        archetypeIds: new Set(['vanguard']),
        personalityIds: new Set(['stoic']),
        reputationMax: 100,
      }),
    ).toThrow(/indistinguishable/);
  });

  it('rejects a bias naming an archetype that does not exist', () => {
    // It would be silently ignored, so the pool would quietly fail to differ.
    expect(() =>
      crossValidateRecruitment({
        recruitment: parseRecruitment({
          ...base,
          origins: [{ ...base.origins[0], archetypeBias: { wizard: 2 } }],
        }),
        namePoolIds: new Set(['frontier']),
        archetypeIds: new Set(['vanguard']),
        personalityIds: new Set(['stoic']),
        reputationMax: 100,
      }),
    ).toThrow(/not an archetype/);
  });

  it('loads the authored origins', () => {
    const { session } = testSession();
    expect(session.content.recruitment.origins.length).toBeGreaterThan(2);
  });
});

describe('save v9', () => {
  it('keeps the same people waiting across a reload', () => {
    // A candidate is a whole hunter, so redrawing on load would replace the people standing
    // in front of the player with different people.
    const harness = guildWithHall('save-recruit');
    harness.commands.refreshRecruits();
    const before = harness.session.recruitment.available().map((c) => c.hunter.id);
    expect(before.length).toBeGreaterThan(0);

    expect(harness.commands.saveGuild('slot').ok).toBe(true);
    expect(harness.commands.loadGuild('slot').ok).toBe(true);

    expect(harness.session.recruitment.available().map((c) => c.hunter.id)).toEqual(before);
  });

  it('migrates a v8 save to an empty hall with a refresh due at once', () => {
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
      },
      8,
      CURRENT_SAVE_VERSION,
    ) as Record<string, unknown>;

    expect(migrated['recruitment']).toEqual({ candidates: [], nextRefreshTick: 0 });
  });
});

/**
 * Draw one archetype under a bias, using a stream forked per iteration so the sweep is
 * deterministic and does not consume the session's own recruit stream.
 */
function pickBiased(
  session: Session,
  bias: Readonly<Record<string, number>>,
  seed: number,
): string | undefined {
  const ids = session.content.archetypes.map((a) => a.id);
  const rng = createRng(`bias:${seed}`);
  const weights = ids.map((id) => Math.max(0, bias[id] ?? 1));
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return ids[0];

  let roll = rng.next() * total;
  for (let i = 0; i < ids.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return ids[i];
  }
  return ids[ids.length - 1];
}
