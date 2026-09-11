/**
 * Legacy Traits, apprentices, and the rule that a trait effect must be read by something.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent } from '../src/data/loader.js';
import { parseTraits } from '../src/data/schema.js';
import { testSession } from './helpers.js';

const content = loadContent();

/**
 * Every `.ts` file under src/ except the data layer, concatenated. An effect counts as read
 * when its name appears quoted — the form every consumer uses (`effects['x']`,
 * `traitMultiplier(h, traits, 'x')`). A heuristic, and a conservative one: a property of the
 * same name read unquoted elsewhere (personality's riskPostureShift, say) does not count.
 */
function sourceText(dir: string): string {
  let text = '';
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'data') text += sourceText(full);
    } else if (full.endsWith('.ts')) {
      text += readFileSync(full, 'utf8');
    }
  }
  return text;
}

/**
 * Trait effects authored before anything reads them. Empty since DL-057 wired the last nine;
 * if a gap must be tolerated again it goes here *and* in TECH_DEBT. The test below fails if a
 * new unread effect appears, and fails if one listed here gains a reader without leaving.
 */
const KNOWN_UNREAD = new Set<string>();

describe('trait effects are read by something (the Phase 7–8 review found most were not)', () => {
  const src = sourceText(join(__dirname, '..', 'src'));
  const effects = new Set(content.traits.flatMap((trait) => Object.keys(trait.effects)));

  it('every trait effect has a consumer, or is a known, tracked gap', () => {
    const unread = [...effects].filter((effect) => !src.includes(`'${effect}'`));
    expect(unread.filter((effect) => !KNOWN_UNREAD.has(effect))).toEqual([]);
  });

  it('the known-gap list is kept honest: nothing on it has quietly gained a reader', () => {
    const nowRead = [...KNOWN_UNREAD].filter((effect) => src.includes(`'${effect}'`));
    expect(nowRead).toEqual([]);
  });

  it('every Legacy Trait effect is read — inherited history must do what it says', () => {
    const legacyEffects = content.traits
      .filter((trait) => trait.origin === 'legacy')
      .flatMap((trait) => Object.keys(trait.effects));
    expect(legacyEffects.length).toBeGreaterThan(0);
    for (const effect of legacyEffects) expect(src.includes(`'${effect}'`), effect).toBe(true);
  });
});

describe('Legacy Traits (REQ-LEG-004, REQ-CHR-003)', () => {
  it('are never rolled at generation — they are inherited, not innate', () => {
    const { debug } = testSession('legacy-not-innate');
    const legacy = new Set(content.traits.filter((t) => t.origin === 'legacy').map((t) => t.id));
    for (let i = 0; i < 40; i++) {
      const hunter = debug.spawnHunter();
      expect(hunter.traitIds.some((id) => legacy.has(id))).toBe(false);
    }
  });

  it('must grow from a historic Chronicle kind', () => {
    const bad = {
      traits: [{ id: 'x', name: 'X', origin: 'legacy', fromChronicle: 'levelMilestone', description: 'd', effects: {} }],
    };
    // Parsing alone accepts it; the loader's cross-check against chronicle significance is
    // what rejects it. Pin the parse half here and the shipped content below.
    expect(parseTraits(bad)[0]?.fromChronicle).toBe('levelMilestone');
    for (const trait of content.traits.filter((t) => t.origin === 'legacy')) {
      expect(content.balance.chronicle.significance[trait.fromChronicle!]).toBeGreaterThanOrEqual(5);
    }
  });

  it('a retiring hunter carries the Legacy Traits their historic Chronicle earned', () => {
    const h = testSession('legacy-retire');
    const witness = h.debug.spawnHunter();
    h.session.events.emit('combat.bossDefeated', { hunterId: witness.id, bossId: 'warden', worldBoss: true });
    expect(h.commands.purchaseLegacyUnlock('mentor_hall').ok).toBe(true);
    const veteran = h.debug.spawnHunter({ level: 45 });
    h.session.events.emit('combat.bossDefeated', { hunterId: veteran.id, bossId: 'warden', worldBoss: true });
    const mentor = h.commands.retireHunter(veteran.id);
    expect(mentor.ok).toBe(true);
    if (mentor.ok) expect(mentor.value.legacyTraits).toEqual(['wardenbane']);
  });
});

describe('apprentices (generational play)', () => {
  function withMentor(seed: string) {
    const h = testSession(seed);
    const witness = h.debug.spawnHunter();
    h.session.events.emit('combat.bossDefeated', { hunterId: witness.id, bossId: 'warden', worldBoss: true });
    h.commands.purchaseLegacyUnlock('mentor_hall');
    const veteran = h.debug.spawnHunter({ level: 45 });
    h.session.events.emit('combat.companionLost', { hunterId: veteran.id, lostHunterId: witness.id });
    const mentor = h.commands.retireHunter(veteran.id);
    if (!mentor.ok) throw new Error(mentor.error);
    return { ...h, mentor: mentor.value };
  }

  it('an apprentice inherits the Legacy Trait the player chose, and pays for the training', () => {
    const h = withMentor('apprentice');
    const gold = h.session.resources.amount('gold');
    const apprentice = h.commands.takeApprentice(h.mentor.hunterId, 'keeper_of_the_fallen');
    expect(apprentice.ok).toBe(true);
    if (!apprentice.ok) return;
    expect(apprentice.value.traitIds).toContain('keeper_of_the_fallen');
    expect(h.session.roster.get(apprentice.value.id)?.traitIds).toContain('keeper_of_the_fallen');
    expect(h.session.resources.amount('gold')).toBe(gold - content.progression.apprentices.goldCost);
  });

  it('refuses a trait the mentor does not have, and a mentor who has trained their quota', () => {
    const h = withMentor('apprentice-limits');
    expect(h.commands.takeApprentice(h.mentor.hunterId, 'wardenbane').ok).toBe(false);
    expect(h.commands.takeApprentice(h.mentor.hunterId).ok).toBe(true);
    expect(h.commands.takeApprentice(h.mentor.hunterId).ok).toBe(false);
  });

  it('the inherited trait changes what the apprentice gains: Keeper of the Fallen earns more XP', () => {
    const plain = testSession('xp-plain');
    const kept = testSession('xp-plain');
    for (const h of [plain, kept]) h.commands.foundTown();
    const a = plain.debug.spawnHunter({ level: 5, fullyEquipped: true });
    const b = kept.debug.spawnHunter({ level: 5, fullyEquipped: true });
    // Same seed, same hunter; give one of them the inherited trait directly.
    kept.session.roster.update({ ...b, traitIds: [...b.traitIds, 'keeper_of_the_fallen' as never] });
    plain.commands.sendExpedition('verdant_reach', 'clear');
    kept.commands.sendExpedition('verdant_reach', 'clear');
    const after = (h: typeof plain, id: string) => {
      const hunter = h.session.roster.require(id as never);
      return hunter.level * 1e6 + hunter.xp;
    };
    expect(after(kept, b.id)).toBeGreaterThan(after(plain, a.id));
  });

  it('apprentice counts survive save/load', () => {
    const h = withMentor('apprentice-save');
    h.commands.takeApprentice(h.mentor.hunterId);
    const loaded = testSession('apprentice-load');
    loaded.session.restore(h.session.snapshot());
    expect(loaded.session.mentors.apprenticesOf(h.mentor.hunterId)).toBe(1);
  });
});

describe('innate traits act (they were rolled, shown and inert)', () => {
  function withTrait(seed: string, traitId: string | undefined, level = 20) {
    const h = testSession(seed);
    const base = h.debug.spawnHunter({ level, fullyEquipped: true });
    const hunter = { ...base, traitIds: traitId ? [traitId as never] : [] };
    h.session.roster.update(hunter);
    return { ...h, hunter };
  }

  it('Battle-Born leans into risk and Glass Nerves away from it', () => {
    const plain = withTrait('trait-risk', undefined);
    const bold = withTrait('trait-risk', 'battle_born');
    const nervy = withTrait('trait-risk', 'glass_nerves');
    const posture = (h: typeof plain) => h.session.buildIdentity.profileOf(h.hunter).riskPosture;
    expect(posture(bold)).toBeGreaterThan(posture(plain));
    expect(posture(nervy)).toBeLessThan(posture(plain));
  });

  it('Born Leader makes a better department head than the same hunter without it', () => {
    const plain = withTrait('trait-lead', undefined);
    const leader = withTrait('trait-lead', 'born_leader');
    expect(leader.session.departments.qualification(leader.hunter)).toBeGreaterThan(
      plain.session.departments.qualification(plain.hunter),
    );
  });

  it('expeditions make hunters hungry, Iron Stomach less so, and the town feeds them back down', () => {
    const plain = withTrait('trait-hunger', undefined);
    const iron = withTrait('trait-hunger', 'iron_stomach');
    for (const h of [plain, iron]) {
      h.commands.foundTown();
      h.session.roster.update({ ...h.session.roster.require(h.hunter.id), condition: { ...h.hunter.condition, hunger: 0 } });
      h.commands.sendExpedition('verdant_reach', 'clear');
    }
    const hungerOf = (h: typeof plain) => h.session.roster.require(h.hunter.id).condition.hunger;
    expect(hungerOf(plain)).toBeGreaterThan(0);
    expect(hungerOf(iron)).toBeLessThan(hungerOf(plain));

    const before = hungerOf(plain);
    plain.commands.advanceTown(200);
    expect(hungerOf(plain)).toBeLessThan(before);
  });

  it('Glass Nerves swings morale harder on the way home', () => {
    const plain = withTrait('trait-morale', undefined, 5);
    const nervy = withTrait('trait-morale', 'glass_nerves', 5);
    for (const h of [plain, nervy]) {
      h.commands.foundTown();
      h.session.roster.update({ ...h.session.roster.require(h.hunter.id), condition: { ...h.hunter.condition, morale: 0.5 } });
      h.commands.sendExpedition('verdant_reach', 'clear');
    }
    const swing = (h: typeof plain) => Math.abs(h.session.roster.require(h.hunter.id).condition.morale - 0.5);
    expect(swing(nervy)).toBeGreaterThan(swing(plain));
  });
});
