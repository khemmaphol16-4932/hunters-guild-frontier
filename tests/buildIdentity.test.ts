/**
 * Build Identity — the Phase 1 acceptance gate.
 *
 * REQ-BLD-001/002/003 and risk R2. The central promise of the design is that builds are not
 * stat packages: two hunters of the same class, built differently, must be *measurably*
 * different, and must be different along the axes the AI will actually consume.
 *
 * The behavioural half of REQ-BLD-003 (different builds produce different AI *decisions*)
 * cannot be tested until combat exists in Phase 4. These tests are the profile-level
 * proxy — if they fail, the behavioural version has no chance.
 */

import { describe, expect, it } from 'vitest';
import { testSession } from './helpers.js';
import { ROLES } from '../src/data/schema.js';
import { asSkillId } from '../src/core/ids.js';
import { describeBuild, profileDistance } from '../src/systems/hunter/describeBuild.js';
import { GuildCommands } from '../src/app/GuildCommands.js';
import type { Session } from '../src/app/Session.js';

/** Local helper for the few tests that construct commands mid-test. */
const commandsFor = (session: Session): GuildCommands => new GuildCommands(session);

/** Below this, two builds are effectively the same hunter with different numbers. */
const MEANINGFUL_DIFFERENCE = 0.08;

/**
 * Advancing a class and retraining moves the profile less than rebuilding a hunter's
 * attributes does, because class carries §16 weight 2 of 10 and the prototype's 12-skill
 * budget gives an advanced class only two skills the archetype lacked. Expected to rise as
 * content grows — tracked in TECH_DEBT.md.
 */
const ADVANCEMENT_DIFFERENCE = 0.07;

describe('profile shape', () => {
  it('normalises role lean to sum to one', () => {
    const { session, debug } = testSession('normalise');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', fullyEquipped: true });
    const profile = session.buildIdentity.profileOf(session.roster.require(hunter.id));

    const total = ROLES.reduce((sum, role) => sum + (profile.roleLean[role] ?? 0), 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('is pure — the same hunter always yields the same profile', () => {
    const { session, debug } = testSession('pure');
    const hunter = debug.spawnHunter({ archetype: 'ranger', fullyEquipped: true });
    const current = session.roster.require(hunter.id);

    expect(session.buildIdentity.profileOf(current)).toEqual(
      session.buildIdentity.profileOf(current),
    );
  });

  it('keeps risk posture and resource profile inside their clamps', () => {
    const { session, debug } = testSession('clamps');
    for (const archetype of ['vanguard', 'adept', 'ranger']) {
      const hunter = debug.spawnHunter({ archetype, fullyEquipped: true });
      const profile = session.buildIdentity.profileOf(session.roster.require(hunter.id));
      expect(profile.riskPosture).toBeGreaterThanOrEqual(0.05);
      expect(profile.riskPosture).toBeLessThanOrEqual(0.95);
      expect(profile.resourceProfile).toBeGreaterThanOrEqual(0);
      expect(profile.resourceProfile).toBeLessThanOrEqual(1);
    }
  });

  it('gives a class-appropriate primary role out of the box', () => {
    const { session, debug } = testSession('roles');

    const vanguard = debug.spawnHunter({ archetype: 'vanguard', fullyEquipped: true });
    const adept = debug.spawnHunter({ archetype: 'adept', fullyEquipped: true });
    const ranger = debug.spawnHunter({ archetype: 'ranger', fullyEquipped: true });

    expect(session.buildIdentity.profileOf(session.roster.require(vanguard.id)).primaryRole).toBe(
      'tank',
    );
    expect(session.buildIdentity.profileOf(session.roster.require(adept.id)).primaryRole).toBe(
      'healer',
    );
    expect(session.buildIdentity.profileOf(session.roster.require(ranger.id)).primaryRole).toBe(
      'damage',
    );
  });
});

describe('REQ-BLD-003 — builds must be measurably different', () => {
  it('same class, opposite attribute spreads → different builds', () => {
    const { session, debug } = testSession('attrs');

    const bruiser = debug.spawnHunter({
      archetype: 'vanguard',
      personality: 'stoic',
      level: 60,
      fullyEquipped: true,
    });
    const bulwark = debug.spawnHunter({
      archetype: 'vanguard',
      personality: 'stoic',
      level: 60,
      fullyEquipped: true,
    });

    debug.maxOut(bruiser.id, 'str');
    debug.maxOut(bulwark.id, 'vit');

    const a = session.buildIdentity.profileOf(session.roster.require(bruiser.id));
    const b = session.buildIdentity.profileOf(session.roster.require(bulwark.id));

    expect(profileDistance(a, b)).toBeGreaterThan(MEANINGFUL_DIFFERENCE);
    // The STR build must lean harder into damage than the VIT build.
    expect(a.roleLean.damage ?? 0).toBeGreaterThan(b.roleLean.damage ?? 0);
    expect(b.roleLean.tank ?? 0).toBeGreaterThan(a.roleLean.tank ?? 0);
    // And be readier to take a fight.
    expect(a.riskPosture).toBeGreaterThan(b.riskPosture);
  });

  it('same class and attributes, different mastery → different builds (§140-L)', () => {
    // REQ-PRIME-004: what a hunter actually does shapes what they become.
    const { session, debug } = testSession('mastery-identity');

    // Both are Sentinels so that riposte and taunt are genuinely in their repertoire —
    // mastery in a skill a hunter cannot use must not, and does not, shape their identity.
    const counterFighter = debug.spawnHunter({
      archetype: 'vanguard',
      personality: 'stoic',
      level: 40,
    });
    const shieldUser = debug.spawnHunter({
      archetype: 'vanguard',
      personality: 'stoic',
      level: 40,
    });

    for (const id of [counterFighter.id, shieldUser.id]) {
      debug.advance(id, 'sentinel');
      debug.refreshLoadout(id);
      debug.maxOut(id, 'str');
    }

    const before = profileDistance(
      session.buildIdentity.profileOf(session.roster.require(counterFighter.id)),
      session.buildIdentity.profileOf(session.roster.require(shieldUser.id)),
    );
    expect(before).toBeLessThan(0.01); // identical to start with

    debug.grantMastery(counterFighter.id, 'riposte', 3000, 'decisive');
    debug.grantMastery(shieldUser.id, 'taunt', 3000, 'decisive');

    const a = session.buildIdentity.profileOf(session.roster.require(counterFighter.id));
    const b = session.buildIdentity.profileOf(session.roster.require(shieldUser.id));

    expect(profileDistance(a, b)).toBeGreaterThan(before);
    // Ten thousand ripostes should read as a damage-leaning hunter; ten thousand taunts
    // should read as a tank, whatever the class sheet says.
    expect(a.roleLean.damage ?? 0).toBeGreaterThan(b.roleLean.damage ?? 0);
    expect(b.roleLean.tank ?? 0).toBeGreaterThan(a.roleLean.tank ?? 0);
    expect(a.skillAffinity['precision'] ?? 0).toBeGreaterThan(b.skillAffinity['precision'] ?? 0);
  });

  it('same class, attributes and mastery, different personality → different disposition (§140-K)', () => {
    const { session, debug } = testSession('personality-identity');

    const careful = debug.spawnHunter({
      archetype: 'vanguard',
      personality: 'cautious',
      level: 40,
      fullyEquipped: true,
    });
    const rash = debug.spawnHunter({
      archetype: 'vanguard',
      personality: 'reckless',
      level: 40,
      fullyEquipped: true,
    });

    debug.maxOut(careful.id, 'str');
    debug.maxOut(rash.id, 'str');

    const a = session.buildIdentity.profileOf(session.roster.require(careful.id));
    const b = session.buildIdentity.profileOf(session.roster.require(rash.id));

    expect(b.riskPosture).toBeGreaterThan(a.riskPosture);
    // But personality must not flip the primary role — it changes HOW, not WHETHER.
    expect(a.primaryRole).toBe(b.primaryRole);
  });

  it('advancing and training reshapes identity substantially', () => {
    // Advancing then training is the realistic flow: an advanced class unlocks skills
    // (ultimates and party skills are gated above archetype level), and a hunter who takes
    // them up is a different proposition from one who never advanced.
    const { session, debug } = testSession('specialise');

    const generic = debug.spawnHunter({ archetype: 'vanguard', personality: 'stoic', level: 60 });
    const specialised = debug.spawnHunter({
      archetype: 'vanguard',
      personality: 'stoic',
      level: 60,
    });

    debug.refreshLoadout(generic.id);
    debug.advance(specialised.id, 'sentinel');
    debug.advance(specialised.id, 'bulwark');
    debug.refreshLoadout(specialised.id);

    const a = session.buildIdentity.profileOf(session.roster.require(generic.id));
    const b = session.buildIdentity.profileOf(session.roster.require(specialised.id));

    expect(profileDistance(a, b)).toBeGreaterThan(ADVANCEMENT_DIFFERENCE);
    expect(b.roleLean.tank ?? 0).toBeGreaterThan(a.roleLean.tank ?? 0);
    expect(b.focus).toBeGreaterThan(a.focus);
  });

  it('records that a class change alone still moves the profile, if less sharply', () => {
    // Documents the calibration: class carries §16 weight 2 of 10, so advancing without
    // learning anything new is a real but modest shift. If this ever reads as zero, the
    // class contribution has stopped mattering and REQ-BLD-002 has been broken.
    const { session, debug } = testSession('class-only');

    const generic = debug.spawnHunter({ archetype: 'vanguard', personality: 'stoic', level: 60, fullyEquipped: true });
    const specialised = debug.spawnHunter({ archetype: 'vanguard', personality: 'stoic', level: 60, fullyEquipped: true });

    debug.advance(specialised.id, 'sentinel');
    debug.advance(specialised.id, 'bulwark');

    const distance = profileDistance(
      session.buildIdentity.profileOf(session.roster.require(generic.id)),
      session.buildIdentity.profileOf(session.roster.require(specialised.id)),
    );

    expect(distance).toBeGreaterThan(0.02);
    expect(distance).toBeLessThan(ADVANCEMENT_DIFFERENCE);
  });

  it('two different specialisations of the same advanced class diverge', () => {
    // Sentinels who took Bulwark and Warden must not be the same hunter.
    const { session, debug } = testSession('two-specs');

    const bulwark = debug.spawnHunter({ archetype: 'vanguard', personality: 'stoic', level: 60, fullyEquipped: true });
    const warden = debug.spawnHunter({ archetype: 'vanguard', personality: 'stoic', level: 60, fullyEquipped: true });

    for (const id of [bulwark.id, warden.id]) debug.advance(id, 'sentinel');
    debug.advance(bulwark.id, 'bulwark');
    debug.advance(warden.id, 'warden');

    const a = session.buildIdentity.profileOf(session.roster.require(bulwark.id));
    const b = session.buildIdentity.profileOf(session.roster.require(warden.id));

    expect(profileDistance(a, b)).toBeGreaterThan(0.02);
    expect(b.roleLean.support ?? 0).toBeGreaterThan(a.roleLean.support ?? 0);
  });
});

describe('identity axes', () => {
  it('counts known-but-unequipped skills as versatility (the Skill Books axis of §16)', () => {
    const { session, debug } = testSession('versatility');

    const narrow = debug.spawnHunter({ archetype: 'vanguard', level: 40 });
    const broad = debug.spawnHunter({ archetype: 'vanguard', level: 40 });

    debug.grantSkill(narrow.id, 'shield_bash');
    debug.equip(narrow.id, 'shield_bash');

    for (const skill of session.registry.all()) debug.grantSkill(broad.id, skill.id);
    debug.equip(broad.id, 'shield_bash');

    const a = session.buildIdentity.profileOf(session.roster.require(narrow.id));
    const b = session.buildIdentity.profileOf(session.roster.require(broad.id));

    expect(b.versatility).toBeGreaterThan(a.versatility);
    expect(a.versatility).toBe(0);
  });

  it('reads burst versus sustain off the loadout', () => {
    const { session, debug } = testSession('resource-profile');

    const burst = debug.spawnHunter({ archetype: 'vanguard', level: 60 });
    const sustain = debug.spawnHunter({ archetype: 'vanguard', level: 60 });

    // last_stand: 35 cost, 120s cooldown. riposte: 5 cost, 6s cooldown.
    debug.grantSkill(burst.id, 'last_stand');
    debug.equip(burst.id, 'last_stand');
    debug.grantSkill(sustain.id, 'riposte');
    debug.equip(sustain.id, 'riposte');

    const a = session.buildIdentity.profileOf(session.roster.require(burst.id));
    const b = session.buildIdentity.profileOf(session.roster.require(sustain.id));

    expect(b.resourceProfile).toBeGreaterThan(a.resourceProfile);
  });

  it('makes a fatigued hunter more cautious (§48)', () => {
    const { session, debug } = testSession('fatigue');
    const hunter = debug.spawnHunter({ archetype: 'ranger', personality: 'stoic', level: 40, fullyEquipped: true });

    const rested = session.buildIdentity.profileOf(session.roster.require(hunter.id));

    const tired = session.condition.set(session.roster.require(hunter.id), {
      fatigue: 1,
      hunger: 1,
    });
    session.roster.update(tired);
    const exhausted = session.buildIdentity.profileOf(tired);

    expect(exhausted.riskPosture).toBeLessThan(rested.riskPosture);
  });

  it('classifies shape by how dominant the primary role is', () => {
    const { session, debug } = testSession('shape');
    const specialist = debug.spawnHunter({ archetype: 'vanguard', personality: 'stoic', level: 60, fullyEquipped: true });
    debug.advance(specialist.id, 'sentinel');
    debug.advance(specialist.id, 'bulwark');
    debug.maxOut(specialist.id, 'vit');

    const profile = session.buildIdentity.profileOf(session.roster.require(specialist.id));
    expect(profile.shape).toBe('specialist');
    expect(profile.focus).toBeGreaterThanOrEqual(
      session.content.balance.buildIdentity.confidence.specialistThreshold,
    );
  });

  it('survives a hunter with no skills at all', () => {
    const { session, debug } = testSession('empty');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    const profile = session.buildIdentity.profileOf(session.roster.require(hunter.id));

    expect(Number.isFinite(profile.riskPosture)).toBe(true);
    expect(profile.versatility).toBe(0);
    expect(ROLES.reduce((s, r) => s + (profile.roleLean[r] ?? 0), 0)).toBeCloseTo(1, 6);
  });
});

describe('plain-language description (REQ-UX-003)', () => {
  it('produces a readable summary with no raw numbers', () => {
    const { session, debug } = testSession('describe');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 40, fullyEquipped: true });
    const description = describeBuild(
      session.buildIdentity.profileOf(session.roster.require(hunter.id)),
    );

    expect(description.summary.length).toBeGreaterThan(20);
    expect(description.summary).not.toMatch(/0\.\d/);
    expect(description.tendencies.length).toBeGreaterThan(0);
  });

  it('names weaknesses honestly', () => {
    const { session, debug } = testSession('weakness');
    // A glass cannon: ranger, all STR, aggressive personality, melee loadout.
    const hunter = debug.spawnHunter({
      archetype: 'ranger',
      personality: 'reckless',
      level: 60,
      fullyEquipped: true,
    });
    debug.maxOut(hunter.id, 'str');

    const description = describeBuild(
      session.buildIdentity.profileOf(session.roster.require(hunter.id)),
    );
    expect(description.weaknesses.length).toBeGreaterThan(0);
  });

  it('reports zero distance between a profile and itself', () => {
    const { session, debug } = testSession('self-distance');
    const hunter = debug.spawnHunter({ archetype: 'adept', fullyEquipped: true });
    const profile = session.buildIdentity.profileOf(session.roster.require(hunter.id));
    expect(profileDistance(profile, profile)).toBe(0);
  });
});

describe('equipment and card contributions (DL-009 / conflict B7)', () => {
  it('normalises with no equipment at all', () => {
    // A hunter wearing nothing must still produce a coherent profile — equipment and cards
    // carry §16 weight 2 and 1, and contributing zero must not distort the remainder.
    const { session, debug } = testSession('no-gear');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', fullyEquipped: true });
    const profile = session.buildIdentity.profileOf(session.roster.require(hunter.id));

    expect(ROLES.reduce((s, r) => s + (profile.roleLean[r] ?? 0), 0)).toBeCloseTo(1, 6);
    expect(profile.primaryRole).toBeDefined();
  });

  it('shifts identity when equipment is put on', () => {
    const { session, debug } = testSession('gear-shift');
    const hunter = debug.spawnHunter({ archetype: 'ranger', level: 60, fullyEquipped: true });

    const bare = session.buildIdentity.profileOf(session.roster.require(hunter.id));
    debug.outfit(hunter.id, { rarity: 'epic' });
    const geared = session.buildIdentity.profileOf(session.roster.require(hunter.id));

    expect(profileDistance(bare, geared)).toBeGreaterThan(0.01);
  });

  it('makes gear choice a real identity decision, not just a stat one', () => {
    // Two identical Vanguards. One takes a shield and a maul; the other takes a stave and
    // a focus. They should no longer read as the same kind of hunter.
    const { session, debug } = testSession('gear-identity');

    const defender = debug.spawnHunter({
      archetype: 'vanguard',
      personality: 'stoic',
      level: 60,
      fullyEquipped: true,
    });
    const caster = debug.spawnHunter({
      archetype: 'vanguard',
      personality: 'stoic',
      level: 60,
      fullyEquipped: true,
    });

    const before = profileDistance(
      session.buildIdentity.profileOf(session.roster.require(defender.id)),
      session.buildIdentity.profileOf(session.roster.require(caster.id)),
    );
    expect(before).toBeLessThan(0.01);

    for (const [hunterId, types] of [
      [defender.id, ['maul', 'shield', 'cuirass']],
      [caster.id, ['stave', 'focus', 'robes']],
    ] as const) {
      for (const typeId of types) {
        const item = debug.spawnItem({ itemLevel: 60, typeId, rarity: 'epic' });
        expect(commandsFor(session).equipItem(hunterId, String(item.id)).ok).toBe(true);
      }
    }

    const a = session.buildIdentity.profileOf(session.roster.require(defender.id));
    const b = session.buildIdentity.profileOf(session.roster.require(caster.id));

    expect(profileDistance(a, b)).toBeGreaterThan(before);
    expect(profileDistance(a, b)).toBeGreaterThan(MEANINGFUL_DIFFERENCE);
    expect(a.roleLean.tank ?? 0).toBeGreaterThan(b.roleLean.tank ?? 0);
    expect(b.roleLean.healer ?? 0).toBeGreaterThan(a.roleLean.healer ?? 0);
    expect(a.rangeBand.melee ?? 0).toBeGreaterThan(b.rangeBand.melee ?? 0);
  });

  it('lets a boss card visibly change a hunter (§131)', () => {
    // "Holy shit, that Boss Card completely changed this Hunter" is a stated success
    // criterion. If a boss card cannot move the profile, it is not changing the build.
    const { session, commands, debug } = testSession('boss-card');
    const hunter = debug.spawnHunter({
      archetype: 'vanguard',
      personality: 'stoic',
      level: 60,
      fullyEquipped: true,
    });

    const shield = debug.spawnItem({ itemLevel: 60, typeId: 'shield', rarity: 'ancient' });
    expect(commands.equipItem(hunter.id, String(shield.id)).ok).toBe(true);

    const before = session.buildIdentity.profileOf(session.roster.require(hunter.id));

    debug.giveCard('warden_of_ash_card');
    expect(commands.socketCard(String(shield.id), 'warden_of_ash_card').ok).toBe(true);

    const after = session.buildIdentity.profileOf(session.roster.require(hunter.id));

    expect(profileDistance(before, after)).toBeGreaterThan(0.01);
    // The Warden's card is aggressive threat-holding: it should push both tank lean and
    // risk posture up, which is a behavioural change, not a numeric one.
    expect(after.roleLean.tank ?? 0).toBeGreaterThan(before.roleLean.tank ?? 0);
    expect(after.riskPosture).toBeGreaterThan(before.riskPosture);
  });

  it('lets a legendary unique effect reshape the build (REQ-EQP-007)', () => {
    const { session, commands, debug } = testSession('legendary-identity');
    const hunter = debug.spawnHunter({
      archetype: 'adept',
      personality: 'stoic',
      level: 60,
      fullyEquipped: true,
    });

    const plain = debug.spawnItem({ itemLevel: 60, typeId: 'sigil', rarity: 'epic' });
    expect(commands.equipItem(hunter.id, String(plain.id)).ok).toBe(true);
    const before = session.buildIdentity.profileOf(session.roster.require(hunter.id));

    // The Widow's Ledger: halves ordinary healing, transforms rescue. A hunter carrying it
    // should read as a rescue specialist rather than a steady healer.
    const legendary = {
      ...debug.spawnItem({ itemLevel: 60, typeId: 'sigil', rarity: 'legendary' }),
      uniqueEffectId: 'widows_ledger',
    };
    session.armoury.update(legendary);
    expect(commands.equipItem(hunter.id, String(legendary.id)).ok).toBe(true);

    const after = session.buildIdentity.profileOf(session.roster.require(hunter.id));

    expect(profileDistance(before, after)).toBeGreaterThan(0.005);
    expect(after.skillAffinity['rescue'] ?? 0).toBeGreaterThan(
      before.skillAffinity['rescue'] ?? 0,
    );
    expect(after.riskPosture).toBeGreaterThan(before.riskPosture);
  });

  it('lets a completed set change identity beyond its individual pieces', () => {
    const { session, commands, debug } = testSession('set-identity');
    const hunter = debug.spawnHunter({
      archetype: 'vanguard',
      personality: 'stoic',
      level: 60,
      fullyEquipped: true,
    });

    // Three pieces of one set, then the fourth. Only the last one completes the 4-piece
    // tier, which is the tier that shifts an AI weight.
    const slots = ['head', 'body', 'hands', 'feet'] as const;
    const items = slots.map((slot) =>
      debug.spawnItem({ itemLevel: 60, slot, rarity: 'epic', setId: 'ashwardens' }),
    );

    for (const item of items.slice(0, 3)) {
      expect(commands.equipItem(hunter.id, String(item.id)).ok).toBe(true);
    }
    const threePieces = session.buildIdentity.profileOf(session.roster.require(hunter.id));

    const fourth = items[3];
    expect(fourth).toBeDefined();
    if (!fourth) return;
    expect(commands.equipItem(hunter.id, String(fourth.id)).ok).toBe(true);
    const fourPieces = session.buildIdentity.profileOf(session.roster.require(hunter.id));

    expect(profileDistance(threePieces, fourPieces)).toBeGreaterThan(0);
    expect(fourPieces.riskPosture).toBeGreaterThan(threePieces.riskPosture);
  });

  it('keeps the profile normalised however much gear is worn', () => {
    const { session, debug } = testSession('gear-normalised');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 60, fullyEquipped: true });

    debug.outfit(hunter.id, { rarity: 'ancient', setId: 'ashwardens' });
    debug.giveCard('bulwark_sigil');
    debug.giveCard('counterpoise');
    debug.socketAvailable(hunter.id);

    const profile = session.buildIdentity.profileOf(session.roster.require(hunter.id));
    expect(ROLES.reduce((s, r) => s + (profile.roleLean[r] ?? 0), 0)).toBeCloseTo(1, 6);
    expect(profile.riskPosture).toBeGreaterThanOrEqual(0.05);
    expect(profile.riskPosture).toBeLessThanOrEqual(0.95);
  });
});

describe('mastery identity weight', () => {
  it('saturates so that no single skill can dominate a build outright', () => {
    const { session } = testSession('identity-weight');
    const modest = session.mastery.identityWeight(100);
    const heavy = session.mastery.identityWeight(10_000);
    const absurd = session.mastery.identityWeight(1_000_000);

    expect(heavy).toBeGreaterThan(modest);
    expect(absurd).toBeGreaterThan(heavy);
    expect(absurd).toBeLessThanOrEqual(
      session.content.balance.mastery.buildIdentityInfluence.maxWeight,
    );
  });

  it('is zero for an unused skill', () => {
    const { session, debug } = testSession('unused');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', fullyEquipped: true });
    const current = session.roster.require(hunter.id);
    expect(session.mastery.points(current, asSkillId('shield_bash'))).toBe(0);
    expect(session.mastery.identityWeight(0)).toBe(0);
  });
});
