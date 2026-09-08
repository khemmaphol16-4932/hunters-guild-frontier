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

export const MIGRATIONS: readonly Migration[] = [v1ToV2];

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
