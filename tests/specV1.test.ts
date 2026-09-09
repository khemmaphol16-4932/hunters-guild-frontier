/**
 * Master Build Specification v1.0 conformance.
 *
 * Each block cites the v1.0 section it protects. These are the tests that would fail if a
 * later change quietly reverted a v1.0 decision — particularly the emergency-override path,
 * which is the one change capable of turning "hard constraint" into "strong suggestion".
 */

import { describe, expect, it } from 'vitest';
import { testSession } from './helpers.js';
import { loadContent } from '../src/data/loader.js';
import { AuditLog, REASON } from '../src/core/audit.js';
import { SimulationClock } from '../src/core/clock.js';
import {
  EmergencyPolicy,
  type EmergencyAuthorisation,
} from '../src/ai/policy/emergency.js';
import {
  DecisionPipeline,
  basePriorityStage,
  hardConstraintStage,
  type Candidate,
  type HardConstraint,
  type WeightStage,
} from '../src/ai/policy/pipeline.js';
import {
  beginRecall,
  canTransition,
  completeRecall,
  describeAvailability,
  FRESH_AVAILABILITY,
  isDeployable,
  recoveryRatePerStep,
  stepsUntilRested,
  transition,
  BASELINE_RECOVERY,
} from '../src/core/hunter/availability.js';
import { generateBuildTags, composeTagPhrase } from '../src/systems/hunter/buildTags.js';
import { chronicleLevel, CHRONICLE_LEVELS } from '../src/systems/hunter/Chronicle.js';

const content = loadContent();

// ---------------------------------------------------------------------------
// §14 / §18 — audit and replay
// ---------------------------------------------------------------------------

describe('audit log (v1.0 §14, §18)', () => {
  const makeLog = (capacity?: number): AuditLog =>
    new AuditLog({
      currentTick: () => 42,
      policyVersion: () => '1.0.0',
      ...(capacity !== undefined ? { capacity } : {}),
    });

  it('records every field §14 requires', () => {
    const log = makeLog();
    const entry = log.record({
      actor: { kind: 'hunter', id: 'hun_1' },
      system: 'ai/policy',
      sourceEvent: 'combat.nearDeath',
      seed: { stream: 'combat', state: 'abc123' },
      inputs: { hp: 0.12 },
      outcome: 'retreated',
      reasonCodes: [REASON.retreatThresholdReached],
    });

    expect(entry.gameTick).toBe(42);
    expect(entry.policyVersion).toBe('1.0.0');
    expect(entry.actor).toEqual({ kind: 'hunter', id: 'hun_1' });
    expect(entry.system).toBe('ai/policy');
    expect(entry.sourceEvent).toBe('combat.nearDeath');
    expect(entry.seed).toEqual({ stream: 'combat', state: 'abc123' });
    expect(entry.inputs).toEqual({ hp: 0.12 });
    expect(entry.outcome).toBe('retreated');
    expect(entry.reasonCodes).toEqual([REASON.retreatThresholdReached]);
  });

  it('refuses an entry with no reason code', () => {
    // §18 requires every important action to be explainable. An entry that says what
    // happened but not why is coverage theatre, so it is rejected rather than stored.
    const log = makeLog();
    expect(() =>
      log.record({
        actor: { kind: 'system', name: 'guild' },
        system: 'guild',
        outcome: 'something happened',
        reasonCodes: [],
      }),
    ).toThrow(/without a reason code/);
  });

  it('queries by actor, system and reason code', () => {
    const log = makeLog();
    log.record({
      actor: { kind: 'hunter', id: 'a' },
      system: 'ai/policy',
      outcome: 'acted',
      reasonCodes: [REASON.utilityBestScore],
    });
    log.record({
      actor: { kind: 'hunter', id: 'b' },
      system: 'items/refinement',
      outcome: 'destroyed',
      reasonCodes: [REASON.refinementDestroyed],
    });

    expect(log.query({ actorId: 'a' })).toHaveLength(1);
    expect(log.query({ system: 'items/refinement' })).toHaveLength(1);
    expect(log.query({ reasonCode: REASON.refinementDestroyed })).toHaveLength(1);
    expect(log.forHunter('b')[0]?.outcome).toBe('destroyed');
  });

  it('returns newest first', () => {
    const log = makeLog();
    log.record({ actor: { kind: 'system', name: 's' }, system: 's', outcome: 'first', reasonCodes: ['x'] });
    log.record({ actor: { kind: 'system', name: 's' }, system: 's', outcome: 'second', reasonCodes: ['x'] });
    expect(log.query()[0]?.outcome).toBe('second');
  });

  it('stays bounded, evicting oldest first', () => {
    const log = makeLog(3);
    for (let i = 0; i < 10; i++) {
      log.record({
        actor: { kind: 'system', name: 's' },
        system: 's',
        outcome: `entry-${i}`,
        reasonCodes: ['x'],
      });
    }
    expect(log.size).toBe(3);
    expect(log.all()[0]?.outcome).toBe('entry-7');
  });

  it('round-trips through save', () => {
    const log = makeLog();
    log.record({ actor: { kind: 'system', name: 's' }, system: 's', outcome: 'kept', reasonCodes: ['x'] });

    const restored = makeLog();
    restored.restore(log.snapshot());
    expect(restored.all()).toEqual(log.all());
  });
});

// ---------------------------------------------------------------------------
// §2.1 / §18 — emergency overrides
// ---------------------------------------------------------------------------

describe('emergency overrides (v1.0 §2.1, §18)', () => {
  const authorisation: EmergencyAuthorisation = {
    id: 'rescue_over_retreat',
    constraintId: 'retreat_threshold',
    trigger: 'allyDowned',
    author: 'player',
    rationale: 'Never abandon a downed hunter, even below the retreat threshold.',
  };

  it('refuses an authorisation that is not player-authored', () => {
    const policy = new EmergencyPolicy();
    expect(() =>
      policy.authorise({ ...authorisation, author: 'ai' as unknown as 'player' }),
    ).toThrow(/not player-authored/);
  });

  it('permits only the exact constraint it names — there is no wildcard', () => {
    const policy = new EmergencyPolicy();
    policy.authorise(authorisation);

    expect(policy.permits('retreat_threshold', { activeTriggers: ['allyDowned'] })).toBeDefined();
    expect(policy.permits('forbidden_zone', { activeTriggers: ['allyDowned'] })).toBeUndefined();
  });

  it('permits only while its trigger is active', () => {
    const policy = new EmergencyPolicy();
    policy.authorise(authorisation);

    expect(policy.permits('retreat_threshold', { activeTriggers: [] })).toBeUndefined();
    expect(
      policy.permits('retreat_threshold', { activeTriggers: ['selfAboutToDie'] }),
    ).toBeUndefined();
  });

  it('drops non-player authorisations when restoring a tampered save', () => {
    const policy = new EmergencyPolicy();
    policy.restore([authorisation, { ...authorisation, id: 'forged', author: 'ai' as unknown as 'player' }]);
    expect(policy.size).toBe(1);
    expect(policy.all()[0]?.id).toBe('rescue_over_retreat');
  });
});

describe('pipeline honours the override path only when authorised (v1.0 §2.1)', () => {
  interface Action extends Candidate {
    readonly id: string;
    readonly kind: 'attack' | 'retreat' | 'rescue';
    readonly basePriority: number;
  }
  interface Context {
    readonly belowRetreatThreshold: boolean;
    readonly allyDowned: boolean;
  }

  const actions: Action[] = [
    { id: 'rescue', kind: 'rescue', basePriority: 90 },
    { id: 'fall-back', kind: 'retreat', basePriority: 10 },
  ];

  const retreatConstraint: HardConstraint<Action, Context> = {
    id: 'retreat_threshold',
    describe: 'Guild policy requires retreat below the configured threshold',
    permits: (candidate, ctx) => !ctx.belowRetreatThreshold || candidate.kind === 'retreat',
  };

  const noWeight: WeightStage<Action, Context> = { name: 'none', weigh: () => 0 };

  const build = (policy: EmergencyPolicy, onOverride?: () => void): DecisionPipeline<Action, Context> =>
    new DecisionPipeline<Action, Context>({
      filters: [
        hardConstraintStage([retreatConstraint], {
          policy,
          contextFor: (ctx) => ({ activeTriggers: ctx.allyDowned ? ['allyDowned'] : [] }),
          ...(onOverride ? { onOverride } : {}),
        }),
      ],
      weights: [basePriorityStage<Action, Context>(), noWeight],
    });

  it('still vetoes when no authorisation exists', () => {
    const decision = build(new EmergencyPolicy()).evaluate(actions, {
      belowRetreatThreshold: true,
      allyDowned: true,
    });
    expect(decision.chosen?.kind).toBe('retreat');
  });

  it('permits the rescue when the player authorised exactly that', () => {
    const policy = new EmergencyPolicy();
    policy.authorise({
      id: 'rescue_over_retreat',
      constraintId: 'retreat_threshold',
      trigger: 'allyDowned',
      author: 'player',
      rationale: 'Never abandon a downed hunter.',
    });

    const decision = build(policy).evaluate(actions, {
      belowRetreatThreshold: true,
      allyDowned: true,
    });
    expect(decision.chosen?.id).toBe('rescue');
  });

  it('still vetoes when the authorised trigger is not active', () => {
    const policy = new EmergencyPolicy();
    policy.authorise({
      id: 'rescue_over_retreat',
      constraintId: 'retreat_threshold',
      trigger: 'allyDowned',
      author: 'player',
      rationale: 'Never abandon a downed hunter.',
    });

    const decision = build(policy).evaluate(actions, {
      belowRetreatThreshold: true,
      allyDowned: false,
    });
    expect(decision.chosen?.kind).toBe('retreat');
  });

  it('reports every override so it can be audited, never silently', () => {
    const policy = new EmergencyPolicy();
    policy.authorise({
      id: 'rescue_over_retreat',
      constraintId: 'retreat_threshold',
      trigger: 'allyDowned',
      author: 'player',
      rationale: 'Never abandon a downed hunter.',
    });

    let overrides = 0;
    build(policy, () => {
      overrides += 1;
    }).evaluate(actions, { belowRetreatThreshold: true, allyDowned: true });

    expect(overrides).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §2.1 / §18 — canonical precedence as data
// ---------------------------------------------------------------------------

describe('policy precedence (v1.0 §2.1, §18)', () => {
  const precedence = content.policyPrecedence;

  it('matches the canonical order verbatim', () => {
    expect(precedence.tiers.map((t) => t.id)).toEqual([
      'hardConstraints',
      'guildObjective',
      'guildPolicy',
      'aiOptimization',
      'departmentPolicy',
      'partyObjective',
      'hunterPreferences',
    ]);
  });

  it('puts hard constraints first, as a filter, and marks them overridable', () => {
    const first = precedence.tiers[0];
    expect(first?.id).toBe('hardConstraints');
    expect(first?.kind).toBe('filter');
    // v1.0 §2.1 — absolute *unless* an emergency policy permits the override.
    expect(first?.overridable).toBe(true);
  });

  it('makes only hard constraints overridable', () => {
    const overridable = precedence.tiers.filter((t) => t.overridable).map((t) => t.id);
    expect(overridable).toEqual(['hardConstraints']);
  });

  it('keeps every filter above every weight, so a forbidden action is never scored', () => {
    const lastFilter = Math.max(
      ...precedence.tiers.filter((t) => t.kind === 'filter').map((t) => t.rank),
    );
    const firstWeight = Math.min(
      ...precedence.tiers.filter((t) => t.kind === 'weight').map((t) => t.rank),
    );
    expect(lastFilter).toBeLessThan(firstWeight);
  });

  it('declares the four-scope inheritance chain', () => {
    expect(precedence.scopes.order).toEqual(['guild', 'department', 'party', 'hunter']);
  });
});

// ---------------------------------------------------------------------------
// §4 — dual-resolution clock
// ---------------------------------------------------------------------------

describe('dual-resolution clock (v1.0 §4)', () => {
  it('derives both cadences from the same elapsed time', () => {
    const clock = new SimulationClock({ stepMs: 50, coarseStepRatio: 20 });
    let fine = 0;
    let coarse = 0;

    clock.advance(10_000, () => (fine += 1), () => (coarse += 1));

    expect(fine).toBe(200);
    expect(coarse).toBe(10);
    expect(coarse).toBe(Math.floor(fine / clock.coarseStepRatio));
  });

  it('rejects a non-integer coarse ratio, which would let the cadences drift apart', () => {
    expect(() => new SimulationClock({ coarseStepRatio: 2.5 })).toThrow(/positive integer/);
    expect(() => new SimulationClock({ coarseStepRatio: 0 })).toThrow(/positive integer/);
  });

  it('agrees on coarse tick count however the time is fed in', () => {
    const chunked = new SimulationClock({ stepMs: 50, maxStepsPerAdvance: 100000 });
    for (let i = 0; i < 100; i++) chunked.advance(17, () => {});

    const single = new SimulationClock({ stepMs: 50, maxStepsPerAdvance: 100000 });
    single.advance(1700, () => {});

    expect(chunked.coarseTick).toBe(single.coarseTick);
    expect(chunked.tick).toBe(single.tick);
  });

  it('runs the coarse cadence alone for offline catch-up', () => {
    const clock = new SimulationClock({ stepMs: 50, coarseStepRatio: 20 });
    let coarse = 0;
    const ran = clock.runCoarseSteps(100, () => (coarse += 1));

    expect(ran).toBe(100);
    expect(coarse).toBe(100);
    // The fine tick advances by the full equivalent, so one clock still governs both.
    expect(clock.tick).toBe(2000);
    expect(clock.coarseTick).toBe(100);
  });

  it('reports a coarse dt matching the coarse step', () => {
    const clock = new SimulationClock({ stepMs: 50, coarseStepRatio: 20 });
    expect(clock.coarseStepMs).toBe(1000);
    expect(clock.coarseDt).toBe(1);
    expect(clock.coarseStepsForMs(5000)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// §4 / §18 — availability and recovery
// ---------------------------------------------------------------------------

describe('hunter availability (v1.0 §4)', () => {
  it('starts available and deployable', () => {
    expect(FRESH_AVAILABILITY.state).toBe('available');
    expect(isDeployable(FRESH_AVAILABILITY)).toBe(true);
  });

  it('forbids going straight from injured to available', () => {
    // Injury must heal into recovery. The transition table exists so this bug surfaces as
    // an error rather than as a hunter deployed while hurt.
    expect(canTransition('injured', 'available')).toBe(false);
    expect(canTransition('injured', 'recovering')).toBe(true);

    const injured = { ...FRESH_AVAILABILITY, state: 'injured' as const };
    const result = transition(injured, 'available');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/heal into recovery/);
  });

  it('models recall as taking transition time', () => {
    const assigned = transition(FRESH_AVAILABILITY, 'assigned', { assignment: 'expedition-1' });
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;

    const recalling = beginRecall(assigned.value, 100);
    expect(recalling.ok).toBe(true);
    if (!recalling.ok) return;

    // Mid-recall the hunter is in transit and cannot be redeployed.
    expect(isDeployable(recalling.value)).toBe(false);
    expect(describeAvailability(recalling.value)).toBe('Returning to the guild');

    expect(completeRecall(recalling.value, 50).ok).toBe(false);

    const arrived = completeRecall(recalling.value, 100);
    expect(arrived.ok).toBe(true);
    if (arrived.ok) expect(isDeployable(arrived.value)).toBe(true);
  });

  it('refuses to recall a hunter who is not assigned', () => {
    expect(beginRecall(FRESH_AVAILABILITY, 10).ok).toBe(false);
  });

  it('makes recovery vary measurably with food, housing and services (§18)', () => {
    const base = { fatigue: 1, hunger: 0, ...BASELINE_RECOVERY };
    const baseline = recoveryRatePerStep(base, 0.01);

    const betterHousing = recoveryRatePerStep({ ...base, housingQuality: 2 }, 0.01);
    const betterServices = recoveryRatePerStep({ ...base, serviceQuality: 1.5 }, 0.01);
    const noFood = recoveryRatePerStep({ ...base, foodAvailable: false }, 0.01);
    const hungry = recoveryRatePerStep({ ...base, hunger: 1 }, 0.01);

    expect(betterHousing).toBeGreaterThan(baseline);
    expect(betterServices).toBeGreaterThan(baseline);
    expect(noFood).toBeLessThan(baseline);
    expect(hungry).toBeLessThan(baseline);
  });

  it('slows recovery without food but never freezes it', () => {
    // A food shortage must be a pressure the player trades against, not an unrecoverable
    // spiral — so the rate drops but stays positive and the hunter still eventually rests.
    const starving = { fatigue: 1, hunger: 1, ...BASELINE_RECOVERY, foodAvailable: false };
    expect(recoveryRatePerStep(starving, 0.01)).toBeGreaterThan(0);
    expect(Number.isFinite(stepsUntilRested(starving, 0.01))).toBe(true);
  });

  it('reports never-rested rather than zero when the rate is non-positive', () => {
    const stalled = { fatigue: 1, hunger: 0, ...BASELINE_RECOVERY };
    expect(stepsUntilRested(stalled, 0)).toBe(Infinity);
  });

  it('is carried on the hunter and survives a save round-trip', () => {
    const { session, debug } = testSession('availability-save');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    expect(hunter.availability.state).toBe('available');

    session.save.save('slot', session.snapshot());
    const loaded = session.save.load('slot');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.hunters[0]?.availability.state).toBe('available');
  });
});

// ---------------------------------------------------------------------------
// §5 / §6 / §19 — generated build tags
// ---------------------------------------------------------------------------

describe('build tags (v1.0 §5, §6, §19)', () => {
  it('generates tags from the actual build', () => {
    const { session, debug } = testSession('tags');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 40, fullyEquipped: true });
    debug.maxOut(hunter.id, 'vit');
    const profile = session.buildIdentity.profileOf(session.roster.require(hunter.id));

    const tags = generateBuildTags(profile);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.some((t) => t.kind === 'role')).toBe(true);
    for (const tag of tags) {
      expect(tag.because.length).toBeGreaterThan(0);
      expect(tag.confidence).toBeGreaterThanOrEqual(0);
      expect(tag.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('gives different builds different tags', () => {
    const { session, debug } = testSession('tags-differ');
    const tank = debug.spawnHunter({ archetype: 'vanguard', personality: 'stoic', level: 60, fullyEquipped: true });
    const caster = debug.spawnHunter({ archetype: 'adept', personality: 'stoic', level: 60, fullyEquipped: true });

    debug.maxOut(tank.id, 'vit');
    debug.maxOut(caster.id, 'int');

    const tankTags = generateBuildTags(
      session.buildIdentity.profileOf(session.roster.require(tank.id)),
    ).map((t) => t.label);
    const casterTags = generateBuildTags(
      session.buildIdentity.profileOf(session.roster.require(caster.id)),
    ).map((t) => t.label);

    expect(tankTags).not.toEqual(casterTags);
    expect(tankTags).toContain('frontline');
    expect(casterTags).toContain('sustain');
  });

  it('is derived, never stored — no tag field exists on a Hunter', () => {
    // §5: tags "are not manually chosen labels". The way that stays true is that there is
    // nowhere to put a chosen one.
    const { debug } = testSession('tags-derived');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', fullyEquipped: true });
    expect(Object.keys(hunter)).not.toContain('buildTags');
    expect(Object.keys(hunter)).not.toContain('tags');
  });

  it('never exposes an aggregate rating (§19 forbids Combat Power)', () => {
    const { session, debug } = testSession('tags-no-power');
    const hunter = debug.spawnHunter({ archetype: 'ranger', level: 50, fullyEquipped: true });
    const tags = generateBuildTags(session.buildIdentity.profileOf(session.roster.require(hunter.id)));

    // Each tag carries its own confidence; nothing sums them.
    const asRecord = tags as unknown as Record<string, unknown>;
    expect(asRecord['total']).toBeUndefined();
    expect(asRecord['power']).toBeUndefined();
    expect(asRecord['rating']).toBeUndefined();
  });

  it('composes a short phrase in the §5 style', () => {
    const { session, debug } = testSession('tag-phrase');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 40, fullyEquipped: true });
    const phrase = composeTagPhrase(
      generateBuildTags(session.buildIdentity.profileOf(session.roster.require(hunter.id))),
    );

    expect(phrase.length).toBeGreaterThan(0);
    expect(phrase).not.toMatch(/\d/);
  });

  it('respects the tag cap', () => {
    const { session, debug } = testSession('tag-cap');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 60, fullyEquipped: true });
    const profile = session.buildIdentity.profileOf(session.roster.require(hunter.id));
    expect(generateBuildTags(profile, { maxTags: 3 })).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// §11 — chronicle levels
// ---------------------------------------------------------------------------

describe('chronicle levels (v1.0 §11)', () => {
  it('names exactly three levels', () => {
    expect(CHRONICLE_LEVELS).toEqual(['minor', 'major', 'historic']);
  });

  it('maps significance onto the named levels monotonically', () => {
    expect(chronicleLevel(1)).toBe('minor');
    expect(chronicleLevel(2)).toBe('minor');
    expect(chronicleLevel(3)).toBe('major');
    expect(chronicleLevel(4)).toBe('major');
    expect(chronicleLevel(5)).toBe('historic');
  });

  it('stamps the level onto recorded entries', () => {
    const { session, debug } = testSession('chronicle-levels');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });

    session.events.emit('zone.firstEntered', {
      hunterId: hunter.id,
      zoneId: 'the-drowned-marches',
      tier: 'black',
    });

    const entry = session.chronicle.of(hunter.id).notable.find((e) => e.kind === 'firstBlackZone');
    expect(entry?.level).toBe('historic');
  });

  it('selects entries at or above a level, for legacy and monuments', () => {
    const { session, debug } = testSession('chronicle-select');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });

    session.events.emit('zone.firstEntered', { hunterId: hunter.id, zoneId: 'ashfall', tier: 'black' });
    session.events.emit('combat.nearDeath', { hunterId: hunter.id });

    expect(session.chronicle.entriesAtLevel(hunter.id, 'historic')).toHaveLength(1);
    expect(
      session.chronicle.entriesAtLevel(hunter.id, 'major').length,
    ).toBeGreaterThanOrEqual(2);
    expect(session.chronicle.historicEntries()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// §14 / §18 — audit survives persistence
// ---------------------------------------------------------------------------

describe('audit and emergency state persist (v1.0 §14)', () => {
  it('round-trips both through save and load', () => {
    const { session } = testSession('audit-save');

    session.audit.record({
      actor: { kind: 'system', name: 'guild' },
      system: 'guild',
      outcome: 'contract accepted',
      reasonCodes: [REASON.utilityBestScore],
    });
    session.emergency.authorise({
      id: 'rescue_over_retreat',
      constraintId: 'retreat_threshold',
      trigger: 'allyDowned',
      author: 'player',
      rationale: 'Never abandon a downed hunter.',
    });

    session.save.save('slot', session.snapshot());
    const loaded = session.save.load('slot');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const fresh = testSession('audit-save-2');
    fresh.session.restore(loaded.value);

    expect(fresh.session.audit.size).toBe(1);
    expect(fresh.session.emergency.size).toBe(1);
    // An authorisation that vanished on reload would silently restore absolute constraints.
    expect(
      fresh.session.emergency.permits('retreat_threshold', { activeTriggers: ['allyDowned'] }),
    ).toBeDefined();
  });
});
