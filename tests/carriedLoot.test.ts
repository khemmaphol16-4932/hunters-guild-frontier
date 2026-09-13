/**
 * Personal carried loot, sold to the Guild on return (REQ-CW-008/011; DL-076).
 */

import { describe, expect, it } from 'vitest';
import { testSession } from './helpers.js';
import { migratePayload } from '../src/save/migrations/index.js';

function guild(seed = 'carried-loot') {
  const h = testSession(seed);
  h.commands.foundGuild();
  return h;
}

describe('carried loot (REQ-CW-008/011)', () => {
  it('the Guild buys the loot a party carries home, paying the hunters', () => {
    const h = guild();
    const goldBefore = h.session.resources.amount('gold');
    const armouryBefore = h.session.armoury.all().length;
    const outcome = h.commands.sendExpedition('verdant_reach', 'clear');
    if (!outcome.ok) throw new Error(outcome.error);
    const party = outcome.value.party.members.map((m) => m.hunterId);

    const earned = party.reduce((sum, id) => sum + h.session.holdings.moneyOf(id), 0);
    // A rich Guild buys everything: the hunters were paid, the items reached the armoury, and the
    // Guild's gold fell by exactly what it paid (net of the run's own gold reward).
    expect(earned).toBeGreaterThan(0);
    expect(h.session.armoury.all().length).toBe(armouryBefore + outcome.value.loot.length);
    expect(h.session.resources.amount('gold')).toBe(goldBefore + outcome.value.resources.gold - earned);
    // Nothing left carried once the Guild has paid for it all.
    for (const id of party) expect(h.session.holdings.carriedOf(id)).toHaveLength(0);
  });

  it('a hunter keeps loot the Guild cannot pay for, and sells it once the Guild can', () => {
    const h = guild('carried-broke');
    // Empty the treasury so the Guild cannot buy the haul on return.
    h.session.resources.transact({ debits: { gold: h.session.resources.amount('gold') } });
    const outcome = h.commands.sendExpedition('verdant_reach', 'clear');
    if (!outcome.ok) throw new Error(outcome.error);
    const party = outcome.value.party.members.map((m) => m.hunterId);

    const carried = party.reduce((sum, id) => sum + h.session.holdings.carriedOf(id).length, 0);
    expect(carried).toBeGreaterThan(0); // kept, not lost — the Guild could not pay
    expect(h.session.armoury.all()).toHaveLength(0); // nothing sold in yet

    // The Guild comes into money; the next settle offers the carried loot again and buys it.
    h.session.resources.transact({ credits: { gold: 100_000 } });
    h.commands.passTime(1);
    const stillCarried = party.reduce((sum, id) => sum + h.session.holdings.carriedOf(id).length, 0);
    expect(stillCarried).toBe(0);
    expect(h.session.armoury.all().length).toBe(carried);
    expect(party.reduce((sum, id) => sum + h.session.holdings.moneyOf(id), 0)).toBeGreaterThan(0);
  });

  it('carries the personal money and loot across a save and reload', () => {
    const h = guild('carried-save');
    h.session.resources.transact({ debits: { gold: h.session.resources.amount('gold') } });
    const outcome = h.commands.sendExpedition('verdant_reach', 'clear');
    if (!outcome.ok) throw new Error(outcome.error);
    const party = outcome.value.party.members.map((m) => m.hunterId);
    const carriedBefore = party.map((id) => h.session.holdings.carriedOf(id).length);

    const reloaded = testSession('carried-save');
    reloaded.session.restore(JSON.parse(JSON.stringify(h.session.snapshot())));
    expect(party.map((id) => reloaded.session.holdings.carriedOf(id).length)).toEqual(carriedBefore);
  });

  it('migrates a v28 save to empty holdings', () => {
    const migrated = migratePayload({ hunters: [] }, 28, 29) as Record<string, unknown>;
    expect(migrated['holdings']).toEqual({ holdings: [] });
  });

  it('authors a Red-zone carried-loss chance (owner-approved 10%)', () => {
    const { session } = guild('carried-config');
    expect(session.content.balance.loot.carriedLoot.redZoneLossChance).toBeCloseTo(0.1);
  });
});
