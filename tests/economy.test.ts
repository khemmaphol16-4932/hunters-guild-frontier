import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/data/loader.js';
import { Resources } from '../src/systems/economy/Resources.js';
import { testSession } from './helpers.js';

describe('guild resources (REQ-ECO-001/002)', () => {
  it('starts from authored balances and exposes the small resource set', () => {
    const resources = new Resources(loadContent().economy.resources);
    expect(resources.amount('gold')).toBe(3000);
    expect(Object.keys(resources.all())).toHaveLength(8);
  });

  it('applies multi-resource transactions atomically', () => {
    const resources = new Resources(loadContent().economy.resources);
    const before = resources.snapshot();
    const failed = resources.transact({ debits: { gold: 100, astral_shard: 1 }, credits: { iron: 4 } });
    expect(failed.ok).toBe(false);
    expect(resources.snapshot()).toEqual(before);

    expect(resources.transact({ debits: { gold: 100 }, credits: { iron: 4 } }).ok).toBe(true);
    expect(resources.amount('gold')).toBe(2900);
    expect(resources.amount('iron')).toBe(34);
  });

  it('round-trips through the current save payload', () => {
    const first = testSession('economy-save');
    first.session.resources.transact({ debits: { gold: 275 }, credits: { timber: 8 } });
    const second = testSession('economy-restore');
    second.session.restore(first.session.snapshot());
    expect(second.session.resources.snapshot()).toEqual(first.session.resources.snapshot());
  });

  it('does not place a building when the guild cannot pay', () => {
    const { session, commands } = testSession('economy-building');
    commands.foundTown();
    session.resources.transact({ debits: { gold: session.resources.amount('gold') } });
    const before = session.town.grid.snapshot();
    const spot = session.town.grid.legalPlacements('longhouse')[0];
    expect(spot).toBeDefined();
    if (!spot) return;
    expect(commands.placeBuilding('longhouse', spot.x, spot.y).ok).toBe(false);
    expect(session.town.grid.snapshot()).toEqual(before);
  });

  it('credits item sales to the same ledger', () => {
    const { session, commands, debug } = testSession('economy-selling');
    const item = debug.spawnItem({ itemLevel: 10 });
    const before = session.resources.amount('gold');
    const sold = commands.sellItem(String(item.id));
    expect(sold.ok).toBe(true);
    if (sold.ok) expect(session.resources.amount('gold')).toBe(before + sold.value.gold);
  });
});
