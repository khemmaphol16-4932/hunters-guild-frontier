import { describe, expect, it } from 'vitest';
import { unspentAttributePoints } from '../src/core/hunter/Hunter.js';
import { testSession } from './helpers.js';
import { migratePayload } from '../src/save/migrations/index.js';

function fundAndCap(seed: string) {
  const h = testSession(seed);
  h.commands.foundGuild();
  const hunter = h.session.roster.all()[0]!;
  const rules = h.session.content.progression.rebirth;
  h.session.resources.transact({
    credits: {
      gold: rules.goldCost * rules.maxRebirths,
      insight_crystal: rules.insightCrystalCost * rules.maxRebirths,
    },
  });
  h.debug.setLevel(hunter.id, 100);
  return { ...h, hunterId: hunter.id, rules };
}

describe('Hunter rebirth (REQ-HUN-004)', () => {
  it('resets the journey while preserving identity and granting permanent rewards', () => {
    const h = fundAndCap('rebirth-reset');
    const before = h.session.roster.require(h.hunterId);
    const result = h.commands.rebirth(h.hunterId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      id: before.id,
      level: 1,
      xp: 0,
      rebirths: 1,
      bonusAttributePoints: 3,
      constellationBypasses: 1,
      knownSkills: before.knownSkills,
      mastery: before.mastery,
      personalityId: before.personalityId,
      potential: before.potential,
      loadout: [],
    });
    expect(unspentAttributePoints(result.value, h.session.content.balance.attributes)).toBe(
      h.session.content.balance.attributes.startingPoints + 3,
    );
    expect(h.session.chronicle.of(before.id).notable.some((entry) => entry.kind === 'rebirth')).toBe(true);
  });

  it('spends one bypass only when level is the remaining node requirement', () => {
    const h = fundAndCap('rebirth-bypass');
    expect(h.commands.rebirth(h.hunterId).ok).toBe(true);
    const early = h.commands.takeNode(h.hunterId, 'guard_stance', true);
    expect(early.ok, early.ok ? '' : early.error).toBe(true);
    expect(h.session.roster.require(h.hunterId).constellationBypasses).toBe(0);
    expect(h.commands.equipSkill(h.hunterId, 'guard_stance').ok).toBe(true);
    expect(h.commands.takeNode(h.hunterId, 'taunt', true).ok).toBe(false);
  });

  it('requires an Awakened choice on the third journey and stops after five', () => {
    const h = fundAndCap('rebirth-limit');
    for (let rank = 1; rank <= 5; rank++) {
      h.debug.setLevel(h.hunterId, 100);
      if (rank === 3) {
        expect(h.commands.rebirth(h.hunterId).ok).toBe(false);
        expect(h.commands.rebirth(h.hunterId, 'awakened_vigor').ok).toBe(true);
      } else {
        expect(h.commands.rebirth(h.hunterId).ok).toBe(true);
      }
    }
    const final = h.session.roster.require(h.hunterId);
    expect(final.rebirths).toBe(5);
    expect(final.traitIds).toContain('awakened_vigor');
    h.debug.setLevel(h.hunterId, 100);
    expect(h.commands.rebirth(h.hunterId).ok).toBe(false);
  });

  it('applies the cumulative mastery bonus throughout the new journey', () => {
    const h = fundAndCap('rebirth-mastery');
    const skill = h.session.roster.require(h.hunterId).knownSkills[0]!;
    const before = h.session.mastery.points(h.session.roster.require(h.hunterId), skill);
    h.commands.practiseSkill(h.hunterId, skill, 1);
    const baselineGain = h.session.mastery.points(h.session.roster.require(h.hunterId), skill) - before;
    h.debug.setLevel(h.hunterId, 100);
    expect(h.commands.rebirth(h.hunterId).ok).toBe(true);
    const rebornBefore = h.session.mastery.points(h.session.roster.require(h.hunterId), skill);
    h.commands.practiseSkill(h.hunterId, skill, 1);
    const rebornGain = h.session.mastery.points(h.session.roster.require(h.hunterId), skill) - rebornBefore;
    expect(rebornGain).toBeCloseTo(baselineGain * 1.1, 8);
  });

  it('migrates existing hunters with empty rebirth progress', () => {
    const migrated = migratePayload({ hunters: [{ id: 'old-hunter' }] }, 25, 26) as { hunters: Record<string, unknown>[] };
    expect(migrated.hunters[0]).toMatchObject({
      rebirths: 0,
      bonusAttributePoints: 0,
      constellationBypasses: 0,
      rebirthBypassedNodeIds: [],
    });
  });
});
