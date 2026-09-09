/**
 * The decision pipeline.
 *
 * REQ-POL-002/003/004, risk R3. §28 defines a validation order and §29 says hard
 * constraints always win. A hierarchy enforced by convention will eventually be violated
 * by some future system that adds a "but if the boss is enraged…" branch, and the player
 * then watches a hunter die against an explicit instruction — the most trust-destroying
 * bug this design can have.
 *
 * So the guarantee is structural rather than conventional, and rests on one distinction:
 *
 *   FILTERS remove candidates. WEIGHTS reorder survivors. Filters always run first.
 *
 * There is no API to reintroduce a candidate after filtering. A weight stage returns a
 * number; it cannot resurrect anything. Therefore no amount of utility, party strategy,
 * personality or future cleverness can produce an action a hard constraint forbade.
 *
 * The same pipeline serves hunter AI, monster AI and guild AI with different stage sets —
 * one AI framework with configurable parameters (REQ-TEC-003), not three god classes
 * (REQ-TEC-010).
 *
 * Phase 1 ships the shape, the hard-constraint filter and the trace. The tactical weight
 * stages arrive with combat in Phase 4 (TECH_DEBT.md).
 */

import type {
  EmergencyContext,
  EmergencyPolicy,
  OverrideDecision,
} from './emergency.js';

/** Anything the pipeline can choose between: a skill use, a move, a retreat, an assignment. */
export interface Candidate {
  readonly id: string;
}

/**
 * A hard constraint. The only mechanism in the game that can veto an action outright.
 * Sourced from player policy (§29): prohibited actions, prohibited zones, retreat
 * thresholds, death policy, equipment and skill restrictions, safety settings.
 */
export interface HardConstraint<A extends Candidate, C> {
  readonly id: string;
  /** Player-readable, for the decision log: "Guild policy forbids entering Black Zones". */
  readonly describe: string;
  permits(candidate: A, context: C): boolean;
}

/**
 * A filter stage. Removes candidates; can never add one.
 * Ordered per REQ-POL-002: hard constraints, then guild policy, then capability.
 */
export interface FilterStage<A extends Candidate, C> {
  readonly name: string;
  permits(candidate: A, context: C): boolean;
  /** Why a candidate was removed, for the decision log. */
  reason(candidate: A, context: C): string;
}

/**
 * A weight stage. Returns a score delta for a surviving candidate.
 * Ordered per REQ-POL-002: objective, party strategy, personal priority, personality,
 * then general utility. Personality is deliberately last and clamped (DL-007).
 */
export interface WeightStage<A extends Candidate, C> {
  readonly name: string;
  weigh(candidate: A, context: C): number;
}

export interface RejectedCandidate<A> {
  readonly candidate: A;
  readonly stage: string;
  readonly reason: string;
}

export interface ScoredCandidate<A> {
  readonly candidate: A;
  readonly score: number;
  /** Per-stage contributions, for the advanced AI view (REQ-UX-002). */
  readonly contributions: Readonly<Record<string, number>>;
}

export interface Decision<A extends Candidate> {
  readonly chosen: A | undefined;
  readonly scored: readonly ScoredCandidate<A>[];
  readonly rejected: readonly RejectedCandidate<A>[];
  /** True when every candidate was filtered out — the AI must then do nothing, not improvise. */
  readonly allRejected: boolean;
}

/**
 * Wrap a set of hard constraints as the first filter stage.
 * Kept separate from ordinary filters so that "which stage rejected this?" always
 * distinguishes an absolute veto from a mere capability mismatch.
 *
 * Pass `emergency` to enable v1.0 §2.1's narrow override path. Omit it and hard constraints
 * are absolute, which stays the default: a guild with no authorisations configured behaves
 * exactly as it did before overrides existed.
 */
export function hardConstraintStage<A extends Candidate, C>(
  constraints: readonly HardConstraint<A, C>[],
  emergency?: {
    readonly policy: EmergencyPolicy;
    /** Derives the currently active triggers from the decision context. */
    readonly contextFor: (context: C) => EmergencyContext;
    /** Called for each override actually applied, so the caller can audit it. */
    readonly onOverride?: (decision: OverrideDecision, candidate: A) => void;
  },
): FilterStage<A, C> {
  const violatedBy = (candidate: A, context: C): HardConstraint<A, C> | undefined =>
    constraints.find((c) => !c.permits(candidate, context));

  return {
    name: 'hardConstraints',
    permits(candidate, context) {
      const violated = violatedBy(candidate, context);
      if (!violated) return true;
      if (!emergency) return false;

      // An override is granted only on an exact match of constraint id and active trigger.
      const decision = emergency.policy.permits(violated.id, emergency.contextFor(context));
      if (!decision) return false;

      emergency.onOverride?.(decision, candidate);
      return true;
    },
    reason(candidate, context) {
      const violated = violatedBy(candidate, context);
      return violated ? violated.describe : 'violates a hard constraint';
    },
  };
}

export interface PipelineConfig<A extends Candidate, C> {
  /** Run in order. The first must be the hard-constraint stage. */
  readonly filters: readonly FilterStage<A, C>[];
  readonly weights: readonly WeightStage<A, C>[];
}

export class DecisionPipeline<A extends Candidate, C> {
  private readonly filters: readonly FilterStage<A, C>[];
  private readonly weights: readonly WeightStage<A, C>[];

  constructor(config: PipelineConfig<A, C>) {
    this.filters = config.filters;
    this.weights = config.weights;

    const first = this.filters[0];
    if (first && first.name !== 'hardConstraints') {
      throw new Error(
        'DecisionPipeline: hard constraints must be the first filter stage (REQ-POL-004)',
      );
    }
  }

  /**
   * Filter, then weigh, then choose.
   *
   * Note the ordering is not an optimisation — it is the guarantee. Scores are only ever
   * computed for candidates that already survived every filter, so a forbidden action
   * cannot win on score because it never receives one.
   */
  evaluate(candidates: readonly A[], context: C): Decision<A> {
    const rejected: RejectedCandidate<A>[] = [];
    let survivors = [...candidates];

    for (const stage of this.filters) {
      const kept: A[] = [];
      for (const candidate of survivors) {
        if (stage.permits(candidate, context)) {
          kept.push(candidate);
        } else {
          rejected.push({
            candidate,
            stage: stage.name,
            reason: stage.reason(candidate, context),
          });
        }
      }
      survivors = kept;
      if (survivors.length === 0) break;
    }

    const scored: ScoredCandidate<A>[] = survivors.map((candidate) => {
      const contributions: Record<string, number> = {};
      let score = 0;
      for (const stage of this.weights) {
        const delta = stage.weigh(candidate, context);
        contributions[stage.name] = delta;
        score += delta;
      }
      return { candidate, score, contributions };
    });

    scored.sort((a, b) => b.score - a.score);

    return {
      chosen: scored[0]?.candidate,
      scored,
      rejected,
      allRejected: candidates.length > 0 && survivors.length === 0,
    };
  }
}

/**
 * Base priority as a weight stage — the "Base Priority" term of REQ-SKL-008
 * (base priority + player weight + AI utility). Player weight and AI utility join it
 * in Phase 4; keeping the term separate now means neither can later be folded into the
 * other and quietly become an override.
 */
export function basePriorityStage<A extends Candidate & { basePriority: number }, C>(): WeightStage<
  A,
  C
> {
  return {
    name: 'basePriority',
    weigh: (candidate) => candidate.basePriority,
  };
}
