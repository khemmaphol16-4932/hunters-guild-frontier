/**
 * Guild Fit analysis.
 *
 * v1.0 §4: *"Recruitment emphasizes identity, potential, personality, and capability — not
 * raw power. AI provides a Guild Fit analysis, top candidates with reasons, acquisition cost,
 * what the guild gains, and notable alternatives."*
 *
 * "Not raw power" is the whole brief, and it is why the dominant term here is **what the
 * guild is missing** rather than how good the candidate is in isolation. A superb Vanguard is
 * a worse hire than a mediocre healer for a guild with four Vanguards and nobody who can
 * heal, and an analysis that ranked by capability would tell the player the opposite.
 *
 * The other half of the brief is *reasons*. Every term that moves the score contributes a
 * sentence, so the ranking can be argued with rather than merely obeyed — and `concerns` is a
 * real list, because a recruiter that only says good things is not giving advice.
 *
 * "Notable alternatives" is deliberately not "second and third place". An alternative is a
 * candidate who is the *best at something* the recommendation is not, which is the only kind
 * of alternative worth naming: another slightly-worse generalist tells the player nothing.
 */

import { ROLES, type Role } from '../../data/schema.js';
import type { BuildProfile } from '../../core/hunter/buildProfile.js';
import type { Hunter } from '../../core/hunter/Hunter.js';
import type { Candidate, GuildFit, RecruitmentAdvice } from '../../core/town/recruitment.js';

export interface GuildFitDeps {
  readonly profileOf: (hunter: Hunter) => BuildProfile;
  /** Composite potential, 0..1. Kept as a dependency so its shape can change freely. */
  readonly potentialOf: (hunter: Hunter) => number;
}

/** How thin the guild is in each role, 0..1, where 1 means nobody covers it at all. */
export function roleGaps(
  roster: readonly Hunter[],
  profileOf: (hunter: Hunter) => BuildProfile,
): Readonly<Record<Role, number>> {
  const coverage = {} as Record<Role, number>;
  for (const role of ROLES) coverage[role] = 0;

  for (const hunter of roster) {
    const profile = profileOf(hunter);
    for (const role of ROLES) coverage[role] += profile.roleLean[role] ?? 0;
  }

  // Measured against "one hunter's worth of lean per role", so a guild of four with nobody
  // leaning healer reads as a full gap rather than a proportion of a small number.
  const gaps = {} as Record<Role, number>;
  for (const role of ROLES) gaps[role] = Math.max(0, Math.min(1, 1 - coverage[role]));
  return gaps;
}

export function analyseCandidate(
  candidate: Candidate,
  options: {
    readonly roster: readonly Hunter[];
    readonly deps: GuildFitDeps;
    readonly gaps: Readonly<Record<Role, number>>;
  },
): GuildFit {
  const { roster, deps, gaps } = options;
  const candidateProfile = deps.profileOf(candidate.hunter);
  const potential = deps.potentialOf(candidate.hunter);

  const reasons: string[] = [];
  const gains: string[] = [];
  const concerns: string[] = [];

  // --- What the guild is missing (the dominant term) ------------------------
  const primary = candidateProfile.primaryRole;
  const fillsGap = gaps[primary];
  const gapTerm = fillsGap * 0.5;
  if (fillsGap > 0.6) {
    reasons.push(`the guild has almost nobody who can ${verbFor(primary)}`);
    gains.push(`covers ${primary}, which is currently a hole`);
  } else if (fillsGap < 0.2) {
    concerns.push(`the guild is already deep in ${primary}`);
  }

  // --- Potential, which is about who they could become ----------------------
  const potentialTerm = potential * 0.25;
  if (candidate.exceptional) {
    reasons.push('their ceiling is well above anyone the guild sees in a normal season');
    gains.push('a hunter worth building the roster around');
  } else if (potential < 0.35) {
    concerns.push('limited ceiling — they are close to what they will ever be');
  }

  // --- Identity: does this hunter add a *shape* the guild does not have? -----
  const shapes = new Set(roster.map((h) => deps.profileOf(h).shape));
  const addsShape = !shapes.has(candidateProfile.shape);
  const shapeTerm = addsShape ? 0.12 : 0;
  if (addsShape && roster.length > 0) {
    gains.push(`a ${candidateProfile.shape} — the guild has none`);
  }

  // --- Personality spread, which is about how orders get carried out --------
  const personalities = new Set(roster.map((h) => h.personalityId));
  const addsPersonality = !personalities.has(candidate.hunter.personalityId);
  const personalityTerm = addsPersonality ? 0.08 : 0;
  if (!addsPersonality && roster.length > 2) {
    concerns.push('another of a temperament the guild already has plenty of');
  }

  // --- Range band, so a guild is not all melee -----------------------------
  const ranges = new Set(roster.map((h) => deps.profileOf(h).primaryRange));
  const addsRange = !ranges.has(candidateProfile.primaryRange);
  const rangeTerm = addsRange ? 0.1 : 0;
  if (addsRange && roster.length > 0) {
    gains.push(`fights at ${candidateProfile.primaryRange}, which nobody else does`);
  }

  const score = gapTerm + potentialTerm + shapeTerm + personalityTerm + rangeTerm;

  if (reasons.length === 0) {
    reasons.push(`a competent ${primary} who would not change the guild much either way`);
  }

  return { hunterId: String(candidate.hunter.id), score, reasons, gains, concerns };
}

/**
 * Rank a pool and pick out the alternatives worth naming.
 */
export function analysePool(
  candidates: readonly Candidate[],
  options: { readonly roster: readonly Hunter[]; readonly deps: GuildFitDeps },
): RecruitmentAdvice {
  const { roster, deps } = options;

  if (candidates.length === 0) {
    return {
      ranked: [],
      recommended: undefined,
      alternatives: [],
      summary: 'Nobody is waiting at the hall.',
    };
  }

  const gaps = roleGaps(roster, deps.profileOf);
  const ranked = candidates
    .map((candidate) => analyseCandidate(candidate, { roster, deps, gaps }))
    // Ties broken by id so the recommendation does not shuffle between reads — the same
    // determinism rule the work rota follows (REQ-OFF-002).
    .sort((a, b) => b.score - a.score || a.hunterId.localeCompare(b.hunterId, 'en'));

  const recommended = ranked[0];
  // Keyed by the plain string, because `GuildFit.hunterId` is a string — these shapes live
  // in core/ and deliberately do not carry the branded id, so that the AI layer can rank
  // candidates without depending on the id vocabulary.
  const byId = new Map<string, Candidate>(candidates.map((c) => [String(c.hunter.id), c]));

  // An alternative is the best at something the recommendation is not. Another marginally
  // worse generalist is not an alternative, it is second place.
  const alternatives: GuildFit[] = [];
  const recommendedCandidate = recommended ? byId.get(recommended.hunterId) : undefined;

  const highestPotential = [...ranked].sort(
    (a, b) =>
      deps.potentialOf(byId.get(b.hunterId)!.hunter) -
      deps.potentialOf(byId.get(a.hunterId)!.hunter),
  )[0];
  if (highestPotential && highestPotential.hunterId !== recommended?.hunterId) {
    alternatives.push(highestPotential);
  }

  const cheapest = [...candidates].sort((a, b) => a.cost - b.cost)[0];
  if (
    cheapest &&
    recommendedCandidate &&
    String(cheapest.hunter.id) !== String(recommendedCandidate.hunter.id) &&
    cheapest.cost < recommendedCandidate.cost &&
    !alternatives.some((a) => a.hunterId === String(cheapest.hunter.id))
  ) {
    const fit = ranked.find((r) => r.hunterId === String(cheapest.hunter.id));
    if (fit) alternatives.push(fit);
  }

  return {
    ranked,
    recommended,
    alternatives,
    summary: summarise(recommended, recommendedCandidate),
  };
}

function summarise(fit: GuildFit | undefined, candidate: Candidate | undefined): string {
  if (!fit || !candidate) return 'Nobody at the hall stands out.';
  const reason = fit.reasons[0] ?? 'the best of the people waiting';
  return `${candidate.hunter.name} — ${reason}. ${candidate.cost} gold.`;
}

function verbFor(role: Role): string {
  switch (role) {
    case 'tank':
      return 'hold a line';
    case 'healer':
      return 'keep people alive';
    case 'damage':
      return 'kill things quickly';
    case 'support':
      return 'make the rest of the party better';
    case 'control':
      return 'shut a fight down';
  }
}
