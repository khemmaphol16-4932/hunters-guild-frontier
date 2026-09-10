import { describe, expect, it } from 'vitest';
import { CURRENT_SAVE_VERSION } from '../src/save/envelope.js';
import { migratePayload } from '../src/save/migrations/index.js';
import { testSession } from './helpers.js';

function earnWorldBossLegacy(seed: string) {
  const harness = testSession(seed);
  const hunter = harness.debug.spawnHunter({ level: 50 });
  harness.session.events.emit('combat.bossDefeated', { hunterId: hunter.id, bossId: 'warden', worldBoss: true });
  return { ...harness, hunter };
}

describe('New Game+ (REQ-LEG-002/003)', () => {
  it('rejects locked variants without beginning a cycle', () => {
    const { session, commands } = testSession('ng-locked');
    expect(commands.beginNewGamePlus({ worldVariant: 'long_winter' }).ok).toBe(false);
    expect(session.newGamePlus.cycle).toBe(0);
  });

  it('resets world progression while retaining Legacy and applying an unlocked opening', () => {
    const { session, commands } = earnWorldBossLegacy('ng-reset');
    expect(commands.purchaseLegacyUnlock('prepared_caravan').ok).toBe(true);
    session.reputation.change(40, 'old-cycle fame');
    session.guildMastery.record('expedition', 40);
    const baselineFood = testSession('ng-reset').session.resources.amount('food');

    expect(commands.beginNewGamePlus({ startingChoice: 'prepared_caravan' })).toEqual({ ok: true, value: 1 });
    expect(session.roster.size).toBe(0);
    expect(session.chronicle.all()).toEqual([]);
    expect(session.reputation.current).toBe(0);
    expect(session.guildMastery.points).toBe(0);
    expect(session.monument.all()).toEqual([]);
    expect(session.legacy.has('prepared_caravan')).toBe(true);
    expect(session.resources.amount('food')).toBe(baselineFood + 20);
  });

  it('retains only the mentors selected for the next generation and persists cycle state', () => {
    const first = earnWorldBossLegacy('ng-mentors');
    expect(first.commands.purchaseLegacyUnlock('mentor_hall').ok).toBe(true);
    const retired = first.commands.retireHunter(first.hunter.id);
    expect(retired.ok).toBe(true);
    if (!retired.ok) return;
    expect(first.commands.beginNewGamePlus({ mentorIds: [retired.value.hunterId] }).ok).toBe(true);
    expect(first.session.mentors.has(retired.value.hunterId)).toBe(true);

    const second = testSession('ng-load');
    second.session.restore(first.session.snapshot());
    expect(second.session.newGamePlus.cycle).toBe(1);
    expect(second.session.mentors.has(retired.value.hunterId)).toBe(true);

    const migrated = migratePayload({}, 20, CURRENT_SAVE_VERSION) as Record<string, unknown>;
    expect(migrated['newGamePlus']).toEqual({ cycle: 0 });
  });

  it('restarts a cycle from deterministic RNG streams', () => {
    const first = testSession('ng-deterministic');
    const second = testSession('ng-deterministic');
    first.debug.spawnHunter();
    first.debug.spawnHunter();
    expect(first.commands.beginNewGamePlus().ok).toBe(true);
    expect(second.commands.beginNewGamePlus().ok).toBe(true);
    expect(first.debug.spawnHunter()).toEqual(second.debug.spawnHunter());
  });
});
