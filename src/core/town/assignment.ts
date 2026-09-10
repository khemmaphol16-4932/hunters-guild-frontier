/**
 * The job-assignment vocabulary.
 *
 * This file exists for the same reason `core/hunter/buildProfile.ts` does, and the reasoning
 * is worth repeating because the architecture test caught the mistake rather than review:
 * these types are the contract *between* layers. `ai/town/jobAssignment` produces them and
 * `systems/town/TownJobs` stores them, and `systems/` sits below `ai/` in the import order —
 * so if the shapes lived beside the AI that computes them, the rota would have to import
 * upward, which is the first step toward every layer depending on every other (§126).
 *
 * The scoring, its weights and its policy handling all stay in `ai/`. Only the shape is
 * here, and `TownJobs` receives the function that fills it as an injected dependency, the
 * same way `Expedition` receives the hunter AI.
 */

/** One filled post: a hunter, the work, and why they got it. */
export interface JobAssignment {
  readonly hunterId: string;
  readonly jobId: string;
  readonly score: number;
  /** Player-readable. REQ-DEP-004 and v1.0 §14 both want the reason available. */
  readonly explanation: string;
}

/**
 * Every term that went into a score, kept separate so a decision can be explained.
 *
 * `attributeFit` and `capability` are separate on purpose — see the note in
 * `ai/town/jobAssignment.ts`. They were one multiplied term until a DL-008 sweep showed
 * that a product of two sub-1 factors can never reach its configured weight, which made a
 * hunter's stated preference decisive in practice.
 */
export interface JobScoreTerms {
  /** How well the hunter's build points at this work. */
  readonly attributeFit: number;
  /** How developed the hunter is, independent of what the work wants. */
  readonly capability: number;
  /** How much this work is worth doing at all — the AI's own optimisation (rank 3). */
  readonly outputValue: number;
  readonly departmentPreference: number;
  readonly rolePreference: number;
  readonly departmentPriority: number;
  readonly moraleFit: number;
  readonly fatiguePenalty: number;
}

export interface JobScore extends JobAssignment {
  readonly terms: JobScoreTerms;
}
