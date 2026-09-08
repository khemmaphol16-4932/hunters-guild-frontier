/**
 * Chronicle — a passive recorder that must never feed back into mechanics.
 * REQ-CHR-001..005, conflict A7, DL-006.
 */

import { describe, expect, it } from 'vitest';
import { testSession } from './helpers.js';
import { asHunterId, asItemId, asSkillId } from '../src/core/ids.js';

describe('chronicle records history', () => {
  it('starts every hunter with zeroed counters', () => {
    const { session, debug } = testSession('chr-init');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    const record = session.chronicle.of(hunter.id);

    expect(record.counters['expeditions']).toBe(0);
    expect(record.notable).toEqual([]);
  });

  it('counts expeditions and tracks the longest', () => {
    const { session, debug } = testSession('chr-exp');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });

    session.events.emit('expedition.completed', {
      hunterId: hunter.id,
      expeditionId: 'e1',
      durationSeconds: 120,
    });
    session.events.emit('expedition.completed', {
      hunterId: hunter.id,
      expeditionId: 'e2',
      durationSeconds: 400,
    });

    const record = session.chronicle.of(hunter.id);
    expect(record.counters['expeditions']).toBe(2);
    expect(record.counters['longestExpeditionSeconds']).toBe(400);
  });

  it('records the §19 counter set', () => {
    const { session, debug } = testSession('chr-counters');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    const other = debug.spawnHunter({ archetype: 'adept' });

    session.events.emit('combat.bossDefeated', {
      hunterId: hunter.id,
      bossId: 'the-warden-of-ash',
      worldBoss: false,
    });
    session.events.emit('combat.nearDeath', { hunterId: hunter.id });
    session.events.emit('combat.rescued', { hunterId: hunter.id, byHunterId: other.id });
    session.events.emit('combat.rescuePerformed', { hunterId: other.id, targetId: hunter.id });
    session.events.emit('loot.rareFound', {
      hunterId: hunter.id,
      itemId: asItemId('sunsteel-blade'),
      rarity: 'legendary',
    });
    session.events.emit('combat.companionLost', {
      hunterId: hunter.id,
      lostHunterId: other.id,
    });

    const record = session.chronicle.of(hunter.id);
    expect(record.counters['bossesDefeated']).toBe(1);
    expect(record.counters['nearDeaths']).toBe(1);
    expect(record.counters['timesRescued']).toBe(1);
    expect(record.counters['rareItemsFound']).toBe(1);
    expect(record.counters['companionsLost']).toBe(1);
    expect(session.chronicle.counter(other.id, 'rescuesPerformed')).toBe(1);
  });

  it('marks a first Black Zone entry as the most significant kind of memory', () => {
    const { session, debug } = testSession('chr-zone');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });

    session.events.emit('zone.firstEntered', {
      hunterId: hunter.id,
      zoneId: 'the-drowned-marches',
      tier: 'black',
    });

    const record = session.chronicle.of(hunter.id);
    const entry = record.notable.find((e) => e.kind === 'firstBlackZone');
    expect(entry).toBeDefined();
    expect(entry?.significance).toBe(5);
  });

  it('tracks the favourite skill as mastery accrues (§19)', () => {
    const { session, debug } = testSession('chr-fav');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    debug.grantSkill(hunter.id, 'shield_bash');
    debug.grantSkill(hunter.id, 'taunt');

    debug.grantMastery(hunter.id, 'shield_bash', 20);
    expect(session.chronicle.of(hunter.id).favouriteSkill).toBe('shield_bash');

    debug.grantMastery(hunter.id, 'taunt', 300);
    expect(session.chronicle.of(hunter.id).favouriteSkill).toBe('taunt');
  });
});

describe('REQ-CHR-003 — history never becomes a mechanic by itself', () => {
  it('recording a death changes no derived stat and no build profile', () => {
    // The spec is explicit: "Died in Red Zone" must not create a combat penalty. Only
    // Behavior Memory, Mastery, Traits and Legacy Traits convert history into effect.
    const { session, debug } = testSession('chr-passive');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 40, fullyEquipped: true });

    const before = session.buildIdentity.profileOf(session.roster.require(hunter.id));

    session.events.emit('combat.nearDeath', { hunterId: hunter.id });
    session.events.emit('zone.firstEntered', {
      hunterId: hunter.id,
      zoneId: 'ashfall',
      tier: 'red',
    });
    session.events.emit('combat.companionLost', {
      hunterId: hunter.id,
      lostHunterId: asHunterId('someone'),
    });

    const after = session.buildIdentity.profileOf(session.roster.require(hunter.id));

    expect(after).toEqual(before);
    // The history is nonetheless recorded — it exists as narrative, not as a penalty.
    expect(session.chronicle.of(hunter.id).counters['nearDeaths']).toBe(1);
  });

  it('leaves the hunter record itself untouched', () => {
    const { session, debug } = testSession('chr-record');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    const snapshot = JSON.stringify(session.roster.require(hunter.id));

    session.events.emit('combat.nearDeath', { hunterId: hunter.id });

    expect(JSON.stringify(session.roster.require(hunter.id))).toBe(snapshot);
  });
});

describe('DL-006 — bounded growth', () => {
  it('keeps the notable ring at its configured capacity', () => {
    const { session, debug } = testSession('chr-ring');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    const capacity = session.content.balance.chronicle.notableRing.capacity;

    for (let i = 0; i < capacity * 3; i++) {
      session.events.emit('combat.nearDeath', { hunterId: hunter.id });
    }

    const record = session.chronicle.of(hunter.id);
    expect(record.notable.length).toBe(capacity);
    // Counters stay unbounded and permanent, which is what §19's display needs.
    expect(record.counters['nearDeaths']).toBe(capacity * 3);
  });

  it('displaces the least significant entry, keeping the historic ones', () => {
    const { session, debug } = testSession('chr-significance');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    const capacity = session.content.balance.chronicle.notableRing.capacity;

    // One irreplaceable memory, then a flood of routine ones.
    session.events.emit('zone.firstEntered', {
      hunterId: hunter.id,
      zoneId: 'the-drowned-marches',
      tier: 'black',
    });
    for (let i = 0; i < capacity * 2; i++) {
      session.events.emit('mastery.milestone', {
        hunterId: hunter.id,
        skillId: asSkillId('shield_bash'),
        milestone: 10,
      });
    }

    const record = session.chronicle.of(hunter.id);
    expect(record.notable.length).toBe(capacity);
    expect(record.notable.some((e) => e.kind === 'firstBlackZone')).toBe(true);
  });

  it('never admits an entry below the minimum significance', () => {
    const { session, debug } = testSession('chr-min');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    const min = session.content.balance.chronicle.notableRing.minSignificance;

    for (const entry of session.chronicle.of(hunter.id).notable) {
      expect(entry.significance).toBeGreaterThanOrEqual(min);
    }
  });

  it('orders entries by simulation tick, not wall-clock time', () => {
    const { session, debug } = testSession('chr-ticks');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });

    session.events.emit('combat.nearDeath', { hunterId: hunter.id });
    debug.fastForward(60);
    session.events.emit('combat.nearDeath', { hunterId: hunter.id });

    const record = session.chronicle.of(hunter.id);
    expect(record.notable.length).toBe(2);
    expect(record.notable[1]?.tick).toBeGreaterThan(record.notable[0]?.tick ?? 0);
  });
});

describe('lifecycle', () => {
  it('restores from a saved record', () => {
    const { session, debug } = testSession('chr-restore');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    session.events.emit('combat.nearDeath', { hunterId: hunter.id });

    const saved = session.chronicle.all();
    const fresh = testSession('chr-restore-2');
    fresh.session.chronicle.restore(saved);

    expect(fresh.session.chronicle.counter(hunter.id, 'nearDeaths')).toBe(1);
  });

  it('stops recording once disposed', () => {
    const { session, debug } = testSession('chr-dispose');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    session.chronicle.dispose();

    session.events.emit('combat.nearDeath', { hunterId: hunter.id });
    expect(session.chronicle.counter(hunter.id, 'nearDeaths')).toBe(0);
  });
});
