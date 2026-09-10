/**
 * Save envelope and payload shapes.
 *
 * REQ-TEC-004, risk R4. This game is explicitly designed for very long single saves —
 * §130's target is a player who will not delete their guild because it has stories. A save
 * format that cannot migrate destroys exactly the thing the design values most, so the
 * versioned envelope and the migration chain exist from the first commit rather than being
 * retrofitted once there is something to lose.
 *
 * The standing rule: **a version bump requires a migration and a round-trip test in the
 * same commit.** Phase 1 ships a real v1→v2 migration so the chain is exercised before it
 * matters.
 */

import type { Hunter } from '../core/hunter/Hunter.js';
import type { HunterChronicle } from '../systems/hunter/Chronicle.js';
import type { RngState } from '../core/rng.js';
import type { Item } from '../core/items/Item.js';
import type { AuditRecord } from '../core/audit.js';
import type { WorldKnowledgeSnapshot } from '../systems/world/WorldKnowledge.js';
import type { EmergencyAuthorisation } from '../ai/policy/emergency.js';

export const CURRENT_SAVE_VERSION = 6;

export interface SaveEnvelope {
  readonly version: number;
  /** Milliseconds since epoch, supplied by the caller — save never reads the clock itself. */
  readonly savedAt: number;
  readonly label: string;
  /** World seed, so a save can be re-derived and diffed (REQ-TEC-005). */
  readonly worldSeed: string;
  readonly payload: unknown;
}

/**
 * v1 — the original Phase 1 payload.
 * Retained verbatim because migrations must be able to read it forever.
 */
export interface SavePayloadV1 {
  readonly hunters: readonly unknown[];
  readonly chronicles: readonly unknown[];
}

/**
 * v2 — adds simulation clock state and per-stream RNG state.
 *
 * Without these an interrupted expedition resumed on a different random sequence than the
 * one it started on, which breaks the determinism REQ-OFF-002 depends on. That is the
 * genuine reason for the bump, and it is the kind of change this chain exists to absorb.
 */
export interface SavePayloadV2 {
  readonly hunters: readonly Hunter[];
  readonly chronicles: readonly HunterChronicle[];
  readonly clock: { readonly tick: number; readonly accumulatorMs: number };
  readonly rngStreams: Readonly<Record<string, RngState>>;
}

/**
 * v3 — adds the guild armoury and the loot pity counter (Phase 2).
 *
 * Hunters gained an `equipment` slot map in the same phase. The migration fills it with
 * empty slots rather than guessing, because a v2 save has no items to equip.
 */
export interface SavePayloadV3 {
  readonly hunters: readonly Hunter[];
  readonly chronicles: readonly HunterChronicle[];
  readonly clock: { readonly tick: number; readonly accumulatorMs: number };
  readonly rngStreams: Readonly<Record<string, RngState>>;
  readonly armoury: {
    readonly items: readonly Item[];
    readonly cardCounts: Readonly<Record<string, number>>;
    readonly cardsSeen: readonly string[];
  };
  readonly lootPity: { readonly sinceTier: number };
}

/**
 * v4 — adds the audit log, emergency authorisations, and per-hunter availability.
 *
 * Driven by the Master Build Specification v1.0 reconciliation: §14 requires an auditable
 * trail for consequential changes, §2.1 introduces player-configured emergency overrides,
 * and §4 fixes the five canonical availability states. All three are state a save must carry
 * — an audit trail that vanished on reload could not explain anything, and an emergency
 * authorisation that vanished would silently restore absolute hard constraints.
 */
export interface SavePayloadV4 {
  readonly hunters: readonly Hunter[];
  readonly chronicles: readonly HunterChronicle[];
  readonly clock: { readonly tick: number; readonly accumulatorMs: number };
  readonly rngStreams: Readonly<Record<string, RngState>>;
  readonly armoury: {
    readonly items: readonly Item[];
    readonly cardCounts: Readonly<Record<string, number>>;
    readonly cardsSeen: readonly string[];
  };
  readonly lootPity: { readonly sinceTier: number };
  readonly audit: readonly AuditRecord[];
  readonly emergencyAuthorisations: readonly EmergencyAuthorisation[];
}

/**
 * v5 — the class chain collapses to a constellation starting position, and the armoury
 * gains skill-book possession (v1.0 §5).
 */
export interface SavePayloadV5 extends Omit<SavePayloadV4, 'armoury'> {
  readonly armoury: {
    readonly items: readonly Item[];
    readonly cardCounts: Readonly<Record<string, number>>;
    readonly cardsSeen: readonly string[];
    readonly skillBooks: readonly string[];
  };
}

/**
 * v6 — the guild remembers the world (REQ-WLD-001).
 *
 * Exploration information is permanent, so it has to be saved. It is guild state rather
 * than hunter state: a roster wipe costs you the hunters, not the map.
 */
export interface SavePayloadV6 extends SavePayloadV5 {
  readonly worldKnowledge: WorldKnowledgeSnapshot;
}

export type CurrentSavePayload = SavePayloadV6;

export interface Migration {
  readonly from: number;
  readonly to: number;
  readonly describe: string;
  migrate(payload: unknown): unknown;
}

export class SaveMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveMigrationError';
  }
}
