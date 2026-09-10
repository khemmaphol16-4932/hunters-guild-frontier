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
import type { TownSnapshot } from '../systems/town/Town.js';
import type { PopulationSnapshot } from '../systems/town/Population.js';
import type { DepartmentsSnapshot } from '../systems/town/Departments.js';
import type { TownJobsSnapshot } from '../systems/town/TownJobs.js';
import type { ReputationSnapshot } from '../systems/town/Reputation.js';
import type { ResearchSnapshot } from '../systems/town/Research.js';
import type { RecruitmentSnapshot } from '../systems/town/Recruitment.js';
import type { DefenseSnapshot } from '../systems/town/Defense.js';
import type { ResourcesSnapshot } from '../systems/economy/Resources.js';
import type { FoodSnapshot } from '../systems/economy/Food.js';
import type { CraftingSnapshot } from '../systems/economy/Crafting.js';
import type { MarketSnapshot } from '../systems/economy/Market.js';
import type { ContractsSnapshot } from '../systems/economy/Contracts.js';
import type { FactionsSnapshot } from '../systems/economy/Factions.js';
import type { GuildMasterySnapshot } from '../systems/guild/GuildMastery.js';
import type { MonumentSnapshot } from '../systems/progression/Monument.js';
import type { LegacySnapshot } from '../systems/progression/Legacy.js';
import type { MentorsSnapshot } from '../systems/progression/Mentors.js';
import type { NewGamePlusSnapshot } from '../systems/progression/NewGamePlus.js';
import type { EndlessRecordsSnapshot } from '../systems/progression/EndlessRecords.js';
import type { WorldEventsSnapshot } from '../systems/world/WorldEvents.js';

export const CURRENT_SAVE_VERSION = 23;

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

/**
 * v7 — the town exists (REQ-TWN-001/002/003, REQ-DEP-*).
 *
 * Five pieces of new state, and each is genuinely irrecoverable rather than derivable:
 * where the buildings stand, how many people live there, who heads which department, who is
 * on the work rota, and what the guild's reputation is. The town is also the first state
 * with a *monotonic* field — `highestStageIndex` — which exists because REQ-TWN-002 forbids
 * a reset on progression and a stage that could be recomputed downward from a damaged town
 * would violate it on load rather than in play.
 */
export interface SavePayloadV7 extends SavePayloadV6 {
  readonly town: TownSnapshot;
  readonly population: PopulationSnapshot;
  readonly departments: DepartmentsSnapshot;
  readonly townJobs: TownJobsSnapshot;
  readonly reputation: ReputationSnapshot;
}

/**
 * v8 — the guild learns things (REQ-RES-001/002).
 *
 * Research is the first state that is *irreversible by design*: taking a node forecloses its
 * conflicts permanently, and REQ-RES-001's reset is the only way back. A save that lost it
 * would not merely lose progress, it would quietly hand the guild a second identity.
 */
export interface SavePayloadV8 extends SavePayloadV7 {
  readonly research: ResearchSnapshot;
}

/**
 * v9 — the Recruitment Hall (REQ-RCT-001/002).
 *
 * The pool has to be saved rather than redrawn, and the reason is worth stating: a candidate
 * is a fully-formed hunter, so redrawing on load would replace the people standing in front
 * of the player with different people. The timed refresh is saved with them, or reloading
 * would be a free reroll.
 */
export interface SavePayloadV9 extends SavePayloadV8 {
  readonly recruitment: RecruitmentSnapshot;
}

/**
 * v10 — town defense (REQ-TWN-008).
 *
 * The guard policy is a player decision and has to survive a reload. So does the threat
 * timer: without it, saving and loading would postpone the next attack indefinitely, which
 * is the kind of exploit that is discovered immediately and then relied on.
 *
 * Building damage rides along inside the town snapshot rather than here, because a wrecked
 * building is a property of the placement — it still stands, it still holds its cells.
 */
export interface SavePayloadV10 extends SavePayloadV9 {
  readonly defense: DefenseSnapshot;
}

/** v11 — the Phase 7 guild economy begins with one authoritative resource ledger. */
export interface SavePayloadV11 extends SavePayloadV10 {
  readonly resources: ResourcesSnapshot;
}

/** v12 — persisted food fulfilment, because a shortage affects recovery and population. */
export interface SavePayloadV12 extends SavePayloadV11 {
  readonly food: FoodSnapshot;
}

export interface SavePayloadV13 extends SavePayloadV12 { readonly crafting: CraftingSnapshot }
export interface SavePayloadV14 extends SavePayloadV13 { readonly market: MarketSnapshot }
export interface SavePayloadV15 extends SavePayloadV14 { readonly contracts: ContractsSnapshot; readonly factions: FactionsSnapshot }
export interface SavePayloadV16 extends SavePayloadV15 { readonly guildMastery: GuildMasterySnapshot }
export interface SavePayloadV17 extends Omit<SavePayloadV16, 'reputation'> { readonly reputation: ReputationSnapshot }
export interface SavePayloadV18 extends SavePayloadV17 { readonly monument: MonumentSnapshot }
export interface SavePayloadV19 extends SavePayloadV18 { readonly legacy: LegacySnapshot }
export interface SavePayloadV20 extends SavePayloadV19 { readonly mentors: MentorsSnapshot }
export interface SavePayloadV21 extends SavePayloadV20 { readonly newGamePlus: NewGamePlusSnapshot }
/** v22 — personal records for endless expeditions (REQ-END-003). */
export interface SavePayloadV22 extends SavePayloadV21 { readonly endlessRecords: EndlessRecordsSnapshot }
export interface SavePayloadV23 extends SavePayloadV22 { readonly worldEvents: WorldEventsSnapshot }
export type CurrentSavePayload = SavePayloadV23;

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
