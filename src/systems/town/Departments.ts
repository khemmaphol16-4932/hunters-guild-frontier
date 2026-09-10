/**
 * The guild's departments.
 *
 * REQ-DEP-001/002/004/005. Five departments, each with a head the player appoints, a
 * priority they set, and a policy preset they choose from. Staffing comes from town jobs;
 * this owns the *management* of a department and reports on how it is doing.
 *
 * Three design constraints, all of them structural rather than advisory:
 *
 * **There is no budget.** REQ-DEP-003 forbids a Department Budget system outright (conflict
 * A10) and it is checked from three directions: `tests/architecture.test.ts` fails the build
 * if the identifier appears anywhere, `parseTownBalance` rejects any balance key matching
 * /budget/i, and this class simply has nowhere to put one. A department is people, a leader
 * and a policy.
 *
 * **A leaderless department underperforms; it does not stop.** REQ-DEP-002 says a deputy or
 * the Guild AI takes over when there is no head. So leadership is a multiplier with a floor,
 * never a gate — an unmanaged Resource Department still cuts timber, just worse. The
 * alternative reading (no head, no output) would punish the player for a roster casualty by
 * silently switching a whole branch of the town off.
 *
 * **Performance is multi-metric.** REQ-DEP-004 asks for a multi-metric dashboard, and one
 * number per department would hide exactly the trade-off the player is making — a fully
 * staffed department run by nobody and a half-staffed one under a good head must not read
 * the same. `report()` returns staffing, output, leadership and fit separately, and there is
 * deliberately no `overall` field for a UI to display instead of the four.
 */

import type {
  DepartmentData,
  DepartmentPolicyDef,
  JobDef,
  TownBalance,
  TownDepartmentId,
} from '../../data/townSchema.js';
import { DEPARTMENT_IDS } from '../../data/townSchema.js';
import type { Hunter } from '../../core/hunter/Hunter.js';
import type { HunterId } from '../../core/ids.js';
import { err, ok, type Result } from '../../core/result.js';
import { ATTRIBUTE_KEYS } from '../../data/schema.js';
import type { AttributeBalance } from '../../data/schema.js';

export type LeadershipKind = 'head' | 'deputy' | 'guild-ai';

export interface DepartmentState {
  readonly id: TownDepartmentId;
  readonly headId: HunterId | undefined;
  readonly priority: number;
  readonly policyId: string;
  /** REQ-DEP-001 — opened by Research. Carried so a save remembers what was unlocked. */
  readonly unlocked: boolean;
}

export interface DepartmentPerformance {
  readonly id: TownDepartmentId;
  readonly name: string;
  readonly unlocked: boolean;
  /** 0..1 — how much of the department's available work is being done. */
  readonly staffing: number;
  readonly staffed: number;
  readonly slots: number;
  /** Per coarse step, from the jobs actually staffed. */
  readonly output: number;
  readonly leadership: LeadershipKind;
  readonly leadershipName: string;
  /** Multiplier applied to output. Floored, never zero (REQ-DEP-002). */
  readonly leadershipEffect: number;
  /** 0..1 — how well suited the current staff are to the work they are doing. */
  readonly fit: number;
  readonly priority: number;
  readonly policy: DepartmentPolicyDef;
  /**
   * What the AI recommends, when something is clearly wrong.
   *
   * REQ-DEP-004: on poor performance the AI recommends and *the player decides*. So this is
   * a string, never an action — nothing in this system may act on its own advice.
   */
  readonly recommendation: string | undefined;
}

export interface DepartmentsSnapshot {
  readonly departments: readonly DepartmentState[];
}

export interface StaffedJob {
  readonly hunterId: string;
  readonly jobId: string;
  /** Score at assignment time, reused as the fit reading. */
  readonly score: number;
}

export interface DepartmentsDeps {
  readonly balance: TownBalance;
  /** Needed only for the starting attribute spread, so "invested" means invested. */
  readonly attributes: AttributeBalance;
  readonly content: DepartmentData;
  readonly jobs: readonly JobDef[];
  readonly hunterOf: (id: HunterId) => Hunter | undefined;
  /** Everyone currently on the town work rota. */
  readonly staffOf: () => readonly StaffedJob[];
  /** Job id -> slots the standing buildings provide. */
  readonly slotsOf: () => Readonly<Record<string, number>>;
  /**
   * Whether a department that is not open from the start has been unlocked.
   *
   * REQ-DEP-001 unlocks departments through Research, which is not built. Injected rather
   * than decided here so Research can supply the real predicate without this class changing
   * — the same stand-in-behind-an-interface shape as DL-009. The default supplied by
   * Session opens a department once the town reaches a stage that could plausibly support
   * it, which is honest interim behaviour rather than a permanently shut door (the mistake
   * Phase 5 made with reputation and then fixed).
   */
  readonly researchUnlocked?: (department: TownDepartmentId) => boolean;
}

export class Departments {
  private readonly state = new Map<TownDepartmentId, DepartmentState>();
  private readonly jobsById: ReadonlyMap<string, JobDef>;
  private readonly policiesById: ReadonlyMap<string, DepartmentPolicyDef>;

  constructor(private readonly deps: DepartmentsDeps) {
    this.jobsById = new Map(deps.jobs.map((job) => [job.id, job]));
    this.policiesById = new Map(deps.content.policies.map((p) => [p.id, p]));
    this.reset();
  }

  reset(): void {
    this.state.clear();
    const defaultPolicy = this.deps.content.policies[0]!;
    for (const def of this.deps.content.departments) {
      this.state.set(def.id, {
        id: def.id,
        headId: undefined,
        priority: this.deps.balance.departments.priorities.default,
        policyId: defaultPolicy.id,
        unlocked: def.unlockedFromStart,
      });
    }
  }

  all(): readonly DepartmentState[] {
    return DEPARTMENT_IDS.map((id) => this.state.get(id)).filter(
      (s): s is DepartmentState => s !== undefined,
    );
  }

  of(id: TownDepartmentId): DepartmentState {
    const state = this.state.get(id);
    if (!state) throw new Error(`Departments: unknown department ${id}`);
    return state;
  }

  definition(id: TownDepartmentId) {
    return this.deps.content.departments.find((d) => d.id === id);
  }

  policies(): readonly DepartmentPolicyDef[] {
    return this.deps.content.policies;
  }

  /**
   * Whether a department is open for work.
   *
   * Open from the start, unlocked and remembered, or opened by the injected research
   * predicate. Checked live rather than only at unlock time so a predicate that becomes true
   * takes effect without anything having to notice.
   */
  isUnlocked(id: TownDepartmentId): boolean {
    const state = this.state.get(id);
    if (!state) return false;
    if (state.unlocked) return true;
    return this.deps.researchUnlocked?.(id) ?? false;
  }

  /** Record an unlock permanently — a department does not close again. */
  unlock(id: TownDepartmentId): DepartmentState {
    const state = this.of(id);
    if (state.unlocked) return state;
    const opened = { ...state, unlocked: true };
    this.state.set(id, opened);
    return opened;
  }

  // --- Player intents -------------------------------------------------------

  /**
   * Appoint a Department Head (REQ-DEP-002).
   *
   * Qualification improves performance; it is not a requirement. Any hunter may be appointed
   * to any department, badly — the player is allowed to make that mistake, and the
   * performance dashboard is where they find out.
   */
  appointHead(id: TownDepartmentId, hunterId: HunterId | undefined): Result<DepartmentState, string> {
    const state = this.of(id);
    if (hunterId !== undefined && !this.deps.hunterOf(hunterId)) {
      return err(`unknown hunter ${hunterId}`);
    }
    // One hunter cannot run two departments — a head who is everywhere is a head nowhere,
    // and it would let one exceptional hunter erase the whole staffing problem.
    if (hunterId !== undefined) {
      const alreadyRunning = this.all().find((d) => d.id !== id && d.headId === hunterId);
      if (alreadyRunning) {
        const name = this.deps.hunterOf(hunterId)?.name ?? hunterId;
        return err(`${name} already heads the ${alreadyRunning.id} department`);
      }
    }

    const updated = { ...state, headId: hunterId };
    this.state.set(id, updated);
    return ok(updated);
  }

  setPriority(id: TownDepartmentId, priority: number): Result<DepartmentState, string> {
    const { min, max } = this.deps.balance.departments.priorities;
    if (!Number.isFinite(priority) || priority < min || priority > max) {
      return err(`priority must be between ${min} and ${max}`);
    }
    const updated = { ...this.of(id), priority };
    this.state.set(id, updated);
    return ok(updated);
  }

  setPolicy(id: TownDepartmentId, policyId: string): Result<DepartmentState, string> {
    if (!this.policiesById.has(policyId)) return err(`unknown department policy "${policyId}"`);
    const updated = { ...this.of(id), policyId };
    this.state.set(id, updated);
    return ok(updated);
  }

  /** Weight modifiers the assignment AI should apply for this department (rank 4). */
  policyModifiers(id: TownDepartmentId): Readonly<Record<string, number>> {
    const state = this.state.get(id);
    if (!state) return {};
    return this.policiesById.get(state.policyId)?.modifies ?? {};
  }

  priority(id: TownDepartmentId): number {
    return this.state.get(id)?.priority ?? this.deps.balance.departments.priorities.default;
  }

  // --- Leadership -----------------------------------------------------------

  /**
   * How well-run a department is, and by whom.
   *
   * A qualified head is worth up to `maxBonus` above baseline. With no head the best-scoring
   * member of the department deputises at a reduced share of their own qualification, and
   * with nobody at all the Guild AI runs it at a flat floor. Never zero (REQ-DEP-002).
   */
  leadership(id: TownDepartmentId): {
    readonly kind: LeadershipKind;
    readonly name: string;
    readonly effect: number;
  } {
    const config = this.deps.balance.departments.headQualification;
    const state = this.state.get(id);

    const head = state?.headId ? this.deps.hunterOf(state.headId) : undefined;
    if (head) {
      return {
        kind: 'head',
        name: head.name,
        effect: 1 + this.qualification(head),
      };
    }

    const deputy = this.bestMemberOf(id);
    if (deputy) {
      return {
        kind: 'deputy',
        name: `${deputy.name} (deputising)`,
        effect: 1 + this.qualification(deputy) * config.deputyScale,
      };
    }

    return { kind: 'guild-ai', name: 'the Guild AI', effect: config.guildAiFallback };
  }

  /**
   * How qualified a hunter is to lead, 0..maxBonus.
   *
   * Level plus *invested* attribute points — points above the starting spread, not the raw
   * total. A level-1 recruit has spent nothing and has nothing to show; the term should
   * measure what the player put into this hunter, not the floor every hunter starts on.
   */
  qualification(hunter: Hunter): number {
    const config = this.deps.balance.departments.headQualification;
    const starting = this.deps.attributes.startingValue;
    const invested = ATTRIBUTE_KEYS.reduce(
      (sum, key) => sum + Math.max(0, hunter.attributes[key] - starting),
      0,
    );
    return Math.min(
      config.maxBonus,
      config.perLevel * hunter.level + config.perAttributePoint * invested,
    );
  }

  /** Everyone assigned to a job belonging to this department. */
  membersOf(id: TownDepartmentId): readonly StaffedJob[] {
    return this.deps.staffOf().filter((staff) => {
      const job = this.jobsById.get(staff.jobId);
      return job?.department === id;
    });
  }

  private bestMemberOf(id: TownDepartmentId): Hunter | undefined {
    let best: Hunter | undefined;
    let bestQualification = -Infinity;
    for (const member of this.membersOf(id)) {
      const hunter = this.deps.hunterOf(member.hunterId as HunterId);
      if (!hunter) continue;
      const qualification = this.qualification(hunter);
      if (qualification > bestQualification) {
        best = hunter;
        bestQualification = qualification;
      }
    }
    return best;
  }

  // --- Performance ----------------------------------------------------------

  /** Total slots this department's jobs offer across the town. */
  slotsOf(id: TownDepartmentId): number {
    const slots = this.deps.slotsOf();
    return this.deps.jobs
      .filter((job) => job.department === id)
      .reduce((sum, job) => sum + (slots[job.id] ?? 0), 0);
  }

  /** Food produced by every staffed job, which the town counts as capacity. */
  foodOutput(): number {
    return this.deps.staffOf().reduce((sum, staff) => {
      const job = this.jobsById.get(staff.jobId);
      if (!job) return sum;
      return sum + job.output.food * this.leadership(job.department).effect;
    }, 0);
  }

  /** Materials produced per coarse step. Held for the Phase 7 economy ledger. */
  materialsOutput(): number {
    return this.deps.staffOf().reduce((sum, staff) => {
      const job = this.jobsById.get(staff.jobId);
      if (!job) return sum;
      return sum + job.output.materials * this.leadership(job.department).effect;
    }, 0);
  }

  /** REQ-DEP-004's dashboard. Four metrics, reported side by side and never merged. */
  report(id: TownDepartmentId): DepartmentPerformance {
    const def = this.definition(id);
    const state = this.of(id);
    const members = this.membersOf(id);
    const slots = this.slotsOf(id);
    const leadership = this.leadership(id);
    const policy = this.policiesById.get(state.policyId) ?? this.deps.content.policies[0]!;

    const staffing = slots <= 0 ? 0 : Math.min(1, members.length / slots);
    const output =
      members.reduce((sum, member) => {
        const job = this.jobsById.get(member.jobId);
        return sum + (job?.output.performance ?? 0);
      }, 0) *
      leadership.effect *
      this.deps.balance.departments.performance.outputPerStaffPoint;

    // The assignment score is already a suitability reading, so reusing it keeps one
    // definition of "fit" rather than inventing a second that could disagree with it.
    const fit =
      members.length === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, members.reduce((sum, m) => sum + m.score, 0) / members.length),
          );

    return {
      id,
      name: def?.name ?? id,
      unlocked: this.isUnlocked(id),
      staffing,
      staffed: members.length,
      slots,
      output,
      leadership: leadership.kind,
      leadershipName: leadership.name,
      leadershipEffect: leadership.effect,
      fit,
      priority: state.priority,
      policy,
      recommendation: this.recommend(id, { staffing, slots, leadership: leadership.kind, fit }),
    };
  }

  reports(): readonly DepartmentPerformance[] {
    return DEPARTMENT_IDS.map((id) => this.report(id));
  }

  /**
   * Advice, never action (REQ-DEP-004).
   *
   * One recommendation at most, and only when something is genuinely wrong — a dashboard
   * that always has advice on it is a dashboard nobody reads.
   */
  private recommend(
    id: TownDepartmentId,
    reading: {
      readonly staffing: number;
      readonly slots: number;
      readonly leadership: LeadershipKind;
      readonly fit: number;
    },
  ): string | undefined {
    if (!this.isUnlocked(id)) return undefined;
    if (reading.slots === 0) {
      return 'No building in town offers this department any work. Build one, or lower its priority.';
    }
    if (reading.staffing <= 0) {
      return 'Nobody is doing this work. Raise the department priority, or free up a hunter.';
    }
    if (reading.leadership === 'guild-ai') {
      return 'Running itself. Appointing a head would be worth about a quarter of its output.';
    }
    if (reading.staffing < 0.5) {
      return `Only ${Math.round(reading.staffing * 100)}% of its posts are filled.`;
    }
    if (reading.leadership === 'deputy') {
      return 'A deputy is standing in. Appointing a head properly would help.';
    }
    if (reading.fit < 0.25) {
      return 'The people doing this work are poorly suited to it. Try the "Push output" policy.';
    }
    return undefined;
  }

  // --- Persistence ----------------------------------------------------------

  snapshot(): DepartmentsSnapshot {
    return { departments: this.all() };
  }

  restore(snapshot: DepartmentsSnapshot | undefined): void {
    this.reset();
    for (const entry of snapshot?.departments ?? []) {
      const current = this.state.get(entry.id);
      if (!current) continue;
      // Merged onto the current default, so a save written before a field existed still
      // gets that field's default rather than undefined. Same rule as WorldKnowledge.
      this.state.set(entry.id, {
        ...current,
        ...entry,
        // A policy that no longer exists falls back rather than persisting a dangling id.
        policyId: this.policiesById.has(entry.policyId) ? entry.policyId : current.policyId,
        // Never un-unlock: a department the guild opened stays open.
        unlocked: current.unlocked || entry.unlocked,
      });
    }
  }
}
