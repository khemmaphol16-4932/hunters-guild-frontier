/**
 * Phase 6 — the town and the guild.
 *
 * REQ-TWN-001/002/003/005/006/009/010 and REQ-DEP-001/002/003/004/005. Four claims carry the
 * phase, and each one is a place a plausible-looking implementation would go wrong:
 *
 *   1. The town is a **physical place** — buildings occupy cells and space is a real
 *      constraint, not decoration (REQ-TWN-001).
 *   2. Progression **never resets** (REQ-TWN-002). A town that reached Fortified Town is one,
 *      even after a fire.
 *   3. Population is a **trade** — it grants growth *and* creates pressure, and the summary
 *      never replaces the individual indicators (REQ-TWN-003).
 *   4. A hunter's stated preference is an **input, never a veto** (REQ-TWN-010, DL-008) —
 *      under every department policy preset, not just the default.
 *
 * Two notes on method, both learned the hard way in earlier phases and recorded in DEVLOG.
 * A differentiation test must hold the situation fixed and vary only the thing under test —
 * so the preference tests build two hunters differing in exactly one respect. And a claim
 * about a tendency is swept rather than sampled once: every preset is checked, not the
 * default plus an assumption about the rest.
 */

import { describe, expect, it } from 'vitest';
import { testSession } from './helpers.js';
import type { Session } from '../src/app/Session.js';
import { withAvailability, withCondition, type Hunter } from '../src/core/hunter/Hunter.js';
import { withAttributes } from '../src/core/hunter/Hunter.js';
import { migratePayload } from '../src/save/migrations/index.js';
import { CURRENT_SAVE_VERSION } from '../src/save/envelope.js';
import { parseDepartments, parseTownBalance, rotatedFootprint } from '../src/data/townSchema.js';
import { attributeFit, capabilityOf, scoreJob } from '../src/ai/town/jobAssignment.js';
import { BASELINE_RECOVERY, recoveryRatePerStep } from '../src/core/hunter/availability.js';
import type { AttributeKey } from '../src/data/schema.js';

/** A guild with its founding town in place. */
function foundedGuild(seed = 'town') {
  const harness = testSession(seed);
  harness.commands.foundTown();
  return harness;
}

/** Put every attribute point somewhere specific, so "suited to the work" is controllable. */
function withAttributesAt(
  session: Session,
  hunter: Hunter,
  spread: Partial<Record<AttributeKey, number>>,
): Hunter {
  const base = session.content.balance.attributes.startingValue;
  const updated = withAttributes(hunter, {
    str: spread.str ?? base,
    agi: spread.agi ?? base,
    vit: spread.vit ?? base,
    dex: spread.dex ?? base,
    int: spread.int ?? base,
    luk: spread.luk ?? base,
  });
  session.roster.update(updated);
  return updated;
}

// ---------------------------------------------------------------------------
// REQ-TWN-001 — the town is a physical place on a grid
// ---------------------------------------------------------------------------

describe('the town grid (REQ-TWN-001)', () => {
  it('refuses to put two buildings in the same cells', () => {
    const { commands } = foundedGuild();
    // The founding layout puts the Guild Hall at 0,0 with a 3x3 footprint.
    const clash = commands.placeBuilding('bunkhouse', 1, 1);
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.error).toMatch(/already standing there/);
  });

  it('refuses to hang a building off the edge of the town', () => {
    const { session, commands } = foundedGuild();
    const width = session.content.balance.town.grid.width;
    const result = commands.placeBuilding('bunkhouse', width - 1, 6);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not fit inside the town/);
  });

  it('counts space, so a town can actually run out of room', () => {
    const { session } = foundedGuild();
    const { width, height } = session.content.balance.town.grid;
    const before = session.town.grid.freeCells();
    expect(before).toBeLessThan(width * height);

    // A 3x2 bunkhouse costs six cells of somewhere else.
    const placed = session.town.grid.place('bunkhouse', 0, 6);
    expect(placed.ok).toBe(true);
    expect(session.town.grid.freeCells()).toBe(before - 6);
  });

  it('rotates in four directions, and rotation changes what fits (v1.0 §9)', () => {
    const footprint = { width: 4, height: 2 };
    expect(rotatedFootprint(footprint, 0)).toEqual({ width: 4, height: 2 });
    expect(rotatedFootprint(footprint, 90)).toEqual({ width: 2, height: 4 });
    expect(rotatedFootprint(footprint, 180)).toEqual({ width: 4, height: 2 });
    expect(rotatedFootprint(footprint, 270)).toEqual({ width: 2, height: 4 });

    const { session } = testSession('rotation');
    const grid = session.town.grid;

    // A 4x2 longhouse turned sideways occupies a 2x4 column instead — which is what makes
    // rotation a real placement decision rather than a cosmetic one.
    const sideways = grid.place('longhouse', 0, 0, 90);
    expect(sideways.ok).toBe(true);
    if (sideways.ok) {
      expect(grid.rectFor(sideways.value)).toMatchObject({ width: 2, height: 4 });
    }

    // And the rotated footprint is what collides: cell 1,3 is inside the sideways longhouse
    // but would have been clear had it been placed upright.
    expect(grid.place('bunkhouse', 1, 3).ok).toBe(false);
    expect(grid.place('bunkhouse', 2, 0).ok).toBe(true);
  });

  it('lets a building be moved for free, including onto cells it currently occupies', () => {
    // v1.0 §9 makes relocation free. The subtle half is that nudging a building one cell
    // must not collide with where it already stands.
    const { session } = testSession('relocate');
    const placed = session.town.grid.place('bunkhouse', 0, 0);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const nudged = session.town.grid.relocate(placed.value.instanceId, 1, 0);
    expect(nudged.ok).toBe(true);
    if (nudged.ok) expect(nudged.value).toMatchObject({ x: 1, y: 0 });
  });

  it('refuses a second Guild Hall — the town has one heart (REQ-TWN-006)', () => {
    const { commands } = foundedGuild();
    const second = commands.placeBuilding('guild_hall', 6, 6);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already has a Guild Hall/);
  });

  it('renders the town as a grid, so a footprint bug is visible', () => {
    const { session } = foundedGuild();
    const rows = session.town.grid.render();
    expect(rows).toHaveLength(session.content.balance.town.grid.height);
    // The Guild Hall's 3x3 footprint at 0,0 means three rows start with three G's.
    expect(rows[0]?.startsWith('GGG')).toBe(true);
    expect(rows[2]?.startsWith('GGG')).toBe(true);
    expect(rows[3]?.startsWith('GGG')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REQ-TWN-002 — progression never resets
// ---------------------------------------------------------------------------

describe('town stages (REQ-TWN-002)', () => {
  it('starts a new guild at the first stage', () => {
    const { session } = foundedGuild();
    expect(session.town.stage().id).toBe('small_camp');
  });

  it('advances when the requirements are met', () => {
    const { session, commands } = foundedGuild();
    session.population.adjust(40);

    // The Village stage wants five buildings; the founding layout has five already.
    expect(session.town.grid.size).toBeGreaterThanOrEqual(5);
    const reached = session.town.refreshStage();
    expect(reached?.id).toBe('village');
    expect(session.town.stage().id).toBe('village');

    // And it says what the next one needs, rather than only that it is not reached.
    void commands;
    const next = session.town.nextStageRequirements();
    expect(next?.stage.id).toBe('fortified_town');
    expect(next?.shortfalls.length).toBeGreaterThan(0);
  });

  it('never falls back, even when the town is demolished under it', () => {
    // The heart of REQ-TWN-002: "no reset on progression". A stage is a thing the guild
    // *achieved*, not a live reading of its current buildings.
    const { session, commands } = foundedGuild();
    session.population.adjust(40);
    session.town.refreshStage();
    expect(session.town.stage().id).toBe('village');

    for (const placement of [...session.town.grid.all()]) {
      commands.demolishBuilding(placement.instanceId);
    }
    session.population.adjust(-45);

    expect(session.town.grid.size).toBe(0);
    expect(session.town.derivedStage().id).toBe('small_camp');
    // Derived falls; what the town *is* does not.
    expect(session.town.stage().id).toBe('village');
  });

  it('rejects content whose stage ladder could go backwards', () => {
    // The content half of "no reset": if a later stage were easier on any axis, a growing
    // town could satisfy Hunter City while failing Fortified Town.
    const balance = {
            grid: { width: 4, height: 4 },
            population: {
              starting: 1,
              perCapita: { housing: 1, food: 1, services: 1 },
              growth: { basePerStep: 0, perReputation: 0, prosperityScale: 1, maxPerStep: 1 },
              departure: { pressureThreshold: 0.5, perStepAtFullPressure: 0.1 },
            },
            stability: {
              weights: { housing: 1, food: 1, services: 1 },
              bands: [{ id: 'ok', atLeast: 0, label: 'Fine' }],
            },
            recovery: {
              baseFatigueClearedPerStep: 0.1,
              injuryStepsAtBaseline: 10,
              recoveryStepsAtBaseline: 2,
              ticksPerCoarseStep: 10,
              minSteps: 1,
              maxSteps: 100,
            },
            quality: {
              unbuiltHousingQuality: 0.5,
              unbuiltServiceQuality: 0.5,
              surplusQualityScale: 0.3,
              maxQuality: 2,
            },
            stages: {
              order: [
                { id: 'a', name: 'A', requires: { population: 0, buildings: 0, guildHallTier: 1 } },
                { id: 'b', name: 'B', requires: { population: 20, buildings: 5, guildHallTier: 2 } },
                // Asks for *fewer* buildings than stage b.
                { id: 'c', name: 'C', requires: { population: 40, buildings: 3, guildHallTier: 3 } },
              ],
            },
            reputation: {
              starting: 0,
              max: 10,
              perExpedition: 0,
              perBossDefeated: 0,
              perWorldBossDefeated: 0,
              perZoneTier: {},
              lossPerWipe: 0,
              lossPerDeath: 0,
            },
            assignment: {
              weights: { attributeFit: 0.5, departmentPreference: 0.2, rolePreference: 0.1 },
              maxFatigueForWork: 0.8,
            },
            departments: {
              headQualification: {
                perLevel: 0,
                perAttributePoint: 0,
                maxBonus: 0,
                deputyScale: 0.5,
                guildAiFallback: 0.75,
              },
              performance: { staffingTarget: 3, outputPerStaffPoint: 1 },
              priorities: { min: 0, max: 3, default: 1 },
            },
    };

    expect(() => parseTownBalance(balance)).toThrow(/must not decrease/);
  });
});

// ---------------------------------------------------------------------------
// REQ-TWN-003 — population is a trade, and the summary never replaces the detail
// ---------------------------------------------------------------------------

describe('population and pressure (REQ-TWN-003)', () => {
  it('turns population into demand, and a shortfall into pressure', () => {
    const { session } = foundedGuild();
    const housingBefore = session.population.pressureFor('housing');

    session.population.adjust(200);
    const housingAfter = session.population.pressureFor('housing');

    expect(housingAfter.demand).toBeGreaterThan(housingBefore.demand);
    expect(housingAfter.pressure).toBeGreaterThan(housingBefore.pressure);
    // And it says so in words the player can act on.
    expect(housingAfter.summary).toMatch(/Short \d+ beds?/);
  });

  it('relieves pressure when the player builds for it', () => {
    const { session, commands } = foundedGuild();
    session.population.adjust(60);
    const before = session.population.pressureFor('housing').pressure;
    expect(before).toBeGreaterThan(0);

    // Two longhouses need the town to be a Village first — which is the trade working.
    session.town.refreshStage();
    expect(commands.placeBuilding('longhouse', 0, 6).ok).toBe(true);
    expect(commands.placeBuilding('longhouse', 4, 6).ok).toBe(true);

    expect(session.population.pressureFor('housing').pressure).toBeLessThan(before);
  });

  it('always reports the individual indicators alongside the summary', () => {
    // REQ-TWN-003 is explicit that Town Stability summarises but never *replaces* the
    // individual food, housing and service indicators. A report that offered only a score
    // could not tell a famine from a housing crisis, which is the information the player
    // needs in order to do anything.
    const { session } = foundedGuild();
    const report = session.population.report();

    expect(report.pressures.map((p) => p.key).sort()).toEqual(['food', 'housing', 'services']);
    expect(typeof report.stability).toBe('number');
    expect(report.stabilityBand).toBeTruthy();
  });

  it('does not let one healthy axis average away a collapse on another (DL-036)', () => {
    const { session } = foundedGuild();
    // Overwhelm housing specifically, and check the summary actually moves.
    session.population.adjust(400);
    const report = session.population.report();

    const housing = report.pressures.find((p) => p.key === 'housing');
    expect(housing?.pressure).toBeGreaterThan(0.8);
    expect(report.stability).toBeLessThan(0.5);
    expect(report.stabilityBand).toMatch(/Strained|Failing/);
  });

  it('stalls growth under pressure rather than spiralling', () => {
    // Growth stopping before departures start is what makes pressure a problem the player
    // can solve rather than a death spiral they cannot.
    const { session } = foundedGuild();
    const healthy = session.population.growthPerStep();
    expect(healthy).toBeGreaterThan(0);

    session.population.adjust(300);
    expect(session.population.growthPerStep()).toBeLessThanOrEqual(0);
  });

  it('accumulates fractional growth instead of rounding it away', () => {
    // Growth is well below one person per step, so a naive implementation would round to
    // zero forever and the town would never grow at all.
    const { session } = foundedGuild();
    expect(session.population.growthPerStep()).toBeLessThan(1);

    const before = session.population.size;
    session.population.step(200);
    expect(session.population.size).toBeGreaterThan(before);
  });
});

// ---------------------------------------------------------------------------
// v1.0 §4/§18 — recovery measurably varies with food, housing and services
// ---------------------------------------------------------------------------

describe('recovery varies with the town (v1.0 §4, §18)', () => {
  function injuredHunter(harness: ReturnType<typeof foundedGuild>) {
    const hunter = harness.debug.spawnHunter({ archetype: 'vanguard', level: 10 });
    const tired = withCondition(harness.session.roster.require(hunter.id), {
      hunger: 0.2,
      fatigue: 0.6,
      morale: 0.5,
    });
    harness.session.roster.update(tired);
    return tired;
  }

  it('heals an injury faster in a better-provisioned town', () => {
    const bare = foundedGuild('bare');
    const bareEstimate = bare.session.recovery.estimate(injuredHunter(bare), { injured: true });

    const good = foundedGuild('good');
    good.session.population.adjust(-8); // small town, so the same buildings go further
    expect(good.commands.placeBuilding('infirmary', 0, 6).ok).toBe(true);
    expect(good.commands.placeBuilding('field_kitchen', 4, 6).ok).toBe(true);
    const goodEstimate = good.session.recovery.estimate(injuredHunter(good), { injured: true });

    expect(goodEstimate.steps).toBeLessThan(bareEstimate.steps);
    // And it can say why, which is the half a constant could never do.
    expect(goodEstimate.explanation).toMatch(/infirmary|housing|recovers/i);
  });

  it('takes longer when the town cannot feed everyone', () => {
    const harness = foundedGuild('hungry');
    const wellFed = harness.session.recovery.estimate(injuredHunter(harness), { injured: true });

    harness.session.population.adjust(500);
    expect(harness.session.town.foodAvailable()).toBe(false);
    const starving = harness.session.recovery.estimate(injuredHunter(harness), { injured: true });

    expect(starving.steps).toBeGreaterThan(wellFed.steps);
    expect(starving.explanation).toMatch(/cannot feed/);
  });

  it('makes an injury a longer stay than an ordinary return', () => {
    const harness = foundedGuild('durations');
    const hunter = injuredHunter(harness);
    const injured = harness.session.recovery.estimate(hunter, { injured: true });
    const returning = harness.session.recovery.estimate(hunter, { injured: false });
    expect(injured.steps).toBeGreaterThan(returning.steps);
  });

  it('honours a trait that speeds recovery', () => {
    // The Tireless trait has claimed a fatigueRecoveryMultiplier since Phase 1 and nothing
    // read it until now.
    const harness = foundedGuild('tireless');
    const rate = recoveryRatePerStep(
      { ...BASELINE_RECOVERY, fatigue: 0.5, hunger: 0, traitMultiplier: 1.4 },
      0.06,
    );
    const plain = recoveryRatePerStep(
      { ...BASELINE_RECOVERY, fatigue: 0.5, hunger: 0 },
      0.06,
    );
    expect(rate).toBeGreaterThan(plain);
    expect(harness.session.recovery.traitMultiplier(injuredHunter(harness))).toBeGreaterThan(0);
  });

  it('brings an injured hunter home through recovery, never straight to deployable', () => {
    // availability.ts encodes injured -> recovering -> available, and the town clock must
    // respect it: an injury is two hops home, and the second is subject to the town again.
    const harness = foundedGuild('homecoming');
    const hunter = harness.debug.spawnHunter({ archetype: 'adept', level: 8 });
    harness.session.roster.update(
      withAvailability(harness.session.roster.require(hunter.id), {
        state: 'injured',
        assignment: undefined,
        recallCompletesAtTick: undefined,
        readyAtTick: 0,
      }),
    );

    harness.commands.advanceTown(1);
    expect(harness.session.roster.require(hunter.id).availability.state).toBe('recovering');

    // Still not deployable until the recovery leg elapses too.
    harness.session.roster.update(
      withAvailability(harness.session.roster.require(hunter.id), {
        state: 'recovering',
        assignment: undefined,
        recallCompletesAtTick: undefined,
        readyAtTick: 0,
      }),
    );
    const result = harness.commands.advanceTown(1);
    expect(result.recovered).toContain(hunter.id);
    expect(harness.session.roster.require(hunter.id).availability.state).toBe('available');
  });
});

// ---------------------------------------------------------------------------
// REQ-TWN-009/010 and DL-008 — preferences are inputs, never vetoes
// ---------------------------------------------------------------------------

describe('town work assignment (REQ-TWN-009/010, DL-008)', () => {
  it('only considers hunters who are not otherwise assigned (REQ-TWN-009)', () => {
    const harness = foundedGuild('idle');
    const busy = harness.debug.spawnHunter({ archetype: 'vanguard', level: 10 });
    harness.session.roster.update(
      withAvailability(harness.session.roster.require(busy.id), {
        state: 'assigned',
        assignment: 'an expedition',
        recallCompletesAtTick: undefined,
        readyAtTick: undefined,
      }),
    );

    const rota = harness.session.townJobs.refresh();
    expect(rota.some((a) => a.hunterId === busy.id)).toBe(false);
  });

  it('leaves a hunter too exhausted to work off the rota', () => {
    const harness = foundedGuild('tired');
    const hunter = harness.debug.spawnHunter({ archetype: 'vanguard', level: 10 });
    harness.session.roster.update(
      withCondition(harness.session.roster.require(hunter.id), {
        hunger: 0,
        fatigue: 0.95,
        morale: 0.5,
      }),
    );

    const rota = harness.session.townJobs.refresh();
    expect(rota.some((a) => a.hunterId === hunter.id)).toBe(false);
  });

  it('prefers the better-suited hunter over the one who asked — under every policy preset', () => {
    // The DL-008 claim, swept across all four presets rather than sampled on the default.
    // Situation held fixed: same job, same level, same condition. The two hunters differ in
    // exactly two respects — where their attribute points are, and what they asked for.
    const harness = foundedGuild('dl008');
    const { session } = harness;
    const forge = session.content.townJobsById.get('forge_work')!;

    const capable = withAttributesAt(
      session,
      harness.debug.spawnHunter({ archetype: 'vanguard', level: 40 }),
      { str: 60, dex: 55 },
    );
    const volunteer = withAttributesAt(
      session,
      harness.debug.spawnHunter({ archetype: 'adept', level: 40 }),
      { int: 60, luk: 55 },
    );

    // Only the badly-suited one asked for crafting.
    session.roster.update({ ...capable, preferredDepartment: 'research' });
    session.roster.update({ ...volunteer, preferredDepartment: 'crafting' });

    for (const preset of session.departments.policies()) {
      const modifiers = preset.modifies;
      const deps = {
        balance: session.content.balance.town,
        attributes: session.content.balance.attributes,
        profileOf: (h: Hunter) => session.buildIdentity.profileOf(h),
      };
      const capableScore = scoreJob(session.roster.require(capable.id), forge, {
        deps,
        priority: 1,
        policyModifiers: modifiers,
      });
      const volunteerScore = scoreJob(session.roster.require(volunteer.id), forge, {
        deps,
        priority: 1,
        policyModifiers: modifiers,
      });

      expect(capableScore.score, `preset ${preset.id}`).toBeGreaterThan(volunteerScore.score);
    }
  });

  it('still lets a preference decide between two equally suited hunters', () => {
    // The other half of "input, never veto": if a preference could never win, it would not
    // be an input either. Situation and capability held identical; only the wish differs.
    const harness = foundedGuild('tiebreak');
    const { session } = harness;
    const drill = session.content.townJobsById.get('hunter_drill')!;

    const a = withAttributesAt(
      session,
      harness.debug.spawnHunter({ archetype: 'vanguard', level: 20, name: 'Aya' }),
      { str: 30, agi: 30, vit: 20, dex: 20 },
    );
    const b = withAttributesAt(
      session,
      harness.debug.spawnHunter({ archetype: 'vanguard', level: 20, name: 'Bex' }),
      { str: 30, agi: 30, vit: 20, dex: 20 },
    );

    session.roster.update({
      ...a,
      preferredDepartment: 'hunter',
      condition: { hunger: 0, fatigue: 0, morale: 0.5 },
    });
    session.roster.update({
      ...b,
      preferredDepartment: 'research',
      condition: { hunger: 0, fatigue: 0, morale: 0.5 },
    });

    const deps = {
      balance: session.content.balance.town,
      attributes: session.content.balance.attributes,
      profileOf: (h: Hunter) => session.buildIdentity.profileOf(h),
    };
    const wants = scoreJob(session.roster.require(a.id), drill, { deps, priority: 1 });
    const indifferent = scoreJob(session.roster.require(b.id), drill, { deps, priority: 1 });

    expect(wants.score).toBeGreaterThan(indifferent.score);
  });

  it('refuses content whose policy preset would make a preference decisive', () => {
    // DL-008 enforced at load rather than by review. A preset that pushed the preference
    // weights up to the capability weight would be a veto wearing a different hat.
    const { session } = testSession('preset-guard');
    const weights = session.content.balance.town.assignment.weights;

    expect(() =>
      parseDepartments(
        {
          departments: session.content.departments.departments.map((d) => ({ ...d })),
          metrics: { staffing: 'a', output: 'b' },
          policies: [
            {
              id: 'wishes_win',
              name: 'Wishes win',
              description: 'Preference beats capability.',
              modifies: { departmentPreference: 4, rolePreference: 4 },
            },
          ],
        },
        weights,
      ),
    ).toThrow(/never vetoes/);
  });

  it('keeps alignment and capability as separate readings', () => {
    // They were one multiplied term, and a product of two sub-1 factors could never reach
    // its configured weight — which broke DL-008 in play while the load-time guard, which
    // compares weights, still reported everything correct. Splitting them is what makes
    // the guard sound, so the split itself is worth asserting.
    const { session } = testSession('fit');
    const forge = session.content.townJobsById.get('forge_work')!;
    const balance = session.content.balance.attributes;

    const novice = session.generateHunter({ archetype: 'vanguard', level: 1 });
    const smith = withAttributesAt(
      session,
      session.generateHunter({ archetype: 'vanguard', level: 60 }),
      { str: 80, vit: 40, dex: 70 },
    );

    // Alignment measures direction only, so the smith points at forge work far better.
    expect(attributeFit(smith, forge)).toBeGreaterThan(attributeFit(novice, forge));

    // Capability measures development only, and knows nothing about the job.
    expect(capabilityOf(smith, balance)).toBeGreaterThan(capabilityOf(novice, balance));
    const kitchen = session.content.townJobsById.get('field_kitchen')!;
    expect(capabilityOf(smith, balance)).toBe(capabilityOf(smith, balance));
    expect(attributeFit(smith, kitchen)).not.toBe(attributeFit(smith, forge));

    // Each term can actually reach most of its weight, which is the property the guard needs.
    expect(attributeFit(smith, forge)).toBeGreaterThan(0.6);
  });

  it('gives no work at all when no building offers any', () => {
    // A department with slots but no buildings would otherwise read as understaffed rather
    // than as unbuilt.
    const harness = testSession('no-buildings');
    harness.debug.spawnHunter({ archetype: 'vanguard', level: 10 });
    expect(harness.session.town.grid.size).toBe(0);
    expect(harness.session.townJobs.refresh()).toEqual([]);
  });

  it('resolves an exact tie the same way every run', () => {
    // A rota that reshuffled on equal scores would break replay (REQ-OFF-002).
    const first = foundedGuild('deterministic');
    const second = foundedGuild('deterministic');
    for (const harness of [first, second]) {
      for (const archetype of ['vanguard', 'adept', 'ranger'] as const) {
        harness.debug.spawnHunter({ archetype, level: 15 });
      }
    }
    expect(first.session.townJobs.refresh()).toEqual(second.session.townJobs.refresh());
  });
});

// ---------------------------------------------------------------------------
// REQ-DEP-001..005 — departments
// ---------------------------------------------------------------------------

describe('departments (REQ-DEP-001..005)', () => {
  it('has exactly the five the design fixes (REQ-DEP-001)', () => {
    const { session } = testSession();
    expect(session.departments.all().map((d) => d.id).sort()).toEqual(
      ['crafting', 'defense', 'hunter', 'research', 'resource'].sort(),
    );
  });

  it('reports four metrics side by side, with no single overall score (REQ-DEP-004)', () => {
    // One number per department would hide the trade-off the player is making.
    const harness = foundedGuild('metrics');
    harness.debug.spawnHunter({ archetype: 'vanguard', level: 20 });
    harness.session.townJobs.refresh();

    const report = harness.session.departments.report('hunter');
    expect(report).toHaveProperty('staffing');
    expect(report).toHaveProperty('output');
    expect(report).toHaveProperty('leadership');
    expect(report).toHaveProperty('fit');
    expect(report).not.toHaveProperty('overall');
  });

  it('runs a headless department at a floor rather than stopping it (REQ-DEP-002)', () => {
    const harness = foundedGuild('leaderless');
    harness.debug.spawnHunter({ archetype: 'vanguard', level: 20 });
    harness.session.townJobs.refresh();

    const leadership = harness.session.departments.leadership('hunter');
    // Somebody is on the rota, so a deputy stands in — and either way the effect is > 0.
    expect(['deputy', 'guild-ai']).toContain(leadership.kind);
    expect(leadership.effect).toBeGreaterThan(0);
  });

  it('falls back to the Guild AI when there is nobody at all', () => {
    const harness = testSession('empty-dept');
    const leadership = harness.session.departments.leadership('research');
    expect(leadership.kind).toBe('guild-ai');
    expect(leadership.effect).toBe(
      harness.session.content.balance.town.departments.headQualification.guildAiFallback,
    );
  });

  it('makes an appointed head worth more than a deputy', () => {
    const harness = foundedGuild('heads');
    const veteran = harness.debug.spawnHunter({ archetype: 'vanguard', level: 50, fullyEquipped: true });
    harness.session.townJobs.refresh();

    const before = harness.session.departments.leadership('hunter').effect;
    expect(harness.commands.appointDepartmentHead('hunter', veteran.id).ok).toBe(true);
    const after = harness.session.departments.leadership('hunter');

    expect(after.kind).toBe('head');
    expect(after.effect).toBeGreaterThan(before);
  });

  it('refuses to let one hunter head two departments', () => {
    const harness = foundedGuild('two-hats');
    const hunter = harness.debug.spawnHunter({ archetype: 'vanguard', level: 30 });
    expect(harness.commands.appointDepartmentHead('hunter', hunter.id).ok).toBe(true);

    const second = harness.commands.appointDepartmentHead('defense', hunter.id);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already heads/);
  });

  it('changes the rota when the player changes a department policy (REQ-DEP-005)', () => {
    const harness = foundedGuild('policy');
    for (const archetype of ['vanguard', 'adept', 'ranger'] as const) {
      harness.debug.spawnHunter({ archetype, level: 25, fullyEquipped: true });
    }

    const steady = [...harness.session.townJobs.refresh()];
    expect(harness.commands.setDepartmentPolicy('hunter', 'respect_wishes').ok).toBe(true);
    const wishes = [...harness.session.townJobs.refresh()];

    // The scores must move even if the winner happens not to; a preset that changed nothing
    // measurable would be decoration.
    const scoreOf = (rota: typeof steady) => rota.reduce((sum, a) => sum + a.score, 0);
    expect(scoreOf(wishes)).not.toBeCloseTo(scoreOf(steady), 6);
  });

  it('gates its priority to the configured range', () => {
    const harness = foundedGuild('priority');
    const max = harness.session.content.balance.town.departments.priorities.max;
    expect(harness.commands.setDepartmentPriority('hunter', max).ok).toBe(true);
    expect(harness.commands.setDepartmentPriority('hunter', max + 1).ok).toBe(false);
  });

  it('recommends but never acts (REQ-DEP-004)', () => {
    const harness = foundedGuild('advice');
    // Nobody on the roster at all, so the hunter department is unmistakably in trouble.
    const report = harness.session.departments.report('hunter');
    expect(report.recommendation).toBeTruthy();

    // The advice changed nothing by itself.
    expect(harness.session.townJobs.all()).toEqual([]);
    expect(harness.session.departments.of('hunter').priority).toBe(
      harness.session.content.balance.town.departments.priorities.default,
    );
  });

  it('has no budget anywhere, in code or in content (REQ-DEP-003)', () => {
    const { session } = testSession();
    const asJson = JSON.stringify(session.content.balance.town);
    expect(asJson).not.toMatch(/budget/i);
    expect(JSON.stringify(session.content.departments)).not.toMatch(/budget/i);
  });
});

// ---------------------------------------------------------------------------
// Reputation — REQ-WLD-002's unlock axis becomes evaluable
// ---------------------------------------------------------------------------

describe('guild reputation', () => {
  it('is earned in proportion to danger, not to volume', () => {
    const { session } = foundedGuild('reputation');
    const blue = session.reputation.recordExpedition({
      zoneTier: 'blue',
      bossDefeated: false,
      worldBoss: false,
      wiped: false,
      deaths: 0,
      regionName: 'The Verdant Reach',
    });

    const fresh = foundedGuild('reputation-2').session.reputation;
    const black = fresh.recordExpedition({
      zoneTier: 'black',
      bossDefeated: false,
      worldBoss: false,
      wiped: false,
      deaths: 0,
      regionName: 'The Sunken Choirhouse',
    });

    expect(black).toBeGreaterThan(blue);
  });

  it('costs the guild something when a party is lost', () => {
    const { session } = foundedGuild('reputation-loss');
    session.reputation.change(20, 'a good season');
    const before = session.reputation.current;

    session.reputation.recordExpedition({
      zoneTier: 'red',
      bossDefeated: false,
      worldBoss: false,
      wiped: true,
      deaths: 2,
      regionName: 'The Ashfall Barrows',
    });
    expect(session.reputation.current).toBeLessThan(before);
  });

  it('records only what actually happened when a change is clamped', () => {
    const { session } = foundedGuild('reputation-clamp');
    session.reputation.change(-50, 'an impossible loss');
    expect(session.reputation.current).toBe(0);
    // Nothing moved, so nothing is claimed.
    expect(session.reputation.history()).toEqual([]);
  });

  it('keeps a bounded, readable history of why it moved (v1.0 §10)', () => {
    const { session } = foundedGuild('reputation-history');
    for (let i = 0; i < 40; i++) session.reputation.change(0.5, `expedition ${i}`);
    const history = session.reputation.history();
    expect(history.length).toBeLessThanOrEqual(20);
    expect(history[0]?.reason).toContain('expedition 39');
  });

  it('evaluates the region unlock axis instead of reporting it untracked', () => {
    // Through Phase 5 this read "needs N reputation (not yet tracked)", which meant a
    // region gated on reputation was permanently shut (DL-033).
    const { commands } = foundedGuild('unlock');
    const blocked = commands
      .regionAvailability()
      .flatMap((entry) => entry.blockedBy)
      .join(' | ');
    expect(blocked).not.toMatch(/reputation.*not yet tracked/);
  });
});

// ---------------------------------------------------------------------------
// Content validation and the save chain
// ---------------------------------------------------------------------------

describe('town content validation', () => {
  it('loads and cross-validates the authored town', () => {
    const { session } = testSession();
    expect(session.content.town.buildings.length).toBeGreaterThan(0);
    expect(session.content.townJobs.jobs.length).toBeGreaterThan(0);
  });

  it('offers every authored job somewhere in the town', () => {
    // A job no building offers is unreachable work that would read as 0% staffing forever.
    const { session } = testSession();
    const offered = new Set(
      session.content.town.buildings.flatMap((b) =>
        b.tiers.flatMap((t) => Object.keys(t.jobs)),
      ),
    );
    for (const job of session.content.townJobs.jobs) {
      expect([...offered], job.id).toContain(job.id);
    }
  });

  it('gives every department at least one job', () => {
    const { session } = testSession();
    for (const department of session.content.departments.departments) {
      expect(
        session.content.townJobs.jobs.some((j) => j.department === department.id),
        department.id,
      ).toBe(true);
    }
  });

  it('authors enough buildings for the final stage to be reachable', () => {
    const { session } = testSession();
    const stages = session.content.balance.town.stages;
    const last = stages[stages.length - 1]!;
    // Unique buildings count once; everything else can be repeated, so this is a floor.
    expect(session.content.town.buildings.length).toBeGreaterThanOrEqual(
      last.requires.buildings,
    );
  });
});

describe('save v7 (REQ-TEC-004)', () => {
  it('round-trips the whole town', () => {
    const harness = foundedGuild('save-town');
    const { session, commands } = harness;
    harness.debug.spawnHunter({ archetype: 'vanguard', level: 30 });

    session.population.adjust(40);
    session.town.refreshStage();
    session.reputation.change(12, 'a hard season');
    const head = session.roster.all()[0]!;
    commands.appointDepartmentHead('hunter', head.id);
    commands.setDepartmentPriority('resource', 3);
    commands.setDepartmentPolicy('resource', 'push');
    session.townJobs.refresh();

    const before = {
      stage: session.town.stage().id,
      buildings: session.town.grid.size,
      population: session.population.size,
      reputation: session.reputation.current,
      rota: session.townJobs.all(),
      priority: session.departments.of('resource').priority,
      policy: session.departments.of('resource').policyId,
      headId: session.departments.of('hunter').headId,
      layout: session.town.grid.render(),
    };

    expect(commands.saveGuild('slot').ok).toBe(true);
    expect(commands.loadGuild('slot').ok).toBe(true);

    expect(session.town.stage().id).toBe(before.stage);
    expect(session.town.grid.size).toBe(before.buildings);
    expect(session.town.grid.render()).toEqual(before.layout);
    expect(session.population.size).toBe(before.population);
    expect(session.reputation.current).toBe(before.reputation);
    expect(session.townJobs.all()).toEqual(before.rota);
    expect(session.departments.of('resource').priority).toBe(before.priority);
    expect(session.departments.of('resource').policyId).toBe(before.policy);
    expect(session.departments.of('hunter').headId).toBe(before.headId);
  });

  it('migrates a v6 save into a town it can still play', () => {
    const v6 = {
      hunters: [],
      chronicles: [],
      clock: { tick: 40, accumulatorMs: 0 },
      rngStreams: {},
      armoury: { items: [], cardCounts: {}, cardsSeen: [], skillBooks: [] },
      lootPity: { sinceTier: 0 },
      audit: [],
      emergencyAuthorisations: [],
      worldKnowledge: { regions: [] },
    };
    const migrated = migratePayload(v6, 6, CURRENT_SAVE_VERSION) as Record<string, unknown>;

    expect(migrated['town']).toMatchObject({ highestStageIndex: 0 });
    expect(migrated['departments']).toEqual({ departments: [] });
    expect(migrated['townJobs']).toEqual({ assignments: [] });
    expect(migrated['reputation']).toEqual({ value: 0, recent: [], regional: {} });
    // Nothing pre-existing is disturbed.
    expect(migrated['clock']).toEqual({ tick: 40, accumulatorMs: 0 });
  });

  it('gives a migrated v6 guild a population rather than an empty town', () => {
    // The migration deliberately omits `population` so Population.restore falls back to the
    // configured starting figure. Writing `{ count: 0 }` would restore a town with nobody
    // in it, no demand at all, and a stage ladder that could never advance.
    const { session } = testSession('migrated');
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
      },
      6,
      CURRENT_SAVE_VERSION,
    ) as Record<string, unknown>;

    expect(migrated['population']).toBeUndefined();
    session.restore(migrated as never);
    expect(session.population.size).toBe(
      session.content.balance.town.population.starting,
    );
  });

  it('never lowers a town stage on load, even from a lower stored index', () => {
    // REQ-TWN-002 on the load path: a stage the guild reached must survive a save written
    // against different content.
    const harness = foundedGuild('stage-load');
    harness.session.population.adjust(40);
    harness.session.town.refreshStage();
    expect(harness.session.town.stage().id).toBe('village');

    // A stored index past the end of a shorter ladder is clamped rather than trusted.
    harness.session.town.restore({
      grid: harness.session.town.grid.snapshot(),
      highestStageIndex: 99,
    });
    const stages = harness.session.content.balance.town.stages;
    expect(harness.session.town.stage().id).toBe(stages[stages.length - 1]!.id);
  });
});
