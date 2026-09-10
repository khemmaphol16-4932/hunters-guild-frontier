import { describe, expect, it } from 'vitest';
import { testSession, workshopSession } from './helpers.js';

describe('Guild Mastery and Capability (REQ-GMA-001/REQ-CAP-001)', () => {
  it('earns institutional mastery from actual activity and persists it', () => {
    const first = workshopSession('guild-mastery');
    const hunter = first.debug.spawnHunter({ level: 30 });
    first.session.resources.transact({ credits: { salvage: 10 } });
    first.commands.craftItem('forge_blade', hunter.id);
    expect(first.session.guildMastery.pointsFrom('crafting')).toBe(
      first.session.content.progression.guildMastery.activityPoints.craftStarted,
    );
    const second = testSession('guild-mastery-load');
    second.session.restore(first.session.snapshot());
    expect(second.session.guildMastery.snapshot()).toEqual(first.session.guildMastery.snapshot());
  });

  it('reports seven independent capability axes and no universal score', () => {
    const h = testSession('capability');
    h.debug.spawnHunter({ level: 40, fullyEquipped: true });
    const vector = h.session.capability.read();
    expect(Object.keys(vector).sort()).toEqual(
      ['combat', 'crafting', 'defense', 'economic', 'expedition', 'research', 'resource'],
    );
    expect((vector as unknown as Record<string, unknown>)['total']).toBeUndefined();
  });

  it('lets different guild investments move different axes', () => {
    const a = testSession('cap-a');
    const b = testSession('cap-b');
    a.debug.spawnHunter({ level: 60 });
    b.debug.spawnHunter({ level: 10 });
    b.session.resources.transact({ credits: { gold: 100000 } });
    expect(a.session.capability.read().combat).toBeGreaterThan(b.session.capability.read().combat);
    expect(b.session.capability.read().economic).toBeGreaterThan(a.session.capability.read().economic);
  });
});
