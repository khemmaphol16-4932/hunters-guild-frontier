/**
 * Guild research.
 *
 * REQ-RES-001: a tree with multiple branches, where some choices lock others so the tree
 * becomes a guild *identity* rather than a checklist to complete. REQ-RES-002: research is
 * technology; Guild Mastery is experience; the two ledgers never merge.
 *
 * That second requirement is the one with teeth, and it is satisfied by where the points
 * come from rather than by a comment. Research points accrue **only** from the Research
 * department's output — staffed people, in a building, doing archive work. Nothing a hunter
 * does well produces a research point, which means the two ledgers cannot merge by accident
 * later: there is no code path from mastery to here.
 *
 * The other structural decision is that **completion is permanent and conflicts are
 * permanent with it**. Taking `standing_watch` forecloses `travel_light` for the life of the
 * guild, and the only way back is REQ-RES-001's reset. A lock that could be quietly undone
 * would make the identity claim hollow.
 *
 * What this class does *not* do is apply its own effects. It reports them — `recoveryScale`,
 * `capacityBonus`, `unlocksDepartment` — and the systems that own those readings ask. That
 * keeps research from becoming a second place where town rules live, which is exactly the
 * god-object §126 forbids.
 */

import type { CapacityKey } from '../../data/townSchema.js';
import type { ResearchData, ResearchNodeDef } from '../../data/researchSchema.js';
import { err, ok, type Result } from '../../core/result.js';

export interface ResearchSnapshot {
  readonly completed: readonly string[];
  /** The node currently being worked on, if any. */
  readonly active: string | undefined;
  /** Points banked toward the active node. */
  readonly progress: number;
}

export type ResearchAvailability =
  | { readonly state: 'completed' }
  | { readonly state: 'available' }
  | { readonly state: 'active'; readonly progress: number; readonly cost: number }
  /** REQ-RES-001's "partial requirements" — say which, not merely that. */
  | { readonly state: 'blocked'; readonly missing: readonly string[] }
  /** Foreclosed by a choice already made. Permanent short of a reset. */
  | { readonly state: 'foreclosed'; readonly by: readonly string[] };

export interface ResearchEntry {
  readonly node: ResearchNodeDef;
  readonly availability: ResearchAvailability;
  /** Authored result preview, so the player reads the writer's words (REQ-RES-001). */
  readonly effects: readonly string[];
}

export interface ResearchDeps {
  readonly content: ResearchData;
  /** Institutional experience is a gate, never a source of research points. */
  readonly masteryLevel?: () => number;
  readonly onCompleted?: (node: ResearchNodeDef) => void;
}

export class Research {
  private completed = new Set<string>();
  private active: string | undefined;
  private progress = 0;
  private readonly byId: ReadonlyMap<string, ResearchNodeDef>;

  constructor(private readonly deps: ResearchDeps) {
    this.byId = new Map(deps.content.nodes.map((n) => [n.id, n]));
  }

  node(id: string): ResearchNodeDef | undefined {
    return this.byId.get(id);
  }

  isComplete(id: string): boolean {
    return this.completed.has(id);
  }
  completedCount(): number {
    return this.completed.size;
  }

  completedNodes(): readonly ResearchNodeDef[] {
    return this.deps.content.nodes.filter((n) => this.completed.has(n.id));
  }

  get current(): { readonly node: ResearchNodeDef; readonly progress: number } | undefined {
    const node = this.active ? this.byId.get(this.active) : undefined;
    return node ? { node, progress: this.progress } : undefined;
  }

  // --- Availability ---------------------------------------------------------

  /** Which completed nodes forbid this one. Permanent (REQ-RES-001). */
  private foreclosedBy(node: ResearchNodeDef): readonly string[] {
    // Symmetry is validated at load, so checking one direction is enough — but both are
    // checked anyway, because a save written against older content might not be symmetric.
    return this.completedNodes()
      .filter(
        (done) => done.conflictsWith.includes(node.id) || node.conflictsWith.includes(done.id),
      )
      .map((done) => done.name);
  }

  availabilityOf(id: string): ResearchAvailability {
    const node = this.byId.get(id);
    if (!node) return { state: 'blocked', missing: ['unknown research'] };
    if (this.completed.has(id)) return { state: 'completed' };

    const foreclosed = this.foreclosedBy(node);
    if (foreclosed.length > 0) return { state: 'foreclosed', by: foreclosed };

    const missing = node.requires
      .filter((required) => !this.completed.has(required))
      .map((required) => this.byId.get(required)?.name ?? required);
    const masteryLevel = this.deps.masteryLevel?.() ?? 1;
    const requiredMastery = node.masteryLevel ?? 1;
    if (masteryLevel < requiredMastery) {
      missing.push(`Guild Mastery level ${requiredMastery} (currently ${masteryLevel})`);
    }
    if (missing.length > 0) return { state: 'blocked', missing };

    if (this.active === id) {
      return { state: 'active', progress: this.progress, cost: node.cost };
    }
    return { state: 'available' };
  }

  /** The whole tree with its state — what the research screen renders (REQ-RES-001). */
  tree(): readonly ResearchEntry[] {
    return this.deps.content.nodes.map((node) => ({
      node,
      availability: this.availabilityOf(node.id),
      effects: node.effects.map((e) => e.describe),
    }));
  }

  // --- Doing the work -------------------------------------------------------

  /**
   * Begin researching a node.
   *
   * Switching away from a part-finished node keeps its progress — a guild that changes its
   * mind should not be punished for having thought about something, and losing banked work
   * would make the tree feel like a trap rather than a plan.
   */
  begin(id: string): Result<ResearchNodeDef, string> {
    const node = this.byId.get(id);
    if (!node) return err(`unknown research "${id}"`);

    const availability = this.availabilityOf(id);
    switch (availability.state) {
      case 'completed':
        return err(`${node.name} is already known`);
      case 'foreclosed':
        return err(`${node.name} was ruled out by ${availability.by.join(' and ')}`);
      case 'blocked':
        return err(`${node.name} needs ${availability.missing.join(', ')} first`);
      default:
        break;
    }

    if (this.active !== id) {
      if (this.active !== undefined) this.banked.set(this.active, this.progress);
      this.active = id;
      // Whatever was banked against this node, plus any overflow from the last completion.
      this.progress = (this.banked.get(id) ?? 0) + this.carryOver;
      this.banked.delete(id);
      this.carryOver = 0;
    }
    return ok(node);
  }

  /** Progress banked against nodes not currently being worked on. */
  private banked = new Map<string, number>();
  /** Points left over from a completion, spent on whatever is started next. */
  private carryOver = 0;

  /**
   * Spend research points. Returns the node if this completed one.
   *
   * Called from the town's coarse step with the Research department's output, which is the
   * only source (REQ-RES-002).
   */
  contribute(points: number): ResearchNodeDef | undefined {
    if (this.active === undefined || points <= 0) return undefined;
    const node = this.byId.get(this.active);
    if (!node) return undefined;

    this.progress += points;
    if (this.progress < node.cost) return undefined;

    // Overflow is kept against the next node rather than discarded, so a department that
    // out-produces a cheap node does not waste a step's work.
    this.carryOver = Math.max(0, this.progress - node.cost);
    this.completed.add(node.id);
    this.banked.delete(node.id);
    this.active = undefined;
    this.progress = 0;

    this.deps.onCompleted?.(node);
    return node;
  }

  /**
   * REQ-RES-001 — research can be reset with a rare resource.
   *
   * The cost is reported to the command boundary, which charges the economy ledger. What
   * the reset genuinely does is undo the
   * *locks*, which is the whole point: it is the only way a guild changes its identity.
   */
  reset(): { readonly cleared: number; readonly cost: ResearchData['resetResource'] } {
    const cleared = this.completed.size;
    this.completed.clear();
    this.banked.clear();
    this.active = undefined;
    this.progress = 0;
    this.carryOver = 0;
    return { cleared, cost: this.deps.content.resetResource };
  }

  // --- What other systems ask -----------------------------------------------

  /** Whether research has opened a department (REQ-DEP-001). */
  unlocksDepartment(department: string): boolean {
    return this.completedNodes().some((node) =>
      node.effects.some((e) => e.kind === 'department' && e.value === department),
    );
  }

  /** Whether research has opened a building. */
  unlocksBuilding(buildingId: string): boolean {
    return this.completedNodes().some((node) =>
      node.effects.some((e) => e.kind === 'building' && e.value === buildingId),
    );
  }

  /** Flat capacity research adds on one axis. */
  capacityBonus(axis: CapacityKey): number {
    return this.completedNodes().reduce(
      (sum, node) =>
        sum +
        node.effects
          .filter((e) => e.kind === 'capacity' && e.axis === axis)
          .reduce((inner, e) => inner + (typeof e.value === 'number' ? e.value : 0), 0),
      0,
    );
  }

  /** Multiplier research applies to a quality axis. Multiplicative, so stacking compounds. */
  qualityScale(axis: CapacityKey): number {
    return this.scaleOf((e) => e.kind === 'quality' && e.axis === axis);
  }

  recoveryScale(): number {
    return this.scaleOf((e) => e.kind === 'recovery');
  }

  /** Applied to reputation *gains* only — research never protects against losses. */
  reputationScale(): number {
    return this.scaleOf((e) => e.kind === 'reputation');
  }

  private scaleOf(
    matches: (effect: ResearchNodeDef['effects'][number]) => boolean,
  ): number {
    let scale = 1;
    for (const node of this.completedNodes()) {
      for (const effect of node.effects) {
        if (matches(effect) && typeof effect.value === 'number') scale *= effect.value;
      }
    }
    return scale;
  }

  // --- Persistence ----------------------------------------------------------

  snapshot(): ResearchSnapshot {
    return {
      // Sorted so two saves of the same guild compare equal.
      completed: [...this.completed].sort(),
      active: this.active,
      progress: this.progress,
    };
  }

  restore(snapshot: ResearchSnapshot | undefined): void {
    this.completed = new Set(
      // Filtered against current content: a save naming research that has since been removed
      // should lose that node rather than carry a dangling id into every effect query.
      (snapshot?.completed ?? []).filter((id) => this.byId.has(id)),
    );
    this.banked = new Map();
    this.carryOver = 0;
    this.active =
      snapshot?.active !== undefined && this.byId.has(snapshot.active)
        ? snapshot.active
        : undefined;
    this.progress = this.active === undefined ? 0 : (snapshot?.progress ?? 0);
  }
}
