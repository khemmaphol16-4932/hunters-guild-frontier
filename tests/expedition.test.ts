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

/** A four-hunter guild covering the roles a standard formation wants. */
function stockGuild(session: Session, debug: ReturnType<typeof testSession>['debug']): Hunter[] {
  return [
    debug.spawnHunter({ archetype: 'vanguard', level: 20, fullyEquipped: true, name: 'Bran' }),
    debug.spawnHunter({ archetype: 'adept', level: 20, fullyEquipped: true, name: 'Sela' }),
    debug.spawnHunter({ archetype: 'ranger', level: 20, fullyEquipped: true, name: 'Kest' }),
    debug.spawnHunter({ archetype: 'ranger', level: 20, fullyEquipped: true, name: 'Ilra' }),
  ].map((h) => session.roster.require(h.id));
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

  it('a survival objective turns back where a boss kill presses on', () => {
    // An outmatched party, so the retreat threshold is actually reached. A healthy party
    // never turns back, which would make this assertion pass without testing anything.
    function weak(objective: 'survive' | 'slay') {
      const { session, debug } = testSession('threshold');
      for (const archetype of ['vanguard', 'adept', 'ranger', 'ranger'] as const) {
        debug.spawnHunter({ archetype, level: 6, fullyEquipped: true });
      }
      const region = session.content.worldRegionsById.get('ashfall_barrows')!;
      const party = session.partyPlanner.propose(session.roster.all(), objective);
      return session.expedition.run(createRng('threshold'), region, party);
    }

    const cautious = weak('survive');
    const committed = weak('slay');

    expect(cautious.retreated).toBe(true);
    expect(committed.reachedNode).toBeGreaterThan(cautious.reachedNode);
  });

  it('a hunter can die in a BLACK zone and leaves the roster when they do', () => {
    // Deliberately outmatched, across several seeds, so a death is reached rather than hoped
    // for. The assertion is about what the guild does when it happens, not about frequency.
    let sawDeath = false;
    for (const seed of ['death-1', 'death-2', 'death-3', 'death-4', 'death-5', 'death-6']) {
      const { session, commands, debug } = testSession(seed);
      for (const archetype of ['vanguard', 'adept', 'ranger', 'ranger'] as const) {
        debug.spawnHunter({ archetype, level: 4, fullyEquipped: true });
      }
      const before = session.roster.size;
      const outcome = commands.sendExpedition('ashfall_barrows', 'slay');
      if (!outcome.ok) throw new Error(outcome.error);

      const dead = outcome.value.result.aftermath.filter((a) => a.died);
      if (dead.length === 0) continue;

      sawDeath = true;
      expect(session.roster.size).toBe(before - dead.length);
      for (const d of dead) expect(session.roster.get(d.hunterId)).toBeUndefined();
      // v1.0 §19: the guild remembers them even though it cannot deploy them.
      expect(session.chronicle.all().length).toBeGreaterThan(0);
      break;
    }
    expect(sawDeath).toBe(true);
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
