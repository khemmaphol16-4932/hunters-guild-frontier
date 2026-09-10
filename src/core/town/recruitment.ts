/**
 * The recruitment vocabulary.
 *
 * Here rather than beside either of its users for the same reason as `core/town/assignment`
 * and `core/hunter/buildProfile`: `systems/town/Recruitment` holds these and `ai/town/guildFit`
 * produces the analysis, and `systems/` sits below `ai/` in the import order. The shapes go
 * down; the reasoning stays up.
 */

import type { Hunter } from '../hunter/Hunter.js';

/**
 * Someone the guild could hire.
 *
 * A candidate carries a *fully formed* Hunter rather than a summary — same attributes, same
 * potential, same rolled traits they will have on the roster. It costs nothing extra and it
 * removes an entire category of bug: a preview that disagrees with what the player receives.
 */
export interface Candidate {
  readonly hunter: Hunter;
  readonly originId: string;
  readonly originName: string;
  readonly originNote: string;
  /** REQ-RCT-002 — must be immediately legible, so it is a flag, not a number to interpret. */
  readonly exceptional: boolean;
  /** Acquisition cost in gold, charged by the player-intent boundary. */
  readonly cost: number;
}

/**
 * The AI's read on one candidate (v1.0 §4).
 *
 * Reasons, gains and concerns are separate lists rather than one blob because they answer
 * different questions, and a recruiter that only ever says good things is not advice. The
 * spec asks for "top candidates *with reasons*"; a score with no sentences would be a
 * ranking the player has to take on faith.
 */
export interface GuildFit {
  readonly hunterId: string;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly gains: readonly string[];
  readonly concerns: readonly string[];
}

/** What the Recruitment Hall shows: a ranking, a recommendation, and the alternatives. */
export interface RecruitmentAdvice {
  readonly ranked: readonly GuildFit[];
  readonly recommended: GuildFit | undefined;
  /** v1.0 §4's "notable alternatives" — candidates worth a look for a different reason. */
  readonly alternatives: readonly GuildFit[];
  readonly summary: string;
}
