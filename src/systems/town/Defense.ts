/**
 * Town defense.
 *
 * REQ-TWN-008: *"Town defense occurs as occasional events that can damage buildings. The
 * player sets guard policy; the AI organizes guards. If hunters are away, the Guild AI
 * evaluates severity."*
 *
 * Three things that sentence asks for, and each shapes something here:
 *
 * **The player sets policy; the AI organises.** So this class does not decide *whether* to
 * defend — it decides *who stands at the wall*, under a policy the player chose. The three
 * authored policies are the interesting part: "guards only" and "all hands" are the two
 * obvious readings, and `severity_based` is the requirement's own "the Guild AI evaluates
 * severity" offered as a choice rather than buried as hidden behaviour. A player who wants
 * the AI to judge can ask for it; a player who wants a rule gets a rule.
 *
 * **It can damage buildings.** Which makes defense the only thing in the game that lowers
 * town capacity, and therefore the reason the stage ladder is stored rather than derived
 * (DL-037). A burnt granary must not demote a Fortified Town back to a Village.
 *
 * **If hunters are away.** A guild whose whole roster is in the field has nobody at the
 * wall, and the town takes the hit. That is the actual cost of an aggressive deployment
 * schedule, and it is deliberately not softened: the alternative — recalling hunters from an
 * expedition — would let defense reach into a running simulation, which nothing else does.
 */

import type { DefenseConfig, ThreatDef } from '../../data/threatSchema.js';
import type { Hunter } from '../../core/hunter/Hunter.js';
import type { HunterId } from '../../core/ids.js';
import { isDeployable } from '../../core/hunter/availability.js';
import { err, ok, type Result } from '../../core/result.js';

export interface DefenseSnapshot {
  readonly policyId: string;
  /** Tick at which the walls may next be tested. */
  readonly nextThreatTick: number;
  readonly threatsFaced: number;
  readonly threatsHeld: number;
}

export interface DefenseDeps {
  readonly config: DefenseConfig;
  readonly reputationOf: () => number;
  readonly currentTick: () => number;
  readonly ticksPerStep: () => number;
  readonly rosterOf: () => readonly Hunter[];
  /** Hunter ids currently on a defense-department job — the posted guards. */
  readonly postedGuardsOf: () => readonly HunterId[];
  /** Defence capacity from walls and towers, which decides how much the town holds alone. */
  readonly defenceCapacityOf: () => number;
}

export class Defense {
  private policyId: string;
  private nextThreatTick = 0;
  private threatsFaced = 0;
  private threatsHeld = 0;

  constructor(private readonly deps: DefenseDeps) {
    this.policyId = deps.config.defaultPolicy;
    // The grace period is measured from the guild's founding, so a brand-new town is not
    // attacked before it has had any chance to raise a wall. A first hour spent losing
    // buildings teaches the player nothing except that the game is unfair.
    this.nextThreatTick = deps.config.graceSteps * deps.ticksPerStep();
  }

  get policy(): string {
    return this.policyId;
  }

  policies() {
    return this.deps.config.guardPolicies;
  }

  setPolicy(policyId: string): Result<string, string> {
    if (!this.deps.config.guardPolicies.some((p) => p.id === policyId)) {
      return err(`unknown guard policy "${policyId}"`);
    }
    this.policyId = policyId;
    return ok(policyId);
  }

  /** Faced / held, for the town panel. A town that never holds is a town in trouble. */
  get record(): { readonly faced: number; readonly held: number } {
    return { faced: this.threatsFaced, held: this.threatsHeld };
  }

  ticksUntilThreat(): number {
    return Math.max(0, this.nextThreatTick - this.deps.currentTick());
  }

  /** Which threats can arrive at the guild's current standing. */
  eligibleThreats(): readonly ThreatDef[] {
    const reputation = this.deps.reputationOf();
    return this.deps.config.threats.filter((t) => reputation >= t.reputationAtLeast);
  }

  /**
   * Whether something is at the walls, and what.
   *
   * Returns undefined when the timer has not come due. The caller runs the fight, because
   * running combat is `sim/`'s job and this is a `systems/` class — the same separation
   * that keeps `TownJobs` from importing the scorer that fills it.
   */
  threatDue(rng: { next(): number }): ThreatDef | undefined {
    if (this.deps.currentTick() < this.nextThreatTick) return undefined;

    const eligible = this.eligibleThreats();
    this.nextThreatTick =
      this.deps.currentTick() + this.deps.config.everySteps * this.deps.ticksPerStep();
    if (eligible.length === 0) return undefined;

    const total = eligible.reduce((sum, t) => sum + t.weight, 0);
    let roll = rng.next() * total;
    for (const threat of eligible) {
      roll -= threat.weight;
      if (roll <= 0) return threat;
    }
    return eligible[eligible.length - 1];
  }

  /**
   * Who stands at the wall, under the policy the player set.
   *
   * Only hunters who are actually *in town* are candidates — `isDeployable` is false for
   * anyone assigned, recovering or injured, and a hunter in the field cannot be at the gate.
   * That is REQ-TWN-008's "if hunters are away" doing real work rather than being a caveat.
   */
  defenders(threat: ThreatDef): readonly HunterId[] {
    const posted = new Set(this.deps.postedGuardsOf());
    const inTown = this.deps
      .rosterOf()
      .filter((hunter) => isDeployable(hunter.availability));

    const everyone = inTown.map((h) => h.id);
    const guards = everyone.filter((id) => posted.has(id));

    switch (this.policyId) {
      case 'guards_only':
        return guards;
      case 'all_available':
        return everyone;
      case 'severity_based':
      default:
        // The Guild AI's judgement, and it is a judgement about *sufficiency* rather than a
        // fixed threshold: the wall's own defence capacity counts, so a town with towers
        // handles a wolf pack with its posted watch and only calls everyone out when the
        // threat is beyond what the walls plus the guards can be expected to hold.
        return this.guardsAreEnough(threat, guards.length) ? guards : everyone;
    }
  }

  /** Why the AI called out whoever it called out — v1.0 §14 applied to the wall. */
  explainDefenders(threat: ThreatDef, chosen: readonly HunterId[]): string {
    switch (this.policyId) {
      case 'guards_only':
        return chosen.length === 0
          ? 'Guards-only orders, and nobody was posted.'
          : `Guards-only orders: ${chosen.length} on the wall.`;
      case 'all_available':
        return chosen.length === 0
          ? 'All hands called, and nobody was in town.'
          : `All hands: ${chosen.length} came to the wall.`;
      default:
        return this.guardsAreEnough(threat, chosen.length)
          ? `The Guild AI judged the watch sufficient (severity ${threat.severity}).`
          : `The Guild AI called everyone out (severity ${threat.severity}).`;
    }
  }

  /**
   * Whether the posted watch, standing behind the walls the town has, should hold this.
   *
   * Deliberately simple and deliberately readable: each guard and each two points of
   * defence capacity is worth roughly one point of severity. The player can state this rule
   * back, which matters more here than precision — an opaque sufficiency check would make
   * the AI's decision feel arbitrary at exactly the moment it costs buildings.
   */
  private guardsAreEnough(threat: ThreatDef, guards: number): boolean {
    const wall = this.deps.defenceCapacityOf() / 2;
    return guards > 0 && guards + wall >= threat.severity * 2;
  }

  /** Record the outcome, for the town panel and for the player's sense of how it is going. */
  recordOutcome(held: boolean): void {
    this.threatsFaced += 1;
    if (held) this.threatsHeld += 1;
  }

  snapshot(): DefenseSnapshot {
    return {
      policyId: this.policyId,
      nextThreatTick: this.nextThreatTick,
      threatsFaced: this.threatsFaced,
      threatsHeld: this.threatsHeld,
    };
  }

  restore(snapshot: DefenseSnapshot | undefined): void {
    const known = this.deps.config.guardPolicies.some((p) => p.id === snapshot?.policyId);
    this.policyId = known && snapshot ? snapshot.policyId : this.deps.config.defaultPolicy;
    this.nextThreatTick =
      snapshot?.nextThreatTick ?? this.deps.config.graceSteps * this.deps.ticksPerStep();
    this.threatsFaced = snapshot?.threatsFaced ?? 0;
    this.threatsHeld = snapshot?.threatsHeld ?? 0;
  }
}
