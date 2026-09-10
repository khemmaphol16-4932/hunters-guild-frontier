/**
 * Who does what in town.
 *
 * REQ-TWN-009: idle hunters automatically work per Guild Policy, and *only hunters not
 * otherwise assigned* are considered. REQ-TWN-010: **Preferred Role and Preferred Department
 * are inputs, never vetoes.**
 *
 * That second rule is the whole shape of this module, and it is worth being precise about
 * why, because it is easy to satisfy in letter and break in spirit. A veto is a filter. This
 * file therefore has exactly two filters, and neither of them is a preference:
 *
 *   - the hunter must be idle (REQ-TWN-009 — an assigned hunter is not a candidate);
 *   - the hunter must not be too exhausted to work (a capability limit, from balance).
 *
 * Everything else is a weighted term, which means a hunter's stated preference can always be
 * outweighed by someone better suited, and equally can always win against someone equally
 * suited. `parseDepartments` enforces at load time that no department policy preset can push
 * the two preference weights up to the capability weight, so "input, never veto" survives
 * retuning as well as review (DL-008).
 *
 * The other thing this is deliberately *not*: it does not decide policy. Department policy
 * arrives as a weight modifier and sits at rank 4 of v1.0 §2.1's precedence — below the AI's
 * own optimisation at rank 3 and far below guild policy at rank 2. The AI may prefer a
 * different assignment than a department asked for; it may not overrule guild policy.
 */

import type { AttributeBalance } from '../../data/schema.js';
import { ATTRIBUTE_KEYS, ROLES } from '../../data/schema.js';
import type { JobDef, TownBalance } from '../../data/townSchema.js';
import type { BuildProfile } from '../../core/hunter/buildProfile.js';
import type { Hunter } from '../../core/hunter/Hunter.js';
import { isDeployable } from '../../core/hunter/availability.js';
// The shapes live in core/ because `systems/town/TownJobs` stores them and sits below this
// layer — see the note at the top of core/town/assignment.ts.
import type { JobAssignment, JobScore, JobScoreTerms } from '../../core/town/assignment.js';

export type { JobAssignment, JobScore, JobScoreTerms };

export interface JobAssignmentDeps {
  readonly balance: TownBalance;
  readonly attributes: AttributeBalance;
  readonly profileOf: (hunter: Hunter) => BuildProfile;
}

/**
 * Whether a hunter may be considered for town work at all.
 *
 * Both conditions are capability, not preference. An assigned hunter is already doing
 * something (REQ-TWN-009's "not otherwise assigned"), and a hunter at the fatigue ceiling
 * cannot usefully work — putting them on the rota anyway would make the recovery model a
 * suggestion.
 */
export function isAvailableForWork(hunter: Hunter, balance: TownBalance): boolean {
  if (!isDeployable(hunter.availability)) return false;
  return hunter.condition.fatigue <= balance.assignment.maxFatigueForWork;
}

/**
 * How well a hunter's build *points at* this job, 0..1. 1 when every attribute point sits
 * in the job's most-wanted attribute.
 *
 * Alignment and capability used to be one term — this multiplied by `capabilityOf` — and
 * that was a real bug, caught by the DL-008 sweep in `tests/town.test.ts` rather than by
 * review. Multiplying them capped the combined term at roughly a third of its weight at
 * realistic levels (alignment ~0.8 × capability ~0.4), so `attributeFit`'s nominal 0.5
 * could only ever deliver ~0.17 while `departmentPreference` delivered a flat 0.22 — and a
 * hunter who was hopeless at the work but had asked for it beat a specialist who had not.
 * REQ-TWN-010's "input, never veto" was violated in practice while the load-time guard,
 * which compares the *weights*, reported everything in order.
 *
 * The lesson is worth keeping: **a guard that compares configured weights is only valid if
 * each term can actually reach its weight.** Two factors that answer different questions
 * belong in different terms, where each is separately weighted and separately readable.
 */
export function attributeFit(hunter: Hunter, job: JobDef): number {
  const weights = job.from;
  const maxWeight = Math.max(...ATTRIBUTE_KEYS.map((key) => weights[key] ?? 0));
  if (maxWeight <= 0) return 0;

  let weighted = 0;
  let total = 0;
  for (const key of ATTRIBUTE_KEYS) {
    const value = hunter.attributes[key];
    weighted += value * (weights[key] ?? 0);
    total += value;
  }
  if (total <= 0) return 0;

  return weighted / (total * maxWeight);
}

/**
 * How much hunter there is, 0..1, against the budget they would hold at the level cap.
 *
 * Its own term rather than a multiplier on alignment. Without it a perfectly-aligned level-1
 * recruit would outrank a level-50 veteran at everything and the drill yard would be staffed
 * by children; as a separate weight, how much level matters is a number a designer can tune
 * without also changing what alignment means.
 *
 * The ceiling is read from the attribute balance rather than guessed, so retuning the curve
 * retunes this with it.
 */
export function capabilityOf(hunter: Hunter, balance: AttributeBalance): number {
  const total = ATTRIBUTE_KEYS.reduce((sum, key) => sum + hunter.attributes[key], 0);
  const ceiling =
    balance.startingValue * ATTRIBUTE_KEYS.length +
    balance.startingPoints +
    balance.pointsPerLevel * (balance.maxLevel - 1);
  return ceiling <= 0 ? 1 : Math.min(1, total / ceiling);
}

/**
 * How much this work is worth doing, 0..1.
 *
 * The AI's own optimisation, which v1.0 §2.1 places at rank 3 — above a department's stated
 * preference and below guild policy. Between two jobs a hunter is equally suited to, it
 * prefers the one that produces more.
 *
 * It exists because without it the rota was a pure suitability match, and a guild whose
 * hunters were all best at drilling put its entire roster in the drill yard and never
 * staffed the hunting camp next door. The posts existed and were unreachable, which is the
 * same class of failure as an unreachable region (DL-033) — nothing fails, the content is
 * simply never seen.
 *
 * Food and materials count for less than performance because they are partly speculative:
 * materials have no ledger to go into until Phase 7.
 */
export function outputValue(job: JobDef, reference: number): number {
  if (reference <= 0) return 0;
  const worth = job.output.performance + job.output.food * 0.5 + job.output.materials * 0.5;
  return Math.min(1, worth / reference);
}

/** How much a hunter's build identity leans toward what the job wants, 0..1. */
export function roleFit(profile: BuildProfile, job: JobDef): number {
  const wanted = job.roleLean;
  const wantedTotal = ROLES.reduce((sum, role) => sum + (wanted[role] ?? 0), 0);
  // A job with no role preference is neutral, not unsuitable — most town work is.
  if (wantedTotal <= 0) return 0.5;

  let overlap = 0;
  for (const role of ROLES) {
    overlap += (profile.roleLean[role] ?? 0) * (wanted[role] ?? 0);
  }
  return Math.min(1, overlap / wantedTotal);
}

/**
 * Score one hunter for one job.
 *
 * `policyModifiers` is the department's chosen preset (REQ-DEP-004/005). It multiplies
 * weights; it cannot add or remove a term, which is what keeps a rank-4 preference from
 * behaving like a filter.
 */
export function scoreJob(
  hunter: Hunter,
  job: JobDef,
  options: {
    readonly deps: JobAssignmentDeps;
    readonly priority: number;
    readonly policyModifiers?: Readonly<Record<string, number>>;
  },
): JobScore {
  const { deps, priority, policyModifiers = {} } = options;
  const base = deps.balance.assignment.weights;
  const weight = (key: string): number => (base[key] ?? 0) * (policyModifiers[key] ?? 1);

  const profile = deps.profileOf(hunter);
  const priorityMax = deps.balance.departments.priorities.max;

  const fit = attributeFit(hunter, job);
  const capability = capabilityOf(hunter, deps.attributes);
  const wantsDepartment = hunter.preferredDepartment === job.department ? 1 : 0;
  const wantsRole = roleFit(profile, job);
  const priorityShare = priorityMax <= 0 ? 0 : Math.min(1, priority / priorityMax);

  const terms: JobScoreTerms = {
    attributeFit: weight('attributeFit') * fit,
    capability: weight('capability') * capability,
    outputValue:
      weight('outputValue') * outputValue(job, deps.balance.assignment.outputReference),
    departmentPreference: weight('departmentPreference') * wantsDepartment,
    rolePreference: weight('rolePreference') * wantsRole,
    departmentPriority: weight('departmentPriority') * priorityShare,
    moraleFit: weight('moraleFit') * hunter.condition.morale,
    fatiguePenalty: -weight('fatiguePenalty') * hunter.condition.fatigue,
  };

  const score = Object.values(terms).reduce((sum, value) => sum + value, 0);

  return {
    hunterId: hunter.id,
    jobId: job.id,
    score,
    terms,
    explanation: explain(hunter, job, terms, wantsDepartment === 1),
  };
}

/**
 * Fill the town's job slots.
 *
 * Greedy over the best remaining (hunter, job) pair, which is deliberate rather than
 * expedient: a globally optimal matching would be harder to explain, and REQ-DEP-004 plus
 * v1.0 §14 both want the player to be able to read *why* someone ended up where they did.
 * "This was the best pairing available at the time" is a sentence a player can check.
 *
 * Every hunter takes at most one job — the roster is small and a hunter doing three jobs at
 * once would make the fatigue model meaningless.
 */
export function assignJobs(options: {
  readonly hunters: readonly Hunter[];
  readonly jobs: readonly JobDef[];
  /** Job id -> slots the standing buildings provide. */
  readonly slots: Readonly<Record<string, number>>;
  readonly deps: JobAssignmentDeps;
  readonly priorityOf: (department: string) => number;
  readonly policyModifiersOf: (department: string) => Readonly<Record<string, number>>;
  /** Departments not yet unlocked offer no work (REQ-DEP-001). */
  readonly isUnlocked: (department: string) => boolean;
}): readonly JobAssignment[] {
  const { hunters, jobs, slots, deps, priorityOf, policyModifiersOf, isUnlocked } = options;

  const openJobs = jobs.filter(
    (job) => (slots[job.id] ?? 0) > 0 && isUnlocked(job.department),
  );
  const candidates = hunters.filter((hunter) => isAvailableForWork(hunter, deps.balance));

  const scores: JobScore[] = [];
  for (const job of openJobs) {
    for (const hunter of candidates) {
      scores.push(
        scoreJob(hunter, job, {
          deps,
          priority: priorityOf(job.department),
          policyModifiers: policyModifiersOf(job.department),
        }),
      );
    }
  }

  // Sorted by score, then by ids, so an exact tie resolves the same way every run — an
  // assignment that reshuffled on equal scores would break replay (REQ-OFF-002).
  scores.sort(
    (a, b) =>
      b.score - a.score ||
      a.jobId.localeCompare(b.jobId, 'en') ||
      a.hunterId.localeCompare(b.hunterId, 'en'),
  );

  const remaining = new Map<string, number>(openJobs.map((job) => [job.id, slots[job.id] ?? 0]));
  const taken = new Set<string>();
  const out: JobAssignment[] = [];

  for (const score of scores) {
    if (taken.has(score.hunterId)) continue;
    const left = remaining.get(score.jobId) ?? 0;
    if (left <= 0) continue;

    remaining.set(score.jobId, left - 1);
    taken.add(score.hunterId);
    out.push({
      hunterId: score.hunterId,
      jobId: score.jobId,
      score: score.score,
      explanation: score.explanation,
    });
  }

  return out;
}

function explain(
  hunter: Hunter,
  job: JobDef,
  terms: JobScoreTerms,
  volunteered: boolean,
): string {
  const strongest = (Object.entries(terms) as [keyof JobScoreTerms, number][])
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])[0];

  const reason = ((): string => {
    switch (strongest?.[0]) {
      case 'attributeFit':
        return 'best suited to the work';
      case 'capability':
        return 'the most capable hand free';
      case 'outputValue':
        return 'the work worth doing most';
      case 'departmentPreference':
        return 'asked for this department';
      case 'rolePreference':
        return 'the work suits how they fight';
      case 'departmentPriority':
        return 'the department is a priority';
      case 'moraleFit':
        return 'in good spirits';
      default:
        return 'nobody better was free';
    }
  })();

  const caveat =
    !volunteered && hunter.preferredDepartment !== job.department
      ? ` — they would rather be with ${hunter.preferredDepartment}`
      : '';

  return `${hunter.name} → ${job.name}: ${reason}${caveat}`;
}
