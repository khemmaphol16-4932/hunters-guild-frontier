/**
 * Phase 3 — the vertical slice.
 *
 * v1.0 §16 states the acceptance test in prose: the player makes a strategy or policy
 * decision, watches the guild execute it, understands *why* from the audit trail, and sees
 * the outcome affect the living guild. Each section below is one clause of that sentence.
 */

import { describe, expect, it } from 'vitest';
import { testSession } from './helpers.js';
import type { Session } from '../src/app/Session.js';
import { withAvailability, type Hunter } from '../src/core/hunter/Hunter.js';
import { createRng } from '../src/core/rng.js';
import { CombatEncounter } from '../src/sim/combat/CombatEncounter.js';
import { hunterCombatant, monsterCombatant } from '../src/systems/combat/combatants.js';
import { NEUTRAL_OBJECTIVE, SAFE_ENVIRONMENT } from '../src/ai/hunter/hunterAI.js';
import { SCENARIO_CONSTRAINTS } from '../src/debug/scenarios.js';
import { NEVER_RETREAT, NO_RESCUES, WITHDRAW_NOW } from '../src/ai/policy/orders.js';

/** A four-hunter guild covering the roles a standard formation wants. */
function stockGuild(session: Session, debug: ReturnType<typeof testSession>['debug']): Hunter[] {
  return [
    debug.spawnHunter({ archetype: 'vanguard', level: 20, fullyEquipped: true, name: 'Bran' }),
    debug.spawnHunter({ archetype: 'adept', level: 20, fullyEquipped: true, name: 'Sela' }),
    debug.spawnHunter({ archetype: 'ranger', level: 20, fullyEquipped: true, name: 'Kest' }),
    debug.spawnHunter({ archetype: 'ranger', level: 20, fullyEquipped: true, name: 'Ilra' }),
  ].map((h) => session.roster.require(h.id));
}

/**
 * Put a veteran on the roster who cannot be deployed.
 *
 * REQ-WLD-002 gates the deeper regions behind having a hunter of a given level, so a test
 * that deliberately sends an *outmatched* party somewhere dangerous needs the guild to have
 * earned the right to go without the party itself being strong. A veteran in the infirmary
 * is exactly that: the guild knows the way, and the planner will not pick them.
 */
function veteranInTheInfirmary(
  session: Session,
  debug: ReturnType<typeof testSession>['debug'],
): void {
  const veteran = debug.spawnHunter({ archetype: 'vanguard', level: 30, name: 'Old Maerith' });
  session.roster.update(
    withAvailability(session.roster.require(veteran.id), {
      state: 'injured',
      assignment: undefined,
      recallCompletesAtTick: undefined,
      readyAtTick: 99999,
    }),
  );
}

function combatantsFor(session: Session, hunters: readonly Hunter[]) {
  return hunters.map((hunter) =>
    hunterCombatant(hunter, {
      attributeBalance: session.content.balance.attributes,
      combatBalance: session.content.balance.combat,
      profileOf: (h) => session.buildIdentity.profileOf(h),
      conditionMultiplier: (h) => session.condition.statMultiplier(h),
      equipmentStats: (h) => session.equipment.aggregateStats(h),
    }),
  );
}

describe('content', () => {
  it('loads the combat, monster, status and world content', () => {
    const { session } = testSession();
    expect(session.content.monsters.length).toBeGreaterThan(0);
    expect(session.content.statuses.length).toBeGreaterThan(0);
    expect(session.content.world.regions.length).toBeGreaterThan(0);
    expect(session.content.balance.combat.damage.varianceSpread).toBe(0.1);
  });

  it('has no elemental multiplier table — v1.0 §20 requires approval first', () => {
    const { session } = testSession();
    expect(session.content.balance.combat).not.toHaveProperty('elementMultipliers');
  });
});

// ---------------------------------------------------------------------------
// 1. "the player makes a strategy decision"
// ---------------------------------------------------------------------------

describe('party planning', () => {
  it('proposes a different party for a different objective', () => {
    const { session, debug } = testSession();
    stockGuild(session, debug);
    // Extra bodies so the planner has room to choose rather than take everyone.
    debug.spawnHunter({ archetype: 'vanguard', level: 20, fullyEquipped: true, name: 'Doran' });
    debug.spawnHunter({ archetype: 'adept', level: 20, fullyEquipped: true, name: 'Yune' });

    const roster = session.roster.all();
    const slay = session.partyPlanner.propose(roster, 'slay');
    const survive = session.partyPlanner.propose(roster, 'survive');

    expect(slay.formation.id).toBe('standard');
    expect(survive.formation.id).toBe('turtle');
    expect(slay.members.map((m) => m.hunterId)).not.toEqual(
      survive.members.map((m) => m.hunterId),
    );
  });

  it('gives every member a rationale the player can read', () => {
    const { session, debug } = testSession();
    stockGuild(session, debug);
    const proposal = session.partyPlanner.propose(session.roster.all(), 'clear');

    expect(proposal.members.length).toBeGreaterThan(0);
    for (const member of proposal.members) {
      expect(member.rationale.length).toBeGreaterThan(0);
    }
    expect(proposal.summary).toMatch(/Standard line/);
  });

  it('forms an unbalanced party rather than refusing — REQ-PTY-002', () => {
    const { session, debug } = testSession();
    // No healer-leaning archetype at all.
    debug.spawnHunter({ archetype: 'vanguard', level: 10, fullyEquipped: true });
    debug.spawnHunter({ archetype: 'vanguard', level: 10, fullyEquipped: true });

    const proposal = session.partyPlanner.propose(session.roster.all(), 'clear');
    expect(proposal.members.length).toBe(2);
    expect(proposal.unfilled).toContain('healer');
    expect(proposal.summary).toMatch(/forms anyway/);
  });

  it('never proposes a hunter who cannot be deployed', () => {
    const { session, debug } = testSession();
    const hunters = stockGuild(session, debug);
    const injured = hunters[0];
    if (!injured) throw new Error('fixture');
    session.roster.update(
      withAvailability(injured, {
        state: 'injured',
        assignment: undefined,
        recallCompletesAtTick: undefined,
        readyAtTick: 500,
      }),
    );

    const proposal = session.partyPlanner.propose(session.roster.all(), 'clear');
    expect(proposal.members.map((m) => m.hunterId)).not.toContain(injured.id);
  });

  it('is deterministic — the same roster and objective propose the same party', () => {
    const { session, debug } = testSession();
    stockGuild(session, debug);
    const a = session.partyPlanner.propose(session.roster.all(), 'clear');
    const b = session.partyPlanner.propose(session.roster.all(), 'clear');
    expect(a.members.map((m) => m.hunterId)).toEqual(b.members.map((m) => m.hunterId));
  });
});

// ---------------------------------------------------------------------------
// 2. "watches the guild execute it"
// ---------------------------------------------------------------------------

describe('combat encounter', () => {
  function encounterFor(seed: string) {
    const { session, debug } = testSession(seed);
    const hunters = stockGuild(session, debug);
    const guild = combatantsFor(session, hunters);
    const monsters = [
      monsterCombatant(session.content.monstersById.get('moss_crawler')!, 0, 6),
      monsterCombatant(session.content.monstersById.get('thicket_wasp')!, 1, 6.5),
    ];

    return {
      session,
      guild,
      monsters,
      encounter: new CombatEncounter(
        {
          balance: session.content.balance.combat,
          ai: session.hunterAI,
          skillOf: (id) => session.content.skillsById.get(id as never),
          statusOf: (id) => session.content.statusesById.get(id),
          monsterOf: (id) => session.content.monstersById.get(id),
          constraints: [],
          emergency: session.emergency,
        },
        guild,
        monsters,
      ),
    };
  }

  it('resolves to a result rather than running forever', () => {
    const { encounter } = encounterFor('combat-a');
    const result = encounter.run(createRng('combat-a'));
    expect(['victory', 'defeat', 'timeout']).toContain(result.outcome);
    expect(result.elapsedSeconds).toBeGreaterThan(0);
  });

  it('replays identically from the same seed — v1.0 §18', () => {
    const first = encounterFor('replay').encounter.run(createRng('replay-stream'));
    const second = encounterFor('replay').encounter.run(createRng('replay-stream'));

    expect(second.outcome).toBe(first.outcome);
    expect(second.elapsedSeconds).toBe(first.elapsedSeconds);
    expect(second.log.map((e) => e.text)).toEqual(first.log.map((e) => e.text));
  });

  it('produces a log with highlights the player can follow', () => {
    const { encounter } = encounterFor('log');
    const result = encounter.run(createRng('log'));
    expect(result.log.length).toBeGreaterThan(0);
    expect(result.log.filter((e) => e.highlight).length).toBeGreaterThan(0);
    for (const entry of result.log) expect(entry.reasonCodes.length).toBeGreaterThan(0);
  });

  it('downs a hunter at zero health rather than killing them — REQ-CBT-012', () => {
    const { session, guild, encounter } = encounterFor('downed');
    const victim = guild[0];
    if (!victim) throw new Error('fixture');
    victim.health = 1;

    encounter.run(createRng('downed'));
    // Either they were saved or they ran out of timer, but they were never killed outright
    // at the moment their health hit zero — the log records the downed step first.
    const log = encounter.entries.map((e) => e.text).join('\n');
    if (log.includes('did not get up') || log.includes('did not get back up')) {
      expect(log).toMatch(/went down/);
    }
    expect(session.content.balance.combat.downed.timerSeconds).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. "understands why" — build identity must change decisions, not just numbers (risk R2)
// ---------------------------------------------------------------------------

describe('build identity changes decisions', () => {
  it('two builds facing the identical board choose differently', () => {
    const { session, debug } = testSession('r2');
    const tank = session.roster.require(
      debug.spawnHunter({ archetype: 'vanguard', level: 25, fullyEquipped: true }).id,
    );
    const healer = session.roster.require(
      debug.spawnHunter({ archetype: 'adept', level: 25, fullyEquipped: true }).id,
    );

    const [tankC, healerC] = combatantsFor(session, [tank, healer]);
    if (!tankC || !healerC) throw new Error('fixture');

    // The identical board: one wounded ally, one enemy in reach.
    const wounded = combatantsFor(session, [tank])[0]!;
    wounded.health = Math.round(wounded.maxHealth * 0.25);
    const enemy = monsterCombatant(session.content.monstersById.get('moss_crawler')!, 0, 1);

    const view = (self: typeof tankC) => ({
      self,
      allies: [self, wounded],
      enemies: [enemy],
      elapsedSeconds: 5,
      incomingTelegraphs: [],
      environment: SAFE_ENVIRONMENT,
      objective: NEUTRAL_OBJECTIVE,
      constraints: [],
      emergency: session.emergency,
    });

    const tankChoice = session.hunterAI.decide(view(tankC));
    const healerChoice = session.hunterAI.decide(view(healerC));

    expect(tankChoice).toBeDefined();
    expect(healerChoice).toBeDefined();
    // Not merely different damage — a different *action*.
    expect(healerChoice?.action.id).not.toBe(tankChoice?.action.id);
  });

  it('explains its choice in words, with reason codes', () => {
    const { session, debug } = testSession('explain');
    const hunter = session.roster.require(
      debug.spawnHunter({ archetype: 'ranger', level: 20, fullyEquipped: true }).id,
    );
    const self = combatantsFor(session, [hunter])[0]!;
    const enemy = monsterCombatant(session.content.monstersById.get('moss_crawler')!, 0, 1);

    const decision = session.hunterAI.decide({
      self,
      allies: [self],
      enemies: [enemy],
      elapsedSeconds: 1,
      incomingTelegraphs: [],
      environment: SAFE_ENVIRONMENT,
      objective: NEUTRAL_OBJECTIVE,
      constraints: [],
      emergency: session.emergency,
    });

    expect(decision?.explanation.length).toBeGreaterThan(10);
    expect(decision?.reasonCodes.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. "sees the outcome affect the living guild"
// ---------------------------------------------------------------------------

describe('expedition', () => {
  function run(seed: string, regionId: string, objective: 'clear' | 'survive' | 'slay' = 'clear') {
    const { session, debug } = testSession(seed);
    stockGuild(session, debug);
    const region = session.content.worldRegionsById.get(regionId)!;
    const party = session.partyPlanner.propose(session.roster.all(), objective);
    return { session, region, party, result: session.expedition.run(createRng(seed), region, party) };
  }

  it('walks a route and comes back with an account of it', () => {
    const { result } = run('exp-1', 'verdant_reach');
    expect(result.routeLength).toBeGreaterThanOrEqual(3);
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.decisions.length).toBe(result.nodes.length);
  });

  it('records why the guild continued or turned back — v1.0 §14', () => {
    const { result } = run('exp-2', 'ashfall_barrows', 'survive');
    for (const decision of result.decisions) {
      expect(decision.explanation.length).toBeGreaterThan(0);
      expect(decision.reasonCodes.length).toBeGreaterThan(0);
    }
  });

  it('replays identically from the same seed', () => {
    const a = run('same-seed', 'verdant_reach').result;
    const b = run('same-seed', 'verdant_reach').result;
    expect(b.summary).toBe(a.summary);
    expect(b.reachedNode).toBe(a.reachedNode);
    expect(b.totalXp).toBe(a.totalXp);
    expect(b.nodes.map((n) => n.node.label)).toEqual(a.nodes.map((n) => n.node.label));
  });

  it('produces a different route from a different seed', () => {
    const a = run('seed-a', 'ashfall_barrows').result;
    const b = run('seed-b', 'ashfall_barrows').result;
    expect(b.nodes.map((n) => n.node.label).join('|')).not.toBe(
      a.nodes.map((n) => n.node.label).join('|'),
    );
  });

  it('cannot kill a hunter in a BLUE zone — REQ-ZON-001', () => {
    for (const seed of ['blue-1', 'blue-2', 'blue-3', 'blue-4', 'blue-5']) {
      const { result } = run(seed, 'verdant_reach');
      for (const after of result.aftermath) {
        expect(after.died).toBe(false);
        expect(after.injured).toBe(false);
      }
    }
  });

  it('a survival objective spends less of the party than a boss kill does', () => {
    // Both break off at the boss — an outmatched party does — so how *far* they got stopped
    // being the discriminator once the AI learned to withdraw. What the objective changes
    // is how much of themselves they spend on the way, which is the substance of it.
    //
    // Compared across seeds rather than on one. A single run turns a claim about a tendency
    // into a claim about a particular fight, and this test previously sat on an outlier
    // seed where the relationship inverted — passing until an unrelated change disturbed it.
    function condition(seed: string, objective: 'survive' | 'slay'): number {
      const { session, debug } = testSession(seed);
      for (const archetype of ['vanguard', 'adept', 'ranger', 'ranger'] as const) {
        debug.spawnHunter({ archetype, level: 6, fullyEquipped: true });
      }
      veteranInTheInfirmary(session, debug);
      const region = session.content.worldRegionsById.get('ashfall_barrows')!;
      const party = session.partyPlanner.propose(session.roster.all(), objective);
      const result = session.expedition.run(createRng(seed), region, party);
      return result.aftermath.reduce((sum, a) => sum + a.healthFraction, 0) / result.aftermath.length;
    }

    // Twenty seeds, not eight. Events add real variance to a run, and at eight the sample
    // was small enough that an unlucky stretch read as a broken mechanism — measured over
    // twenty-four runs the cautious objective comes home better about 83% of the time.
    const seeds = Array.from({ length: 20 }, (_, i) => `objective-${i}`);
    const better = seeds.filter((s) => condition(s, 'survive') > condition(s, 'slay'));

    // A tendency, asserted as one: the cautious objective should come home in better shape
    // on the large majority of runs, not necessarily on every single one.
    expect(better.length, `survive came home better on ${better.length}/${seeds.length}`)
      .toBeGreaterThanOrEqual(14);
  });

  it('a hunter can die in a BLACK zone and leaves the roster when they do', () => {
    // Reached deliberately rather than hoped for. An outmatched party almost always breaks
    // off and survives — 11 of 12 do, which is the AI working — so a test that waited for
    // an unlucky seed would be testing the RNG. The reliable route to a death is the one
    // the design provides: the player forbids retreat (§29) and the party holds until it
    // cannot. That the guild's own standing order is what kills them is the point.
    const { session, commands, debug } = testSession('ordered-to-hold');
    session.policy.add(SCENARIO_CONSTRAINTS.neverRetreat);

    for (const archetype of ['vanguard', 'adept', 'ranger', 'ranger'] as const) {
      debug.spawnHunter({ archetype, level: 3, fullyEquipped: true });
    }
    veteranInTheInfirmary(session, debug);
    const before = session.roster.size;

    const outcome = commands.sendExpedition('ashfall_barrows', 'slay');
    if (!outcome.ok) throw new Error(outcome.error);
    const result = outcome.value.result;

    expect(result.retreated, 'a forbidden retreat must not happen').toBe(false);

    const dead = result.aftermath.filter((a) => a.died);
    expect(dead.length).toBeGreaterThan(0);
    expect(session.roster.size).toBe(before - dead.length);
    for (const d of dead) expect(session.roster.get(d.hunterId)).toBeUndefined();
    // v1.0 §19: the guild remembers them even though it cannot deploy them.
    expect(session.chronicle.all().length).toBeGreaterThan(0);
  });

  it('nobody dies in a BLUE zone even under the same standing order', () => {
    // The same order, the same weak party, a safe region: REQ-ZON-001 is what decides
    // lethality, not the fight and not the policy.
    const { session, commands, debug } = testSession('ordered-to-hold');
    session.policy.add(SCENARIO_CONSTRAINTS.neverRetreat);
    for (const archetype of ['vanguard', 'adept', 'ranger', 'ranger'] as const) {
      debug.spawnHunter({ archetype, level: 3, fullyEquipped: true });
    }
    veteranInTheInfirmary(session, debug);

    const outcome = commands.sendExpedition('verdant_reach', 'slay');
    if (!outcome.ok) throw new Error(outcome.error);

    expect(outcome.value.result.aftermath.every((a) => !a.died)).toBe(true);
    // The four who went, plus the veteran who could not.
    expect(session.roster.size).toBe(5);
  });

  it('leaves the party tired, which is what makes the next decision cost something', () => {
    const { result } = run('fatigue', 'verdant_reach');
    expect(result.aftermath.length).toBeGreaterThan(0);
    for (const after of result.aftermath) {
      expect(after.fatigueAdded).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// The loop closes: the outcome must change the guild the player comes back to.
// ---------------------------------------------------------------------------

describe('sending an expedition', () => {
  function guild(seed = 'send') {
    const harness = testSession(seed);
    stockGuild(harness.session, harness.debug);
    return harness;
  }

  it('rejects an unknown region rather than inventing one', () => {
    const { commands } = guild();
    const outcome = commands.sendExpedition('nowhere', 'clear');
    expect(outcome.ok).toBe(false);
  });

  it('returns hunters changed — xp, fatigue and availability', () => {
    const { session, commands } = guild();
    const before = session.roster.all().map((h) => ({
      id: h.id,
      xp: h.xp,
      level: h.level,
      fatigue: h.condition.fatigue,
      state: h.availability.state,
    }));

    const outcome = commands.sendExpedition('verdant_reach', 'clear');
    if (!outcome.ok) throw new Error(outcome.error);

    for (const snapshot of before) {
      const after = session.roster.get(snapshot.id);
      expect(after).toBeDefined();
      if (!after) continue;
      expect(after.condition.fatigue).toBeGreaterThan(snapshot.fatigue);
      expect(after.availability.state).not.toBe('available');
      expect(after.availability.readyAtTick).toBeGreaterThan(0);
      // Either they banked xp or they levelled and spent it.
      expect(after.xp > snapshot.xp || after.level > snapshot.level).toBe(true);
    }
  });

  it('puts the haul in the armoury', () => {
    const { session, commands } = guild();
    const before = session.armoury.all().length;
    const outcome = commands.sendExpedition('verdant_reach', 'clear');
    if (!outcome.ok) throw new Error(outcome.error);

    expect(outcome.value.loot.length).toBe(outcome.value.result.lootRolls);
    expect(session.armoury.all().length).toBe(before + outcome.value.loot.length);
  });

  it('deposits the expedition resource haul in the guild ledger', () => {
    const { session, commands } = guild();
    const before = session.resources.snapshot().balances;
    const outcome = commands.sendExpedition('verdant_reach', 'clear');
    if (!outcome.ok) throw new Error(outcome.error);

    expect(session.resources.amount('gold')).toBe(before['gold']! + outcome.value.resources.gold);
    expect(session.resources.amount('materials')).toBe(before['materials']! + outcome.value.resources.materials);
    expect(session.resources.amount('food')).toBe(before['food']! + outcome.value.resources.food);
  });

  it('leaves an audit trail explaining every route decision — v1.0 §14', () => {
    const { session, commands } = guild();
    const outcome = commands.sendExpedition('ashfall_barrows', 'survive');
    if (!outcome.ok) throw new Error(outcome.error);

    const records = session.audit.query({ system: 'expedition' });
    expect(records.length).toBeGreaterThanOrEqual(outcome.value.result.decisions.length);
    for (const record of records) {
      expect(record.reasonCodes.length).toBeGreaterThan(0);
      expect(record.policyVersion.length).toBeGreaterThan(0);
      expect(record.outcome.length).toBeGreaterThan(0);
    }
  });

  it('does not send the same party twice — they are recovering', () => {
    const { session, commands } = guild();
    const first = commands.sendExpedition('verdant_reach', 'clear');
    if (!first.ok) throw new Error(first.error);

    const second = commands.sendExpedition('verdant_reach', 'clear');
    expect(second.ok).toBe(false);
    expect(session.roster.all().every((h) => h.availability.state !== 'available')).toBe(true);
  });

  it('survives a save and reload with the guild in its post-expedition state', () => {
    const { session, commands } = guild();
    const outcome = commands.sendExpedition('verdant_reach', 'clear');
    if (!outcome.ok) throw new Error(outcome.error);

    const before = session.roster.all().map((h) => `${h.id}:${h.level}:${h.availability.state}`);
    expect(commands.saveGuild('slice').ok).toBe(true);
    expect(commands.loadGuild('slice').ok).toBe(true);

    expect(session.roster.all().map((h) => `${h.id}:${h.level}:${h.availability.state}`)).toEqual(
      before,
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 4: the guild remembers, and the player's standing orders reach the fight.
// ---------------------------------------------------------------------------

describe('the combat chronicle', () => {
  function veterans(seed = 'chronicle') {
    const harness = testSession(seed);
    for (const archetype of ['vanguard', 'adept', 'ranger', 'ranger'] as const) {
      harness.debug.spawnHunter({ archetype, level: 20, fullyEquipped: true });
    }
    return harness;
  }

  it('records that the expedition happened at all', () => {
    const { session, commands } = veterans();
    const outcome = commands.sendExpedition('verdant_reach', 'clear');
    if (!outcome.ok) throw new Error(outcome.error);

    const chronicles = session.chronicle.all();
    expect(chronicles.length).toBe(4);
    for (const chronicle of chronicles) {
      expect(chronicle.counters['expeditions']).toBe(1);
    }
  });

  it('records a boss kill for everyone who was standing for it', () => {
    const { session, commands } = veterans();
    // Ordered to hold, so the party sees the boss through rather than breaking off.
    session.policy.add(SCENARIO_CONSTRAINTS.neverRetreat);

    const outcome = commands.sendExpedition('ashfall_barrows', 'slay');
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.value.result.bossDefeated).toBe(true);

    for (const chronicle of session.chronicle.all()) {
      expect(chronicle.counters['bossesDefeated']).toBe(1);
      expect(chronicle.notable.some((e) => e.kind === 'bossDefeated')).toBe(true);
    }
  });

  it('records the survivors losing a companion', () => {
    const { session, commands, debug } = testSession('ordered-to-hold');
    session.policy.add(SCENARIO_CONSTRAINTS.neverRetreat);
    for (const archetype of ['vanguard', 'adept', 'ranger', 'ranger'] as const) {
      debug.spawnHunter({ archetype, level: 3, fullyEquipped: true });
    }
    veteranInTheInfirmary(session, debug);

    const outcome = commands.sendExpedition('ashfall_barrows', 'slay');
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.value.result.aftermath.some((a) => a.died)).toBe(true);

    // The dead leave the roster but their Chronicles remain, and the ones who fell earliest
    // are remembered by those who outlived them (§19).
    const lost = session.chronicle
      .all()
      .reduce((sum, c) => sum + (c.counters['companionsLost'] ?? 0), 0);
    expect(lost).toBeGreaterThan(0);
    // Chronicles outlive their hunters (§19); the veteran has one too.
    expect(session.chronicle.all().length).toBe(5);
  });

  it('records going down as a near death, whether or not it ended in one', () => {
    // An outmatched party ordered to hold: hunters go down before they die, so the near
    // death is recorded for the ones pulled back up as well as the ones who were not.
    // Veterans win the same fight without anyone falling — correct behaviour, but it would
    // let this test pass against an empty Chronicle.
    const { session, commands, debug } = testSession('ordered-to-hold');
    session.policy.add(SCENARIO_CONSTRAINTS.neverRetreat);
    for (const archetype of ['vanguard', 'adept', 'ranger', 'ranger'] as const) {
      debug.spawnHunter({ archetype, level: 3, fullyEquipped: true });
    }
    veteranInTheInfirmary(session, debug);

    const outcome = commands.sendExpedition('ashfall_barrows', 'slay');
    if (!outcome.ok) throw new Error(outcome.error);

    const nearDeaths = session.chronicle
      .all()
      .reduce((sum, c) => sum + (c.counters['nearDeaths'] ?? 0), 0);
    expect(nearDeaths).toBeGreaterThan(0);
  });
});

describe("the player's standing orders", () => {
  function guild(seed = 'policy') {
    const harness = testSession(seed);
    for (const archetype of ['vanguard', 'adept', 'ranger', 'ranger'] as const) {
      harness.debug.spawnHunter({ archetype, level: 6, fullyEquipped: true });
    }
    veteranInTheInfirmary(harness.session, harness.debug);
    return harness;
  }

  it('are empty until the player authors one', () => {
    const { session } = guild();
    expect(session.policy.size).toBe(0);
    expect(session.policy.describe()).toEqual([]);
  });

  it('change the outcome of an expedition', () => {
    const free = guild();
    const held = guild();
    held.session.policy.add(SCENARIO_CONSTRAINTS.neverRetreat);

    const a = free.commands.sendExpedition('ashfall_barrows', 'slay');
    const b = held.commands.sendExpedition('ashfall_barrows', 'slay');
    if (!a.ok || !b.ok) throw new Error('expedition failed');

    // Same seed, same roster, same region, same objective — only the order differs.
    expect(a.value.result.retreated).toBe(true);
    expect(b.value.result.retreated).toBe(false);
  });

  it('are stated in the player\u2019s own words, for the log', () => {
    const { session } = guild();
    session.policy.add(SCENARIO_CONSTRAINTS.neverRetreat);
    expect(session.policy.describe()[0]).toMatch(/forbids/);
    expect(session.policy.has('never_retreat')).toBe(true);

    session.policy.remove('never_retreat');
    expect(session.policy.size).toBe(0);
  });
});

describe('a standing order outranks the route decision too', () => {
  function weakGuild(seed: string) {
    const harness = testSession(seed);
    for (const archetype of ['vanguard', 'adept', 'ranger', 'ranger'] as const) {
      harness.debug.spawnHunter({ archetype, level: 4, fullyEquipped: true });
    }
    veteranInTheInfirmary(harness.session, harness.debug);
    return harness;
  }

  it('"hold the line" stops the party turning back at a node', () => {
    // Swept across seeds. An order that governed only combat and not the route would leave
    // the player watching their explicit instruction be overruled by a health threshold at
    // the next node — but whether the *unordered* party would have turned back at all
    // depends on the run, and the first version of this test sat on the one seed where it
    // did not, which made it pass for the wrong reason.
    const seeds = Array.from({ length: 8 }, (_, i) => `route-order-${i}`);
    let changedTheRoute = 0;

    for (const seed of seeds) {
      const free = weakGuild(seed);
      const held = weakGuild(seed);
      held.session.policy.add(NEVER_RETREAT.constraint);

      const a = free.commands.sendExpedition('ashfall_barrows', 'clear');
      const b = held.commands.sendExpedition('ashfall_barrows', 'clear');
      if (!a.ok || !b.ok) throw new Error('expedition failed');

      // Whatever else happens on a given run, the order is never disobeyed.
      expect(b.value.result.retreated, seed).toBe(false);

      const ordered = b.value.result.decisions.filter((d) =>
        d.reasonCodes.includes('order:never_retreat'),
      );
      expect(ordered.length, seed).toBeGreaterThan(0);
      for (const decision of ordered) {
        expect(decision.explanation).toMatch(/Standing orders forbid turning back/);
      }

      if (a.value.result.retreated) {
        changedTheRoute++;
        // `>=`, not `>`: a party can also "retreat" by breaking off from the *last* fight,
        // which it has already reached — so the ordered party gets at least as far, but
        // not necessarily further.
        expect(b.value.result.reachedNode).toBeGreaterThanOrEqual(a.value.result.reachedNode);
      }
    }

    // And it has to be doing something on most runs, or this proves nothing.
    expect(changedTheRoute, `the order changed the route on ${changedTheRoute}/${seeds.length}`)
      .toBeGreaterThanOrEqual(6);
  });

  it('"withdraw immediately" turns the party round at the first node', () => {
    const { session, commands } = weakGuild('route-order-out');
    session.policy.add(WITHDRAW_NOW.constraint);

    const outcome = commands.sendExpedition('ashfall_barrows', 'slay');
    if (!outcome.ok) throw new Error(outcome.error);

    expect(outcome.value.result.retreated).toBe(true);
    expect(outcome.value.result.reachedNode).toBe(0);
    expect(outcome.value.result.decisions[0]?.reasonCodes).toContain('order:must_retreat');
  });

  it('an order with no route meaning leaves the route decision alone', () => {
    const free = weakGuild('route-order');
    const restricted = weakGuild('route-order');
    restricted.session.policy.add(NO_RESCUES.constraint);

    const a = free.commands.sendExpedition('ashfall_barrows', 'clear');
    const b = restricted.commands.sendExpedition('ashfall_barrows', 'clear');
    if (!a.ok || !b.ok) throw new Error('expedition failed');

    for (const decision of b.value.result.decisions) {
      expect(decision.reasonCodes).not.toContain('order:never_retreat');
      expect(decision.reasonCodes).not.toContain('order:must_retreat');
    }
  });
});

// ---------------------------------------------------------------------------
// The resumable engine (DL-074): stepping the route one stop at a time, with the
// run state round-tripped through JSON between every stop, produces byte-for-byte
// the same result as running it in one shot. This is what lets a journey resolve
// node by node on the tick and survive a save mid-route.
// ---------------------------------------------------------------------------

describe('resumable expedition engine (DL-074)', () => {
  function fixture(seed: string) {
    const { session, debug } = testSession(seed);
    stockGuild(session, debug);
    return session;
  }

  /** Run the route one stop at a time, JSON round-tripping the state before every step. */
  function stepwise(
    session: ReturnType<typeof fixture>,
    seed: string,
    region: Parameters<typeof session.expedition.run>[1],
    party: Parameters<typeof session.expedition.run>[2],
    options: Parameters<typeof session.expedition.run>[3] = {},
  ) {
    const exp = session.expedition;
    let state = JSON.parse(JSON.stringify(exp.begin(createRng(seed), region, party, options)));
    for (let guard = 0; guard < 1000; guard++) {
      const signal = exp.stepNode(state, region, party, options);
      state = JSON.parse(JSON.stringify(state));
      if (signal === 'done') return exp.finalize(state, region, party, options);
    }
    throw new Error('stepwise run did not finish');
  }

  const SCENARIOS: readonly {
    readonly name: string;
    readonly regionId: string;
    readonly objective: 'clear' | 'survive' | 'slay';
    readonly options?: (s: ReturnType<typeof fixture>) => Parameters<ReturnType<typeof fixture>['expedition']['run']>[3];
  }[] = [
    { name: 'blue clear', regionId: 'verdant_reach', objective: 'clear' },
    { name: 'lethal survive', regionId: 'ashfall_barrows', objective: 'survive' },
    { name: 'boss slay', regionId: 'ashfall_barrows', objective: 'slay' },
    {
      name: 'endless',
      regionId: 'verdant_reach',
      objective: 'clear',
      options: (s) => ({ endless: { maxDepth: s.content.endless.maxDepth, statsPerDepth: s.content.endless.statsPerDepth } }),
    },
    { name: 'recalled after one node', regionId: 'verdant_reach', objective: 'clear', options: () => ({ recallAfterNodes: 1 }) },
  ];

  for (const scenario of SCENARIOS) {
    it(`resolves ${scenario.name} identically stepwise and one-shot, across seeds`, () => {
      let sawMultiNode = false;
      for (let i = 0; i < 24; i++) {
        const seed = `${scenario.name}-${i}`;
        const session = fixture(seed);
        const region = session.content.worldRegionsById.get(scenario.regionId)!;
        const party = session.partyPlanner.propose(session.roster.all(), scenario.objective);
        const options = scenario.options?.(session) ?? {};
        const oneShot = session.expedition.run(createRng(seed), region, party, options);
        const stepped = stepwise(session, seed, region, party, options);
        expect(JSON.stringify(stepped)).toBe(JSON.stringify(oneShot));
        if (oneShot.nodes.length > 1) sawMultiNode = true;
      }
      // Guard against a vacuous pass where every route ended at its first stop.
      expect(sawMultiNode).toBe(true);
    });
  }
});
