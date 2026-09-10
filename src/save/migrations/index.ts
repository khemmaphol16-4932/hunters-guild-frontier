/**
 * The ordered migration chain.
 *
 * Each migration moves a payload up exactly one version. Loading an old save walks the
 * chain from its version to CURRENT_SAVE_VERSION, so a save from any past version remains
 * loadable without every migration having to know about every other.
 *
 * Migrations must be pure and must never import gameplay systems — a migration that calls
 * into live code breaks the moment that code changes, which defeats the point.
 */

import { SaveMigrationError, type Migration } from '../envelope.js';

/**
 * v1 → v2: add simulation clock state and RNG stream state.
 *
 * v1 saves predate deterministic resume. There is no honest way to recover the exact
 * stream state a v1 save was using, so the migration starts them fresh from tick 0 —
 * documented here rather than silently, because it means a v1 save resumed in v2 will
 * diverge from the sequence it would have had. That is acceptable for a Phase 1 format
 * nobody has shipped; it would not be for a released one.
 */
const v1ToV2: Migration = {
  from: 1,
  to: 2,
  describe: 'add clock and RNG stream state for deterministic resume',
  migrate(payload: unknown): unknown {
    if (typeof payload !== 'object' || payload === null) {
      throw new SaveMigrationError('v1 payload is not an object');
    }
    const v1 = payload as Record<string, unknown>;
    return {
      hunters: Array.isArray(v1['hunters']) ? v1['hunters'] : [],
      chronicles: Array.isArray(v1['chronicles']) ? v1['chronicles'] : [],
      clock: { tick: 0, accumulatorMs: 0 },
      rngStreams: {},
    };
  },
};

/**
 * v2 → v3: add the guild armoury, the loot pity counter, and per-hunter equipment slots.
 *
 * A v2 save has no items at all, so there is nothing to reconstruct — every hunter gets an
 * empty slot map and the armoury starts empty. This is the well-behaved case a migration
 * chain exists for: the schema grew, and old saves remain loadable without inventing data.
 *
 * The slot list is duplicated here rather than imported from data/itemSchema on purpose.
 * A migration must keep reading old saves correctly forever, so it cannot depend on a
 * constant that later phases are free to change — if a slot is added in Phase 6, this
 * migration must still produce exactly the v3 shape it was written for.
 */
const V3_EQUIPMENT_SLOTS = ['weapon', 'offhand', 'head', 'body', 'hands', 'feet', 'trinket'];

const v2ToV3: Migration = {
  from: 2,
  to: 3,
  describe: 'add the guild armoury, loot pity counter and hunter equipment slots',
  migrate(payload: unknown): unknown {
    if (typeof payload !== 'object' || payload === null) {
      throw new SaveMigrationError('v2 payload is not an object');
    }
    const v2 = payload as Record<string, unknown>;

    const emptyEquipment: Record<string, null> = {};
    for (const slot of V3_EQUIPMENT_SLOTS) emptyEquipment[slot] = null;

    const hunters = Array.isArray(v2['hunters']) ? v2['hunters'] : [];
    const upgraded = hunters.map((hunter) => {
      if (typeof hunter !== 'object' || hunter === null) return hunter;
      const record = hunter as Record<string, unknown>;
      return { ...record, equipment: record['equipment'] ?? { ...emptyEquipment } };
    });

    return {
      hunters: upgraded,
      chronicles: Array.isArray(v2['chronicles']) ? v2['chronicles'] : [],
      clock: v2['clock'] ?? { tick: 0, accumulatorMs: 0 },
      rngStreams: v2['rngStreams'] ?? {},
      armoury: { items: [], cardCounts: {}, cardsSeen: [] },
      lootPity: { sinceTier: 0 },
    };
  },
};

/**
 * v3 → v4: add the audit log, emergency authorisations, and hunter availability.
 *
 * A v3 save has no audit history and no authorisations, so both start empty — and an empty
 * authorisation set is the *correct* default rather than a lossy one: it means hard
 * constraints are absolute, which is exactly how a v3 save behaved.
 *
 * Availability defaults to `available`. That is a genuine assumption: a v3 hunter who was
 * mid-expedition when the save was written has no recorded state to restore, and marking
 * everyone available is the conservative reading (a hunter wrongly available can be
 * reassigned; one wrongly stuck as `assigned` to a expedition that no longer exists could
 * never be freed).
 */
/**
 * The optional fields are omitted rather than set to null, because that is exactly what a
 * serialised `FRESH_AVAILABILITY` looks like — `JSON.stringify` drops `undefined` keys, so
 * a migrated hunter and a freshly saved one must have the same shape or round-trip equality
 * tests would fail for a difference that does not exist at runtime.
 */
const V4_FRESH_AVAILABILITY = { state: 'available' };

const v3ToV4: Migration = {
  from: 3,
  to: 4,
  describe: 'add audit log, emergency authorisations and hunter availability',
  migrate(payload: unknown): unknown {
    if (typeof payload !== 'object' || payload === null) {
      throw new SaveMigrationError('v3 payload is not an object');
    }
    const v3 = payload as Record<string, unknown>;

    const hunters = Array.isArray(v3['hunters']) ? v3['hunters'] : [];
    const upgraded = hunters.map((hunter) => {
      if (typeof hunter !== 'object' || hunter === null) return hunter;
      const record = hunter as Record<string, unknown>;
      return {
        ...record,
        availability: record['availability'] ?? { ...V4_FRESH_AVAILABILITY },
      };
    });

    return {
      hunters: upgraded,
      chronicles: Array.isArray(v3['chronicles']) ? v3['chronicles'] : [],
      clock: v3['clock'] ?? { tick: 0, accumulatorMs: 0 },
      rngStreams: v3['rngStreams'] ?? {},
      armoury: v3['armoury'] ?? { items: [], cardCounts: {}, cardsSeen: [] },
      lootPity: v3['lootPity'] ?? { sinceTier: 0 },
      audit: [],
      emergencyAuthorisations: [],
    };
  },
};

/**
 * v4 → v5: the class chain becomes a starting position in the skill constellation.
 *
 * v1.0 §5 replaces Archetype → Advanced → Specialization with one node graph, so
 * `classChain: { archetype, advanced, specialization }` collapses to `archetype`.
 *
 * The advanced class and specialization are *dropped rather than translated*, and that is
 * the right call rather than a lossy one: under the constellation, identity is derived from
 * which regions a hunter's known skills fall in, and a v4 hunter who advanced to Sentinel
 * necessarily knows Sentinel-region skills — because those skills were what the advancement
 * gated. Their identity therefore reconstructs itself from `knownSkills` without the
 * migration having to invent anything. See DL-023.
 */
const v4ToV5: Migration = {
  from: 4,
  to: 5,
  describe: 'collapse the class chain to a constellation starting position',
  migrate(payload: unknown): unknown {
    if (typeof payload !== 'object' || payload === null) {
      throw new SaveMigrationError('v4 payload is not an object');
    }
    const v4 = payload as Record<string, unknown>;

    const hunters = Array.isArray(v4['hunters']) ? v4['hunters'] : [];
    const upgraded = hunters.map((hunter) => {
      if (typeof hunter !== 'object' || hunter === null) return hunter;
      const { classChain, ...rest } = hunter as Record<string, unknown>;

      const archetype =
        rest['archetype'] ??
        (typeof classChain === 'object' && classChain !== null
          ? (classChain as Record<string, unknown>)['archetype']
          : undefined);

      if (archetype === undefined) {
        throw new SaveMigrationError('a v4 hunter has no archetype to carry forward');
      }
      return { ...rest, archetype };
    });

    const armoury = (v4['armoury'] ?? {}) as Record<string, unknown>;

    return {
      ...v4,
      hunters: upgraded,
      // Skill books became real state in the same change; a v4 guild held none.
      armoury: { ...armoury, skillBooks: armoury['skillBooks'] ?? [] },
    };
  },
};

/**
 * v5 → v6: the guild remembers the world (REQ-WLD-001).
 *
 * Starts empty rather than inventing history. `WorldKnowledge.restore` merges a snapshot
 * over each region's *authored* starting knowledge, so an empty snapshot resolves to
 * "whatever the content says the guild starts out knowing" — which for a v5 save is
 * exactly right. Fabricating visit counts to match a save's apparent progress would
 * invent expeditions that never happened and put them in the Chronicle's arithmetic.
 */
const v5ToV6: Migration = {
  from: 5,
  to: 6,
  describe: 'add persistent world knowledge (REQ-WLD-001)',
  migrate(payload: unknown): unknown {
    if (typeof payload !== 'object' || payload === null) {
      throw new SaveMigrationError('v5 payload is not an object');
    }
    return { ...(payload as Record<string, unknown>), worldKnowledge: { regions: [] } };
  },
};

export const MIGRATIONS: readonly Migration[] = [v1ToV2, v2ToV3, v3ToV4, v4ToV5, v5ToV6];

/** Walk the chain from `fromVersion` up to `toVersion`. */
export function migratePayload(
  payload: unknown,
  fromVersion: number,
  toVersion: number,
): unknown {
  if (fromVersion > toVersion) {
    throw new SaveMigrationError(
      `save version ${fromVersion} is newer than this build understands (${toVersion}). ` +
        'Loading it could silently discard data.',
    );
  }

  let current = payload;
  let version = fromVersion;

  while (version < toVersion) {
    const migration = MIGRATIONS.find((m) => m.from === version);
    if (!migration) {
      throw new SaveMigrationError(
        `no migration from save version ${version}; the chain is incomplete`,
      );
    }
    current = migration.migrate(current);
    version = migration.to;
  }

  return current;
}
