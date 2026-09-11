/**
 * Friendship (REQ-HUN-012) and the combat half of traits.
 */

import { describe, expect, it } from 'vitest';
import { migratePayload } from '../src/save/migrations/index.js';
import { loadContent } from '../src/data/loader.js';
import { outgoingMultiplier } from '../src/systems/combat/outgoing.js';
import type { Combatant } from '../src/core/combat/Combatant.js';
import type { Hunter } from '../src/core/hunter/Hunter.js';
import type { HunterId } from '../src/core/ids.js';
import { testSession } from './helpers.js';

const content = loadContent();
const balance = content.friendship;

describe('friendship bonds (REQ-HUN-012)', () => {
  it('grows between hunters who come home from the same expedition', () => {
    const h = testSession('bond-expedition');
    h.commands.foundTown();
    const a = h.debug.spawnHunter({ level: 20, fullyEquipped: true });
    const b = h.debug.spawnHunter({ level: 20, fullyEquipped: true });
    const outcome = h.commands.sendExpedition('verdant_reach', 'clear');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const went = outcome.value.party.members.map((m) => m.hunterId);
    // The only two hunters in the guild both go.
    expect(went).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(h.session.friendship.strength(a.id, b.id)).toBeCloseTo(balance.sharedExpedition);
  });

  it('grows much faster from a rescue, and faster still for a Loyal hunter', () => {
    const plain = testSession('bond-rescue');
    const a = plain.debug.spawnHunter();
    const b = plain.debug.spawnHunter();
    plain.session.events.emit('combat.rescued', { hunterId: a.id, byHunterId: b.id });
    expect(plain.session.friendship.strength(a.id, b.id)).toBeCloseTo(balance.rescue);

    const loyal = testSession('bond-loyal');
    const c = loyal.debug.spawnHunter();
    const d = loyal.debug.spawnHunter();
    loyal.session.roster.update({ ...c, traitIds: ['loyal' as never] });
    loyal.session.roster.update({ ...d, traitIds: ['loyal' as never] });
    loyal.session.events.emit('combat.rescued', { hunterId: c.id, byHunterId: d.id });
    expect(loyal.session.friendship.strength(c.id, d.id)).toBeGreaterThan(balance.rescue);
  });

  it('makes friends past the threshold, and ends when a hunter leaves', () => {
    const h = testSession('bond-friends');
    const a = h.debug.spawnHunter();
    const b = h.debug.spawnHunter();
    for (let i = 0; i < 4; i++) h.session.events.emit('combat.rescued', { hunterId: a.id, byHunterId: b.id });
    expect(h.session.friendship.areFriends(a.id, b.id)).toBe(true);
    expect(h.session.friendship.bondsOf(a.id)[0]).toMatchObject({ with: b.id, friends: true });
    h.session.friendship.forget(b.id);
    expect(h.session.friendship.strength(a.id, b.id)).toBe(0);
  });

  it('survives save/load and migrates from v23 as strangers', () => {
    const first = testSession('bond-save');
    const a = first.debug.spawnHunter();
    const b = first.debug.spawnHunter();
    first.session.events.emit('combat.rescued', { hunterId: a.id, byHunterId: b.id });
    const second = testSession('bond-load');
    second.session.restore(first.session.snapshot());
    expect(second.session.friendship.strength(a.id, b.id)).toBeCloseTo(balance.rescue);
    expect((migratePayload({}, 23, 24) as Record<string, unknown>)['friendship']).toEqual({ bonds: {} });
  });
});

describe('combat bonuses from traits and friendship', () => {
  const hunter = (id: string, traitIds: string[] = []): Hunter => ({ id, traitIds } as unknown as Hunter);
  const combatant = (id: string): Combatant => ({ hunterId: id as HunterId } as Combatant);
  function deps(hunters: Hunter[], friends: [string, string][] = []) {
    const byId = new Map(hunters.map((h) => [h.id as string, h]));
    return {
      traitsById: content.traitsById,
      hunterOf: (id: HunterId) => byId.get(id),
      areFriends: (a: HunterId, b: HunterId) => friends.some(([x, y]) => (x === a && y === b) || (x === b && y === a)),
      balance,
    };
  }

  it('Battle-Born grows with the length of the fight and caps', () => {
    const d = deps([hunter('a', ['battle_born'])]);
    const at = (seconds: number) => outgoingMultiplier(combatant('a'), [], seconds, d);
    expect(at(0)).toBe(1);
    expect(at(balance.sustainedFullSeconds / 2)).toBeGreaterThan(1);
    expect(at(balance.sustainedFullSeconds)).toBeCloseTo(at(balance.sustainedFullSeconds * 3));
    expect(at(balance.sustainedFullSeconds)).toBeGreaterThan(at(balance.sustainedFullSeconds / 2));
  });

  it('an inspiring ally lifts the hunter beside them', () => {
    const d = deps([hunter('a'), hunter('b', ['born_leader'])]);
    expect(outgoingMultiplier(combatant('a'), [combatant('b')], 0, d)).toBeGreaterThan(1);
    expect(outgoingMultiplier(combatant('a'), [], 0, d)).toBe(1);
  });

  it('a friend in the fight is worth one bonus, however many friends there are', () => {
    const d = deps([hunter('a'), hunter('b'), hunter('c')], [['a', 'b'], ['a', 'c']]);
    const one = outgoingMultiplier(combatant('a'), [combatant('b')], 0, d);
    const two = outgoingMultiplier(combatant('a'), [combatant('b'), combatant('c')], 0, d);
    expect(one).toBeCloseTo(1 + balance.friendCombatBonus);
    expect(two).toBeCloseTo(one);
  });

  it('Loyal hunters weigh a fallen ally more when deciding whether to go back', () => {
    const h = testSession('ally-safety');
    const plain = { ...h.debug.spawnHunter(), traitIds: [] };
    const loyal = { ...h.debug.spawnHunter(), traitIds: ['loyal' as never] };
    expect(h.session.buildIdentity.profileOf(loyal).allySafety).toBeGreaterThan(0);
    expect(h.session.buildIdentity.profileOf(plain).allySafety ?? 0).toBe(0);
  });
});

describe('friendship takes time', () => {
  it('diminishing returns: dozens of shared expeditions, not a handful, make two hunters friends', () => {
    const { session, debug } = testSession('bond-slow');
    const a = debug.spawnHunter();
    const b = debug.spawnHunter();
    session.roster.update({ ...a, traitIds: [] });
    session.roster.update({ ...b, traitIds: [] });
    let expeditions = 0;
    while (!session.friendship.areFriends(a.id, b.id) && expeditions < 500) {
      session.friendship.recordShared([a.id, b.id]);
      expeditions++;
    }
    expect(expeditions).toBeGreaterThan(20);
    expect(session.friendship.strength(a.id, b.id)).toBeLessThan(1);
  });
});
