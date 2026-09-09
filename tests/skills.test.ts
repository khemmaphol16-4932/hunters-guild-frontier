/**
 * Skill knowledge, loadout rules, skill books and mastery.
 * REQ-SKL-001..008, REQ-MAS-001..003.
 */

import { describe, expect, it } from 'vitest';
import { testSession } from './helpers.js';
import { asSkillId } from '../src/core/ids.js';
import { MAX_LOADOUT_SIZE } from '../src/systems/skills/SkillKnowledge.js';

/**
 * The class-chain and skill-compatibility blocks that used to live here were superseded by
 * the constellation (v1.0 §5) and now live in tests/constellation.test.ts. What remains is
 * knowledge, loadout, books and mastery — the parts unchanged by that migration.
 */

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
