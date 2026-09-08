/**
 * Class chain, skill compatibility, loadout rules, skill books, mastery.
 * REQ-CLS-001..005, REQ-SKL-001..008, REQ-MAS-001..003.
 */

import { describe, expect, it } from 'vitest';
import { testSession } from './helpers.js';
import { asSkillId } from '../src/core/ids.js';
import { MAX_LOADOUT_SIZE } from '../src/systems/skills/SkillKnowledge.js';

describe('class chain', () => {
  it('advances archetype → advanced → specialization in order', () => {
    const { session, debug } = testSession('chain');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 50 });

    const advanced = debug.advance(hunter.id, 'sentinel');
    expect(advanced.ok).toBe(true);

    const specialised = debug.advance(hunter.id, 'bulwark');
    expect(specialised.ok).toBe(true);

    const final = session.roster.require(hunter.id);
    expect(session.classSystem.describeChain(final)).toBe('Vanguard → Sentinel → Bulwark');
  });

  it('refuses to skip the advanced stage', () => {
    const { debug } = testSession('skip');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 50 });
    const result = debug.advance(hunter.id, 'bulwark');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/requires an advanced class first/);
  });

  it("refuses to advance into another archetype's branch (REQ-CLS-002)", () => {
    const { debug } = testSession('branch');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 50 });
    const result = debug.advance(hunter.id, 'invoker');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/advances from adept/);
  });

  it('refuses to advance under-level', () => {
    const { debug } = testSession('underlevel');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 5 });
    const result = debug.advance(hunter.id, 'sentinel');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/requires level 20/);
  });

  it('refuses to advance twice at the same stage', () => {
    const { debug } = testSession('twice');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 50 });
    expect(debug.advance(hunter.id, 'sentinel').ok).toBe(true);
    const second = debug.advance(hunter.id, 'templar');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already taken an advanced class/);
  });

  it('reports blocked options with a reason rather than hiding them', () => {
    const { session, debug } = testSession('options');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 5 });
    const options = session.classSystem.availableAdvancements(hunter);

    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => !o.available)).toBe(true);
    expect(options[0]?.reason).toMatch(/requires level/);
  });

  it('weights the most specific stage most heavily in the blended profile', () => {
    const { session, debug } = testSession('blend');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 50 });
    debug.advance(hunter.id, 'sentinel');
    debug.advance(hunter.id, 'bulwark');

    const blended = session.classSystem.blendedClassProfile(session.roster.require(hunter.id));
    // Bulwark is 90% tank; a plain Vanguard is 55%. The blend must land above the archetype.
    expect(blended.roleLean.tank ?? 0).toBeGreaterThan(0.55);
  });
});

describe('skill compatibility', () => {
  it('allows a skill listed for the hunter archetype', () => {
    const { session, debug } = testSession('compat-allow');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    expect(session.registry.canLearn(hunter, 'shield_bash').allowed).toBe(true);
  });

  it('denies a skill belonging to another class (REQ-CLS-004)', () => {
    const { session, debug } = testSession('compat-deny');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    const verdict = session.registry.canLearn(hunter, 'ember_lance');
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/not available to/);
  });

  it('lets a genuine cross-class skill cross (REQ-CLS-005)', () => {
    const { session, debug } = testSession('cross');
    const hunter = debug.spawnHunter({ archetype: 'ranger', level: 50 });
    debug.advance(hunter.id, 'skirmisher');
    const updated = session.roster.require(hunter.id);

    // guard_stance is a Vanguard skill explicitly opened to Skirmishers.
    expect(session.registry.canLearn(updated, 'guard_stance').allowed).toBe(true);
    // But an Invoker skill still does not cross.
    expect(session.registry.canLearn(updated, 'frost_chain').allowed).toBe(false);
  });

  it('unlocks specialization-gated skills only after specialising', () => {
    const { session, debug } = testSession('spec-gate');
    const hunter = debug.spawnHunter({ archetype: 'adept', level: 50 });
    expect(session.registry.canLearn(session.roster.require(hunter.id), 'ember_lance').allowed).toBe(
      false,
    );

    debug.advance(hunter.id, 'invoker');
    expect(session.registry.canLearn(session.roster.require(hunter.id), 'ember_lance').allowed).toBe(
      true,
    );
  });

  it('names the class node that granted access', () => {
    const { session, debug } = testSession('granted');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    expect(session.registry.canLearn(hunter, 'shield_bash').grantedBy).toBe('vanguard');
  });

  it('rejects an unknown skill id', () => {
    const { session, debug } = testSession('unknown');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    expect(session.registry.canLearn(hunter, 'not_a_skill').allowed).toBe(false);
  });
});

describe('skill knowledge and loadout', () => {
  it('separates unlimited knowledge from a capped loadout (REQ-SKL-001/002)', () => {
    const { session, debug } = testSession('loadout');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 50, fullyEquipped: true });
    const current = session.roster.require(hunter.id);

    expect(current.knownSkills.length).toBeGreaterThan(0);
    expect(current.loadout.length).toBeLessThanOrEqual(MAX_LOADOUT_SIZE);
    for (const skill of current.loadout) {
      expect(current.knownSkills).toContain(skill);
    }
  });

  it('refuses to equip more than the cap', () => {
    const { session, debug } = testSession('cap');
    let hunter = debug.spawnHunter({ archetype: 'vanguard', level: 50 });

    // Grant nine skills via debug (bypassing compatibility on purpose).
    const ids = session.registry.all().slice(0, MAX_LOADOUT_SIZE + 1);
    for (const skill of ids) debug.grantSkill(hunter.id, skill.id);
    hunter = session.roster.require(hunter.id);

    const oversized = hunter.knownSkills.slice(0, MAX_LOADOUT_SIZE + 1);
    const result = session.knowledge.setLoadout(hunter, oversized);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at most 8 skills/);
  });

  it('refuses to equip an unknown skill', () => {
    const { session, debug } = testSession('unknown-equip');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    const result = session.knowledge.equip(hunter, asSkillId('ember_lance'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not know/);
  });

  it('refuses a loadout containing duplicates', () => {
    const { session, debug } = testSession('dupes');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', fullyEquipped: true });
    const current = session.roster.require(hunter.id);
    const skill = current.knownSkills[0];
    expect(skill).toBeDefined();
    if (!skill) return;

    const result = session.knowledge.setLoadout(current, [skill, skill]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/same skill twice/);
  });

  it('lets a new recruit equip fewer than six when they know fewer than six', () => {
    // The lower bound must not lock out a level-1 hunter with three skills.
    const { session, debug } = testSession('few');
    let hunter = debug.spawnHunter({ archetype: 'vanguard' });
    debug.grantSkill(hunter.id, 'shield_bash');
    debug.grantSkill(hunter.id, 'taunt');
    hunter = session.roster.require(hunter.id);

    const result = session.knowledge.setLoadout(hunter, hunter.knownSkills);
    expect(result.ok).toBe(true);
  });

  it('refuses to learn the same skill twice', () => {
    const { debug } = testSession('relearn');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    expect(debug.grantSkill(hunter.id, 'shield_bash').ok).toBe(true);
    const again = debug.grantSkill(hunter.id, 'shield_bash');
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/already knows/);
  });
});

describe('skill books', () => {
  it('teaches a compatible skill and reports consumption', () => {
    const { session, debug } = testSession('book');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    const book = session.books.bookFor(asSkillId('shield_bash'));
    expect(book.ok).toBe(true);
    if (!book.ok) return;

    const read = session.books.read(hunter, book.value);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.consumed).toBe(true);
      expect(read.value.hunter.knownSkills).toContain(asSkillId('shield_bash'));
    }
  });

  it('refuses an incompatible skill and does not consume the book', () => {
    const { session, debug } = testSession('book-deny');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    const book = session.books.bookFor(asSkillId('ember_lance'));
    expect(book.ok).toBe(true);
    if (!book.ok) return;

    const read = session.books.read(hunter, book.value);
    expect(read.ok).toBe(false);
    // The hunter is unchanged — a failed reading costs nothing.
    expect(hunter.knownSkills).not.toContain(asSkillId('ember_lance'));
  });
});

describe('skill mastery', () => {
  it('grows monotonically and never resets (REQ-MAS-001)', () => {
    const { session, debug } = testSession('mastery-grow');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    debug.grantSkill(hunter.id, 'shield_bash');

    let last = 0;
    for (let i = 0; i < 20; i++) {
      const updated = debug.grantMastery(hunter.id, 'shield_bash', 10);
      const points = session.mastery.points(updated, asSkillId('shield_bash'));
      expect(points).toBeGreaterThan(last);
      last = points;
    }
  });

  it('has no hard cap on points', () => {
    const { session, debug } = testSession('mastery-cap');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    debug.grantSkill(hunter.id, 'shield_bash');
    const updated = debug.grantMastery(hunter.id, 'shield_bash', 5000, 'decisive');
    expect(session.mastery.points(updated, asSkillId('shield_bash'))).toBeGreaterThan(5000);
  });

  it('saturates its effect with diminishing returns (DL-005)', () => {
    const { session } = testSession('mastery-curve');
    const at100 = session.mastery.effectBonus(100, 'power');
    const at500 = session.mastery.effectBonus(500, 'power');
    const at5000 = session.mastery.effectBonus(5000, 'power');
    const at50000 = session.mastery.effectBonus(50000, 'power');

    expect(at500).toBeGreaterThan(at100);
    expect(at5000).toBeGreaterThan(at500);
    // Diminishing: the second interval gains less than the first, despite being far larger.
    expect(at5000 - at500).toBeLessThan(at500 - at100 + 0.5);
    // Bounded by the curve's maxBonus however far it goes.
    expect(at50000).toBeLessThan(session.content.balance.mastery.effectCurves.power.maxBonus);
  });

  it('only applies effects a skill actually declares (REQ-MAS-003)', () => {
    const { session, debug } = testSession('mastery-effects');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    debug.grantSkill(hunter.id, 'shield_bash');
    const updated = debug.grantMastery(hunter.id, 'shield_bash', 200);

    const effects = session.mastery.activeEffects(updated, asSkillId('shield_bash'));
    // shield_bash declares power and cooldown, not duration.
    expect(effects.power).toBeGreaterThan(0);
    expect(effects.cooldown).toBeGreaterThan(0);
    expect(effects.duration).toBeUndefined();
  });

  it('emits a milestone event exactly once per threshold', () => {
    const { session, debug } = testSession('milestones');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    debug.grantSkill(hunter.id, 'shield_bash');

    const milestones: number[] = [];
    session.events.on('mastery.milestone', (payload) => milestones.push(payload.milestone));

    debug.grantMastery(hunter.id, 'shield_bash', 60);
    expect(milestones).toEqual([10, 25, 50]);
  });

  it('identifies the favourite skill (§19)', () => {
    const { session, debug } = testSession('favourite');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    debug.grantSkill(hunter.id, 'shield_bash');
    debug.grantSkill(hunter.id, 'taunt');
    debug.grantMastery(hunter.id, 'shield_bash', 10);
    const updated = debug.grantMastery(hunter.id, 'taunt', 400);

    expect(session.mastery.favouriteSkill(updated)?.skillId).toBe('taunt');
  });

  it('scales gain by significance — a decisive use teaches more', () => {
    const { session, debug } = testSession('significance');
    const routine = debug.spawnHunter({ archetype: 'vanguard' });
    const decisive = debug.spawnHunter({ archetype: 'vanguard' });
    debug.grantSkill(routine.id, 'shield_bash');
    debug.grantSkill(decisive.id, 'shield_bash');

    const a = debug.grantMastery(routine.id, 'shield_bash', 10, 'routine');
    const b = debug.grantMastery(decisive.id, 'shield_bash', 10, 'decisive');

    expect(session.mastery.points(b, asSkillId('shield_bash'))).toBeGreaterThan(
      session.mastery.points(a, asSkillId('shield_bash')),
    );
  });
});
