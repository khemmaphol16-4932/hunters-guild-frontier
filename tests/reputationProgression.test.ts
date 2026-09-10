import { describe, expect, it } from 'vitest';
import { CURRENT_SAVE_VERSION } from '../src/save/envelope.js';
import { migratePayload } from '../src/save/migrations/index.js';
import { testSession } from './helpers.js';

describe('reputation depth (REQ-REP-001)', () => {
  it('derives a readable rank without replacing the numerical value', () => {
    const reputation = testSession('reputation-rank').session.reputation;
    expect(reputation.rank()).toBe('unknown');
    reputation.change(10, 'first public success');
    expect(reputation.rank()).toBe('recognized');
    reputation.change(20, 'trusted work');
    expect(reputation.rank()).toBe('trusted');
    reputation.change(25, 'regional renown');
    expect(reputation.rank()).toBe('renowned');
    reputation.change(25, 'frontier legend');
    expect(reputation.rank()).toBe('legendary');
  });

  it('tracks expedition standing globally and in the region where it happened', () => {
    const reputation = testSession('regional-reputation').session.reputation;
    reputation.recordExpedition({
      zoneTier: 'red',
      bossDefeated: true,
      worldBoss: false,
      wiped: false,
      deaths: 0,
      regionId: 'ashfall',
      regionName: 'Ashfall',
    });

    expect(reputation.current).toBeGreaterThan(0);
    expect(reputation.regional('ashfall')).toBe(reputation.current);
    expect(reputation.regional('elsewhere')).toBe(0);
    expect(reputation.history().some((change) => change.regionId === 'ashfall')).toBe(true);
  });

  it('persists regional standing and migrates an older global-only ledger', () => {
    const first = testSession('regional-save').session;
    first.reputation.changeRegional('verdant', 32, 'protected Verdant Reach');
    const second = testSession('regional-load').session;
    second.restore(first.snapshot());

    expect(second.reputation.regional('verdant')).toBe(32);
    expect(second.reputation.regionalRank('verdant')).toBe('trusted');

    const migrated = migratePayload(
      { reputation: { value: 12, recent: [] }, guildMastery: { points: 0, byActivity: {} } },
      16,
      CURRENT_SAVE_VERSION,
    ) as Record<string, unknown>;
    expect(migrated['reputation']).toEqual({ value: 12, recent: [], regional: {} });
  });
});
