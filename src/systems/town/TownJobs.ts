/**
 * The town work rota.
 *
 * REQ-TWN-009: *idle hunters automatically work per Guild Policy; only hunters not otherwise
 * assigned are considered for idle work.* This holds who is on which job and re-runs the
 * assignment when the roster or the town changes.
 *
 * The interesting decision is that town work does **not** move a hunter into the `assigned`
 * availability state. It looked obvious at first and it is wrong: `assigned` means *not
 * deployable*, and a hunter sweeping the drill yard must still be a candidate for an
 * expedition — otherwise the town would quietly compete with the field for the roster, and a
 * player who built a productive town would find they had no one to send anywhere. Town work
 * is what idle hunters do *while* idle, so it is tracked here and costs fatigue, and the
 * moment they are deployed the rota drops them (v1.0 §4's five states stay about deployment).
 *
 * Re-running assignment wholesale rather than incrementally is deliberate. An incremental
 * rota drifts: hunters stay in jobs they were best for three levels ago because nothing ever
 * reconsidered them. A full pass is cheap at this roster size and always reflects the town
 * as it is now.
 */

import type { JobDef } from '../../data/townSchema.js';
import type { Hunter } from '../../core/hunter/Hunter.js';
import type { HunterId } from '../../core/ids.js';
import type { JobAssignment } from '../../core/town/assignment.js';

export interface TownJobsSnapshot {
  readonly assignments: readonly JobAssignment[];
}

/** What the rota asks for when it needs filling. */
export interface RotaRequest {
  readonly hunters: readonly Hunter[];
  readonly jobs: readonly JobDef[];
  readonly slots: Readonly<Record<string, number>>;
}

export interface TownJobsDeps {
  readonly jobs: readonly JobDef[];
  readonly rosterOf: () => readonly Hunter[];
  readonly slotsOf: () => Readonly<Record<string, number>>;
  /**
   * Who to put where. Injected rather than imported: the scorer lives in `ai/`, which sits
   * *above* `systems/` in the import order, so the rota takes the decision as a dependency
   * the way `Expedition` takes the hunter AI. The composition root supplies
   * `ai/town/jobAssignment.assignJobs`.
   */
  readonly assign: (request: RotaRequest) => readonly JobAssignment[];
}

export class TownJobs {
  private assignments: readonly JobAssignment[] = [];
  private readonly jobsById: ReadonlyMap<string, JobDef>;

  constructor(private readonly deps: TownJobsDeps) {
    this.jobsById = new Map(deps.jobs.map((job) => [job.id, job]));
  }

  all(): readonly JobAssignment[] {
    return this.assignments;
  }

  jobOf(hunterId: HunterId): JobDef | undefined {
    const assignment = this.assignments.find((a) => a.hunterId === hunterId);
    return assignment ? this.jobsById.get(assignment.jobId) : undefined;
  }

  /** Recompute the whole rota. Returns the new assignments. */
  refresh(): readonly JobAssignment[] {
    this.assignments = this.deps.assign({
      hunters: this.deps.rosterOf(),
      jobs: this.deps.jobs,
      slots: this.deps.slotsOf(),
    });
    return this.assignments;
  }

  /** Take one hunter off the rota — they have been deployed, injured, or have died. */
  release(hunterId: HunterId): void {
    this.assignments = this.assignments.filter((a) => a.hunterId !== hunterId);
  }

  /** Player-readable rota, for the town panel. */
  describe(): readonly string[] {
    return this.assignments.map((a) => a.explanation);
  }

  snapshot(): TownJobsSnapshot {
    return { assignments: this.assignments };
  }

  restore(snapshot: TownJobsSnapshot | undefined): void {
    this.assignments = snapshot?.assignments ?? [];
  }
}
