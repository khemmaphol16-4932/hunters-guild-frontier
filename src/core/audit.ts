/**
 * Audit log — the reasoned trail behind consequential state changes.
 *
 * v1.0 §14 fixes the minimum fields: game time, actor/system, source event, policy version,
 * deterministic seed, inputs, outcome, reason codes. §17 puts this in implementation step 1,
 * and §18 makes it an acceptance criterion: *"Every important AI action and consequential
 * outcome can be explained from an audit record."*
 *
 * This is deliberately **not** the event bus. The bus is how systems notify each other and
 * it carries no reasoning; the audit log is how the game answers "why did that happen?" hours
 * later. §18 also needs it for offline reconciliation and combat debugging, which is why the
 * seed reference is a required field rather than a nicety — an entry that cannot be replayed
 * explains nothing.
 *
 * Kept bounded for the same reason the chronicle is (DL-006): a guild played for months
 * would otherwise accumulate an unbounded log. Reason codes are compact strings rather than
 * prose so the UI can group them and §13's explanation layer can render them without parsing.
 */

/** Who or what acted. A hunter id, or a system name for guild-level decisions. */
export type AuditActor = { readonly kind: 'hunter'; readonly id: string } | { readonly kind: 'system'; readonly name: string };

export interface AuditRecord {
  /** Monotonic within a session — gives a stable order for entries sharing a tick. */
  readonly sequence: number;
  /** Simulation tick, never wall-clock time (DL-003). */
  readonly gameTick: number;
  readonly actor: AuditActor;
  /** The system that made the decision, e.g. 'ai/policy', 'items/refinement'. */
  readonly system: string;
  /** Domain event that triggered this, when there was one. */
  readonly sourceEvent: string | undefined;
  /** Policy set version in force. Lets an old decision be read against the rules of its time. */
  readonly policyVersion: string;
  /** RNG stream name plus its state, so the draw behind this outcome can be reproduced. */
  readonly seed: { readonly stream: string; readonly state: string } | undefined;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly outcome: string;
  /** Compact codes, e.g. ['retreat_threshold_reached', 'emergency_override_applied']. */
  readonly reasonCodes: readonly string[];
}

export interface AuditEntryDraft {
  readonly actor: AuditActor;
  readonly system: string;
  readonly sourceEvent?: string | undefined;
  readonly seed?: { readonly stream: string; readonly state: string } | undefined;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly outcome: string;
  readonly reasonCodes: readonly string[];
}

export interface AuditQuery {
  readonly actorId?: string;
  readonly system?: string;
  readonly reasonCode?: string;
  readonly sinceTick?: number;
  readonly limit?: number;
}

export const DEFAULT_AUDIT_CAPACITY = 2000;

export interface AuditLogDeps {
  /** Current simulation tick. Injected so nothing here reads a clock directly. */
  readonly currentTick: () => number;
  /** Current policy set version, so records are readable against the rules of their time. */
  readonly policyVersion: () => string;
  readonly capacity?: number;
}

export class AuditLog {
  private readonly records: AuditRecord[] = [];
  private readonly currentTick: () => number;
  private readonly policyVersion: () => string;
  private readonly capacity: number;
  private nextSequence = 1;

  constructor(deps: AuditLogDeps) {
    this.currentTick = deps.currentTick;
    this.policyVersion = deps.policyVersion;
    this.capacity = deps.capacity ?? DEFAULT_AUDIT_CAPACITY;
    if (this.capacity <= 0) throw new Error('AuditLog: capacity must be positive');
  }

  /**
   * Record a consequential change.
   *
   * Rejects an entry with no reason codes: an audit record that says what happened but not
   * why cannot satisfy §18, and accepting one would let the log fill with useless entries
   * that look like coverage.
   */
  record(draft: AuditEntryDraft): AuditRecord {
    if (draft.reasonCodes.length === 0) {
      throw new Error(
        `AuditLog: "${draft.outcome}" was recorded without a reason code; ` +
          'an entry that cannot explain itself does not satisfy v1.0 §18',
      );
    }

    const entry: AuditRecord = {
      sequence: this.nextSequence++,
      gameTick: this.currentTick(),
      actor: draft.actor,
      system: draft.system,
      sourceEvent: draft.sourceEvent,
      policyVersion: this.policyVersion(),
      seed: draft.seed,
      inputs: draft.inputs ?? {},
      outcome: draft.outcome,
      reasonCodes: [...draft.reasonCodes],
    };

    this.records.push(entry);
    // Oldest-first eviction: recent decisions are the ones a player asks about.
    if (this.records.length > this.capacity) {
      this.records.splice(0, this.records.length - this.capacity);
    }

    return entry;
  }

  all(): readonly AuditRecord[] {
    return this.records;
  }

  get size(): number {
    return this.records.length;
  }

  /** Newest first, so the UI's default view is the most recent decisions. */
  query(query: AuditQuery = {}): readonly AuditRecord[] {
    const matches = this.records.filter((entry) => {
      if (query.system !== undefined && entry.system !== query.system) return false;
      if (query.sinceTick !== undefined && entry.gameTick < query.sinceTick) return false;
      if (query.reasonCode !== undefined && !entry.reasonCodes.includes(query.reasonCode)) {
        return false;
      }
      if (query.actorId !== undefined) {
        const id = entry.actor.kind === 'hunter' ? entry.actor.id : entry.actor.name;
        if (id !== query.actorId) return false;
      }
      return true;
    });

    const newestFirst = [...matches].reverse();
    return query.limit === undefined ? newestFirst : newestFirst.slice(0, query.limit);
  }

  /**
   * Everything recorded about one hunter — the raw material for §13's explanation layer
   * and for the post-failure diagnosis §7 requires.
   */
  forHunter(hunterId: string, limit?: number): readonly AuditRecord[] {
    return this.query(limit === undefined ? { actorId: hunterId } : { actorId: hunterId, limit });
  }

  snapshot(): readonly AuditRecord[] {
    return this.all();
  }

  restore(records: readonly AuditRecord[]): void {
    this.records.length = 0;
    this.records.push(...records.slice(-this.capacity));
    this.nextSequence = this.records.reduce((max, r) => Math.max(max, r.sequence), 0) + 1;
  }

  clear(): void {
    this.records.length = 0;
    this.nextSequence = 1;
  }
}

/**
 * Reason codes used across the project.
 *
 * Centralised so the explanation layer can map each to player-readable text once, and so a
 * typo produces a compile error rather than an entry nothing can group. §7 asks for compact
 * codes like "interrupt lethal cast" and "retreat threshold reached"; these are those.
 */
export const REASON = {
  hardConstraintVeto: 'hard_constraint_veto',
  emergencyOverrideApplied: 'emergency_override_applied',
  emergencyOverrideUnauthorised: 'emergency_override_unauthorised',
  guildPolicyFilter: 'guild_policy_filter',
  capabilityFilter: 'capability_filter',
  retreatThresholdReached: 'retreat_threshold_reached',
  noLegalAction: 'no_legal_action',
  utilityBestScore: 'utility_best_score',
  refinementRisked: 'refinement_risked',
  refinementDestroyed: 'refinement_destroyed',
  availabilityChanged: 'availability_changed',
  recallOrdered: 'recall_ordered',
} as const;

export type ReasonCode = (typeof REASON)[keyof typeof REASON];
