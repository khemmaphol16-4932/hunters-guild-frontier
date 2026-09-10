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

/**
 * v6 → v7: the town exists (REQ-TWN-001/002/003, REQ-DEP-*).
 *
 * A v6 guild had no town, so the honest migration is an *empty* one — no buildings, the
 * starting population, no department heads, nobody on the work rota, and zero reputation.
 * Every one of those systems restores a missing snapshot to its own configured default, so
 * writing the empty shapes here rather than omitting the keys keeps the payload's *type*
 * correct without asserting anything about the guild's history.
 *
 * Two things this deliberately does not do.
 *
 * It does not place a Guild Hall. A v6 save loaded into v7 arrives with an empty grid, and
 * the composition root builds the starting town for a *new* guild only — because placing a
 * building during migration would put it somewhere the player did not choose, on a grid
 * whose dimensions come from balance data that may since have changed.
 *
 * It does not infer reputation from the save's expedition history. The Chronicle knows how
 * many expeditions a v6 guild ran and it would be easy to back-calculate a number from it,
 * which is exactly why it is worth refusing: reputation's formula is expected to be retuned
 * (it is a Phase 7 balance item), and a migration that computed it would bake today's
 * constants into every old save forever. A v6 guild starts unknown and earns it again.
 */
const v6ToV7: Migration = {
  from: 6,
  to: 7,
  describe: 'add the town, its population, departments, work rota and guild reputation',
  migrate(payload: unknown): unknown {
    if (typeof payload !== 'object' || payload === null) {
      throw new SaveMigrationError('v6 payload is not an object');
    }
    return {
      ...(payload as Record<string, unknown>),
      town: { grid: { placements: [], nextInstance: 1 }, highestStageIndex: 0 },
      // `population` is deliberately *absent* rather than zeroed. `Population.restore`
      // falls back to the configured starting population when the snapshot is missing,
      // which is the right reading for a guild that always had people living around it;
      // writing `{ count: 0 }` would restore a town with nobody in it, no demand, and a
      // stage ladder that could never advance.
      departments: { departments: [] },
      townJobs: { assignments: [] },
      reputation: { value: 0, recent: [] },
    };
  },
};

/**
 * v7 → v8: the guild learns things (REQ-RES-001/002).
 *
 * Empty, and that is the only defensible reading. A v7 guild researched nothing, so it has
 * completed nothing and — more importantly — has *foreclosed* nothing. Research conflicts
 * are permanent, so a migration that guessed at completed nodes would not merely invent
 * progress, it would silently rule out branches the player never chose against.
 *
 * Note that this is not the same as the v6→v7 population case. There, an absent snapshot
 * meant "use the configured default", because a guild always had people. Here the empty
 * snapshot *is* the truth: a guild that predates research has genuinely learned nothing.
 */
const v7ToV8: Migration = {
  from: 7,
  to: 8,
  describe: 'add guild research',
  migrate(payload: unknown): unknown {
    if (typeof payload !== 'object' || payload === null) {
      throw new SaveMigrationError('v7 payload is not an object');
    }
    return {
      ...(payload as Record<string, unknown>),
      research: { completed: [], active: undefined, progress: 0 },
    };
  },
};

/**
 * v8 -> v9: the Recruitment Hall.
 *
 * An empty pool with the refresh due immediately, which is exactly right: a v8 guild had no
 * hall, and if it builds one the first refresh should happen at once rather than after a
 * wait the player cannot see the reason for.
 */
const v8ToV9: Migration = {
  from: 8,
  to: 9,
  describe: 'add the recruitment pool',
  migrate(payload: unknown): unknown {
    if (typeof payload !== 'object' || payload === null) {
      throw new SaveMigrationError('v8 payload is not an object');
    }
    return {
      ...(payload as Record<string, unknown>),
      recruitment: { candidates: [], nextRefreshTick: 0 },
    };
  },
};

/**
 * v9 -> v10: town defense.
 *
 * The policy is left absent so `Defense.restore` falls back to the *authored* default
 * rather than to a hardcoded one — the same reasoning as the v6→v7 population case. The
 * threat timer is likewise absent, which means a migrated guild gets the full grace period
 * again: it has never had a wall tested, and starting its clock mid-cycle would attack it
 * for reasons it could not see.
 */
const v9ToV10: Migration = {
  from: 9,
  to: 10,
  describe: 'add town defense: guard policy and the threat timer',
  migrate(payload: unknown): unknown {
    if (typeof payload !== 'object' || payload === null) {
      throw new SaveMigrationError('v9 payload is not an object');
    }
    return {
      ...(payload as Record<string, unknown>),
      defense: { threatsFaced: 0, threatsHeld: 0 },
    };
  },
};

const v10ToV11: Migration = {
  from: 10,
  to: 11,
  describe: 'add the authoritative guild resource ledger',
  migrate(payload: unknown): unknown {
    if (typeof payload !== 'object' || payload === null) {
      throw new SaveMigrationError('v10 payload is not an object');
    }
    // A pre-economy guild receives no invented accumulated production. The configured
    // founding grant is applied only to new sessions; migrated saves start from zero.
    return { ...(payload as Record<string, unknown>), resources: { balances: {} } };
  },
};

const v11ToV12: Migration = {
  from: 11,
  to: 12,
  describe: 'persist the latest provisions fulfilment for hunger and recovery',
  migrate(payload: unknown): unknown {
    if (typeof payload !== 'object' || payload === null) {
      throw new SaveMigrationError('v11 payload is not an object');
    }
    // Food was not consumed before v12, so an old guild was fully fed at its last tick.
    return { ...(payload as Record<string, unknown>), food: { fedFraction: 1 } };
  },
};
const v12ToV13: Migration = {
  from: 12, to: 13, describe: 'persist crafting work orders and their completion ticks',
  migrate(payload: unknown): unknown {
    if (typeof payload !== 'object' || payload === null) throw new SaveMigrationError('v12 payload is not an object');
    return { ...(payload as Record<string, unknown>), crafting: { orders: [], nextOrder: 1 } };
  },
};
const v13ToV14: Migration = {
  from: 13, to: 14, describe: 'persist bounded market stock and price state',
  migrate(payload: unknown): unknown {
    if (typeof payload !== 'object' || payload === null) throw new SaveMigrationError('v13 payload is not an object');
    return { ...(payload as Record<string, unknown>), market: { stock: {}, priceScale: {} } };
  },
};
const v14ToV15: Migration = { from:14,to:15,describe:'persist contract offers, active work and faction standing',migrate(payload:unknown):unknown{if(typeof payload!=='object'||payload===null)throw new SaveMigrationError('v14 payload is not an object');return{...(payload as Record<string,unknown>),contracts:{offers:[],sequence:1},factions:{standing:{}}}}};
const v15ToV16: Migration = { from:15,to:16,describe:'persist institutional Guild Mastery',migrate(payload:unknown):unknown{if(typeof payload!=='object'||payload===null)throw new SaveMigrationError('v15 payload is not an object');return{...(payload as Record<string,unknown>),guildMastery:{points:0,byActivity:{}}}}};
const v16ToV17: Migration = { from:16,to:17,describe:'persist regional reputation',migrate(payload:unknown):unknown{if(typeof payload!=='object'||payload===null)throw new SaveMigrationError('v16 payload is not an object');const record=payload as Record<string,unknown>;const reputation=typeof record['reputation']==='object'&&record['reputation']!==null?record['reputation'] as Record<string,unknown>:{};return{...record,reputation:{...reputation,regional:{}}}}};
const v17ToV18: Migration = { from:17,to:18,describe:'persist Guild Monument achievements',migrate(payload:unknown):unknown{if(typeof payload!=='object'||payload===null)throw new SaveMigrationError('v17 payload is not an object');return{...(payload as Record<string,unknown>),monument:{entries:[]}}}};

export const MIGRATIONS: readonly Migration[] = [
  v1ToV2,
  v2ToV3,
  v3ToV4,
  v4ToV5,
  v5ToV6,
  v6ToV7,
  v7ToV8,
  v8ToV9,
  v9ToV10,
  v10ToV11,
  v11ToV12,
  v12ToV13,
  v13ToV14,
  v14ToV15,
  v15ToV16,
  v16ToV17,
  v17ToV18,
];

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
