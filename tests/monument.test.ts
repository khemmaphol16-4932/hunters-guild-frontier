import { describe, expect, it } from 'vitest';
import { asItemId } from '../src/core/ids.js';
import { CURRENT_SAVE_VERSION } from '../src/save/envelope.js';
import { migratePayload } from '../src/save/migrations/index.js';
import { testSession } from './helpers.js';

describe('Guild Monument (REQ-MON-001)', () => {
  it('records historic event categories and ignores routine versions', () => {
    const { session, debug } = testSession('monument-events');
    const hunter = debug.spawnHunter({ level: 49 });
    session.events.emit('zone.firstEntered', { hunterId: hunter.id, zoneId: 'ashfall', tier: 'red' });
    session.events.emit('combat.bossDefeated', { hunterId: hunter.id, bossId: 'ordinary', worldBoss: false });
    session.events.emit('combat.bossDefeated', { hunterId: hunter.id, bossId: 'drowned_choir', worldBoss: true });
    session.events.emit('loot.rareFound', { hunterId: hunter.id, itemId: asItemId('relic'), rarity: 'legendary' });
    session.events.emit('hunter.leveled', { hunterId: hunter.id, level: 50 });

    expect(session.monument.all().map((entry) => entry.kind).sort()).toEqual([
      'frontierDiscovery',
      'legendaryFind',
      'legendaryHunter',
      'worldBossVictory',
    ].sort());
  });

  it('deduplicates party-wide achievements by stable identity', () => {
    const { session, debug } = testSession('monument-dedupe');
    const first = debug.spawnHunter();
    const second = debug.spawnHunter();
    for (const hunter of [first, second]) {
      session.events.emit('contract.completed', { hunterId: hunter.id, contractId: 'contract_7', name: 'The Last Watch', succeeded: true });
    }
    expect(session.monument.all()).toHaveLength(1);
    expect(session.monument.has('contract:contract_7')).toBe(true);
  });

  it('round-trips achievements and gives older saves an empty monument', () => {
    const first = testSession('monument-save');
    first.session.events.emit('town.stageReached', { stageId: 'city', name: 'Hunter City' });
    const second = testSession('monument-load');
    second.session.restore(first.session.snapshot());
    expect(second.session.monument.snapshot()).toEqual(first.session.monument.snapshot());

    const migrated = migratePayload({}, 17, CURRENT_SAVE_VERSION) as Record<string, unknown>;
    expect(migrated['monument']).toEqual({ entries: [] });
  });
});
