import { describe, expect, it } from 'vitest';
import { CURRENT_SAVE_VERSION } from '../src/save/envelope.js';
import { migratePayload } from '../src/save/migrations/index.js';
import { testSession } from './helpers.js';

function unlockMentors(seed: string) {
  const harness = testSession(seed);
  const witness = harness.debug.spawnHunter();
  harness.session.events.emit('combat.bossDefeated', { hunterId: witness.id, bossId: 'warden', worldBoss: true });
  expect(harness.commands.purchaseLegacyUnlock('mentor_hall').ok).toBe(true);
  return harness;
}

describe('retirement and mentors (REQ-LEG-004)', () => {
  it('requires player choice, the system unlock, experience, and availability', () => {
    const locked = testSession('mentor-locked');
    const veteran = locked.debug.spawnHunter({ level: 40 });
    expect(locked.commands.retireHunter(veteran.id).ok).toBe(false);

    const harness = unlockMentors('mentor-rules');
    const novice = harness.debug.spawnHunter({ level: 20 });
    expect(harness.commands.retireHunter(novice.id).ok).toBe(false);
    expect(harness.session.roster.get(novice.id)).toBeDefined();
  });

  it('turns an eligible hunter into a distinct mentor with historic Legacy Traits', () => {
    const harness = unlockMentors('mentor-retire');
    const veteran = harness.debug.spawnHunter({ level: 50 });
    harness.session.events.emit('combat.companionLost', { hunterId: veteran.id, lostHunterId: harness.session.roster.all()[0]!.id });
    const result = harness.commands.retireHunter(veteran.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(harness.session.roster.get(veteran.id)).toBeUndefined();
    expect(result.value.legacyTraits).toContain('companionLost');
    expect(result.value.experienceScale).toBeGreaterThan(1);
  });

  it('persists mentors and migrates older saves', () => {
    const first = unlockMentors('mentor-save');
    const veteran = first.debug.spawnHunter({ level: 40 });
    expect(first.commands.retireHunter(veteran.id).ok).toBe(true);
    const second = testSession('mentor-load');
    second.session.restore(first.session.snapshot());
    expect(second.session.mentors.snapshot()).toEqual(first.session.mentors.snapshot());

    const migrated = migratePayload({}, 19, CURRENT_SAVE_VERSION) as Record<string, unknown>;
    expect(migrated['mentors']).toEqual({ mentors: [] });
  });
});
