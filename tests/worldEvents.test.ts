import { describe, expect, it } from 'vitest';
import { CURRENT_SAVE_VERSION } from '../src/save/envelope.js';
import { migratePayload } from '../src/save/migrations/index.js';
import { WorldEvents } from '../src/systems/world/WorldEvents.js';
import { testSession } from './helpers.js';

describe('world-boss events (REQ-BOS-003)', () => {
  it('places the Drowned Choir in a real region with its own card pool', () => {
    const { session, commands } = testSession('world-boss-placement');
    expect(commands.worldBossEvent()).toMatchObject({ bossId: 'the_drowned_choir', regionId: 'ashfall_barrows' });
    expect(session.content.monstersById.get('the_drowned_choir')?.cardPool).toEqual(['hollow_choir_card']);
  });

  it('removes a defeated event and respawns it deterministically', () => {
    const events = new WorldEvents();
    const first = events.currentWorldBoss(0)!;
    expect(events.defeat(first.id, 10)).toBe(true);
    expect(events.currentWorldBoss(509)).toBeUndefined();
    const second = events.currentWorldBoss(510);
    expect(second).toMatchObject({ id: 'drowned-choir:2', appearedAtTick: 510 });
  });

  it('persists active/respawn state and migrates older saves', () => {
    const first = new WorldEvents();
    const active = first.currentWorldBoss(12)!;
    const second = new WorldEvents();
    second.restore(first.snapshot());
    expect(second.currentWorldBoss(12)).toEqual(active);

    const migrated = migratePayload({}, 22, CURRENT_SAVE_VERSION) as Record<string, unknown>;
    expect(migrated['worldEvents']).toEqual({ nextWorldBossAtTick: 0, worldBossDefeats: 0 });
  });
});
