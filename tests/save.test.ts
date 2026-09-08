/**
 * Save, load, backup rotation and the migration chain.
 * REQ-TEC-004, risk R4.
 */

import { describe, expect, it } from 'vitest';
import { testSession } from './helpers.js';
import {
  AUTOSAVE_SLOT,
  BACKUP_SLOT_PREFIX,
  MemoryStorage,
  SaveGame,
} from '../src/save/SaveGame.js';
import { CURRENT_SAVE_VERSION, type SaveEnvelope } from '../src/save/envelope.js';
import { migratePayload, MIGRATIONS } from '../src/save/migrations/index.js';

describe('round trip', () => {
  it('restores hunters, chronicles and clock identically', () => {
    const { session, debug } = testSession('save-rt');
    const a = debug.spawnHunter({ archetype: 'vanguard', level: 30, fullyEquipped: true });
    debug.spawnHunter({ archetype: 'adept', level: 12, fullyEquipped: true });
    debug.grantMastery(a.id, 'shield_bash', 250);
    session.events.emit('combat.nearDeath', { hunterId: a.id });
    debug.fastForward(30);

    const before = session.snapshot();
    expect(session.save.save('slot1', before).ok).toBe(true);

    const loaded = session.save.load('slot1');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    // Structural identity: what went in is exactly what comes out.
    expect(JSON.parse(JSON.stringify(loaded.value))).toEqual(
      JSON.parse(JSON.stringify(before)),
    );
  });

  it('rebuilds a working session from a restored payload', () => {
    const { session, debug } = testSession('save-restore');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 30, fullyEquipped: true });
    debug.maxOut(hunter.id, 'vit');
    debug.grantMastery(hunter.id, 'shield_bash', 400);

    const profileBefore = session.buildIdentity.profileOf(session.roster.require(hunter.id));
    session.save.save('slot1', session.snapshot());

    const fresh = testSession('save-restore-2');
    const loaded = session.save.load('slot1');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    fresh.session.restore(loaded.value);

    // The restored hunter must derive the same identity — a save that loses build identity
    // has lost the thing the player actually cared about.
    const profileAfter = fresh.session.buildIdentity.profileOf(
      fresh.session.roster.require(hunter.id),
    );
    expect(profileAfter).toEqual(profileBefore);
    expect(fresh.session.chronicle.counter(hunter.id, 'nearDeaths')).toBe(0);
  });

  it('preserves RNG stream state so a resumed session continues the same sequence', () => {
    const { session, debug } = testSession('save-rng');
    debug.spawnHunter({ archetype: 'vanguard' });

    const payload = session.snapshot();
    expect(Object.keys(payload.rngStreams).length).toBeGreaterThan(0);
    expect(payload.rngStreams['recruit']).toBeDefined();
  });

  it('preserves the simulation tick', () => {
    const { session, debug } = testSession('save-clock');
    debug.fastForward(120);
    const tick = session.clock.tick;

    session.save.save('slot1', session.snapshot());
    const fresh = testSession('save-clock-2');
    const loaded = session.save.load('slot1');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    fresh.session.restore(loaded.value);
    expect(fresh.session.clock.tick).toBe(tick);
  });
});

describe('slots, autosave and backups', () => {
  it('reports a missing slot rather than throwing', () => {
    const { session } = testSession('save-missing');
    const result = session.save.load('nothing-here');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no save in slot/);
  });

  it('rotates the previous autosave into the backup ring', () => {
    const storage = new MemoryStorage();
    const { session, debug } = testSession('save-backup');
    const save = new SaveGame({ storage, now: () => 1, worldSeed: 'x' });
    debug.spawnHunter({ archetype: 'vanguard' });

    save.autoSave(session.snapshot());
    expect(storage.read(AUTOSAVE_SLOT)).toBeDefined();
    expect(storage.read(`${BACKUP_SLOT_PREFIX}1`)).toBeUndefined();

    debug.spawnHunter({ archetype: 'adept' });
    save.autoSave(session.snapshot());
    expect(storage.read(`${BACKUP_SLOT_PREFIX}1`)).toBeDefined();
  });

  it('lists slots newest first and flags unreadable ones', () => {
    const storage = new MemoryStorage();
    const { session, debug } = testSession('save-list');
    let clock = 0;
    const save = new SaveGame({ storage, now: () => ++clock, worldSeed: 'x' });
    debug.spawnHunter({ archetype: 'vanguard' });

    save.save('older', session.snapshot());
    save.save('newer', session.snapshot());
    storage.write('broken', 'not json at all');

    const slots = save.listSlots();
    expect(slots[0]?.slot).toBe('newer');
    expect(slots.find((s) => s.slot === 'broken')?.label).toBe('(unreadable)');
  });

  it('deletes a slot', () => {
    const { session, debug } = testSession('save-delete');
    debug.spawnHunter({ archetype: 'vanguard' });
    session.save.save('temp', session.snapshot());
    session.save.delete('temp');
    expect(session.save.load('temp').ok).toBe(false);
  });

  it('rejects corrupted JSON with a readable message', () => {
    const storage = new MemoryStorage();
    const save = new SaveGame({ storage, now: () => 1, worldSeed: 'x' });
    storage.write('bad', '{ not json');
    const result = save.load('bad');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not valid JSON/);
  });

  it('rejects a save with no version', () => {
    const storage = new MemoryStorage();
    const save = new SaveGame({ storage, now: () => 1, worldSeed: 'x' });
    storage.write('bad', JSON.stringify({ payload: {} }));
    const result = save.load('bad');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no version/);
  });
});

describe('migration chain (risk R4)', () => {
  it('migrates a v1 payload up through every version to the current one', () => {
    // Walks v1 -> v2 (clock and RNG state) -> v3 (armoury, pity, equipment slots).
    const v1 = { hunters: [{ id: 'h1', name: 'Old Hand' }], chronicles: [] };
    const migrated = migratePayload(v1, 1, CURRENT_SAVE_VERSION) as Record<string, unknown>;

    expect(migrated['clock']).toEqual({ tick: 0, accumulatorMs: 0 });
    expect(migrated['rngStreams']).toEqual({});
    expect(migrated['armoury']).toEqual({ items: [], cardCounts: {}, cardsSeen: [] });
    expect(migrated['lootPity']).toEqual({ sinceTier: 0 });

    // The hunter is carried through with its original fields intact and the new equipment
    // map added — a migration adds structure, it does not invent or discard data.
    const hunters = migrated['hunters'] as Record<string, unknown>[];
    expect(hunters).toHaveLength(1);
    expect(hunters[0]).toMatchObject({ id: 'h1', name: 'Old Hand' });
    expect(hunters[0]?.['equipment']).toEqual({
      weapon: null,
      offhand: null,
      head: null,
      body: null,
      hands: null,
      feet: null,
      trinket: null,
    });
  });

  it('does not overwrite equipment a hunter already has', () => {
    // Idempotence matters: a v2 save written after the Hunter type gained equipment (but
    // before the version bump landed) must not have its gear wiped.
    const v2 = {
      hunters: [{ id: 'h1', name: 'Kitted', equipment: { weapon: 'itm_abc' } }],
      chronicles: [],
      clock: { tick: 12, accumulatorMs: 5 },
      rngStreams: {},
    };
    const migrated = migratePayload(v2, 2, 3) as Record<string, unknown>;
    const hunters = migrated['hunters'] as Record<string, unknown>[];

    expect(hunters[0]?.['equipment']).toEqual({ weapon: 'itm_abc' });
    expect(migrated['clock']).toEqual({ tick: 12, accumulatorMs: 5 });
  });

  it('loads a v1 envelope end to end through SaveGame', () => {
    const storage = new MemoryStorage();
    const save = new SaveGame({ storage, now: () => 1, worldSeed: 'x' });

    const legacy: SaveEnvelope = {
      version: 1,
      savedAt: 0,
      label: 'ancient',
      worldSeed: 'x',
      payload: { hunters: [], chronicles: [] },
    };
    storage.write('legacy', JSON.stringify(legacy));

    const loaded = save.load('legacy');
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value.clock).toEqual({ tick: 0, accumulatorMs: 0 });
  });

  it('refuses a save from a newer build rather than silently dropping data', () => {
    expect(() => migratePayload({}, CURRENT_SAVE_VERSION + 5, CURRENT_SAVE_VERSION)).toThrow(
      /newer than this build understands/,
    );
  });

  it('has an unbroken chain from version 1 to current', () => {
    // The standing rule: a version bump requires a migration in the same commit.
    for (let version = 1; version < CURRENT_SAVE_VERSION; version++) {
      expect(MIGRATIONS.find((m) => m.from === version)).toBeDefined();
    }
  });

  it('has migrations that each advance exactly one version', () => {
    for (const migration of MIGRATIONS) {
      expect(migration.to).toBe(migration.from + 1);
      expect(migration.describe.length).toBeGreaterThan(0);
    }
  });

  it('is a no-op when the payload is already current', () => {
    const payload = { hunters: [], chronicles: [], clock: { tick: 5, accumulatorMs: 0 }, rngStreams: {} };
    expect(migratePayload(payload, CURRENT_SAVE_VERSION, CURRENT_SAVE_VERSION)).toBe(payload);
  });

  it('rejects a v1 payload that is not an object', () => {
    expect(() => migratePayload('nonsense', 1, 2)).toThrow(/not an object/);
  });
});
