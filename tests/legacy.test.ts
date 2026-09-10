import { describe, expect, it } from 'vitest';
import { asItemId } from '../src/core/ids.js';
import { LEGACY_UNLOCKS } from '../src/systems/progression/Legacy.js';
import { CURRENT_SAVE_VERSION } from '../src/save/envelope.js';
import { migratePayload } from '../src/save/migrations/index.js';
import { testSession } from './helpers.js';

describe('Legacy (REQ-LEG-001)', () => {
  it('awards each Monument achievement once, from multiple sources', () => {
    const { session, debug } = testSession('legacy-awards');
    const hunter = debug.spawnHunter();
    session.events.emit('town.stageReached', { stageId: 'village', name: 'Village' });
    session.events.emit('loot.rareFound', { hunterId: hunter.id, itemId: asItemId('crown'), rarity: 'legendary' });
    const earned = session.legacy.lifetimePoints;
    session.events.emit('town.stageReached', { stageId: 'village', name: 'Village' });
    expect(earned).toBe(4);
    expect(session.legacy.lifetimePoints).toBe(earned);
  });

  it('offers breadth unlocks and spends points only by explicit player command', () => {
    const { session, commands } = testSession('legacy-unlocks');
    session.events.emit('town.stageReached', { stageId: 'village', name: 'Village' });
    expect(commands.purchaseLegacyUnlock('prepared_caravan').ok).toBe(true);
    expect(session.legacy.has('prepared_caravan')).toBe(true);
    expect(session.legacy.points).toBe(0);
    expect(commands.purchaseLegacyUnlock('prepared_caravan').ok).toBe(false);
    expect(LEGACY_UNLOCKS.every((unlock) => !/damage|health|attack|power/i.test(unlock.description))).toBe(true);
  });

  it('persists awards and unlocks while migrating older saves safely', () => {
    const first = testSession('legacy-save');
    first.session.events.emit('town.stageReached', { stageId: 'village', name: 'Village' });
    expect(first.commands.purchaseLegacyUnlock('carved_founders').ok).toBe(true);
    const second = testSession('legacy-load');
    second.session.restore(first.session.snapshot());
    expect(second.session.legacy.snapshot()).toEqual(first.session.legacy.snapshot());

    const migrated = migratePayload({}, 18, CURRENT_SAVE_VERSION) as Record<string, unknown>;
    expect(migrated['legacy']).toEqual({ earned: 0, spent: 0, awardedAchievements: [], unlocked: [] });
  });
});
