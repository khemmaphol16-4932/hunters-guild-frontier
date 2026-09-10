/**
 * The Recruitment Hall.
 *
 * REQ-RCT-001: recruitment runs through the Recruitment Hall and its recruiter, with a
 * dynamic pool depending on town, reputation and region, refreshed *both* on a timer and for
 * a price. REQ-RCT-002: different regions produce clearly different pools, and an exceptional
 * recruit is immediately legible.
 *
 * Two decisions worth stating.
 *
 * **The building is load-bearing.** With no Recruitment Hall standing there is no pool at
 * all — not a smaller one, not a worse one. That is what makes it a building rather than a
 * menu, and it is the same reasoning that made the town a grid in the first place: if the
 * hall were optional decoration, nothing about the town would ever be traded against
 * anything.
 *
 * **A candidate is a whole Hunter, held aside.** Not a summary, not a seed to be realised on
 * hire — the same record, with the same attributes, potential and rolled traits they will
 * have on the roster. It costs nothing extra and it removes a whole category of bug: a
 * preview that disagrees with what the player actually receives.
 *
 * The pool is drawn from the recruit RNG stream and is saved, so refreshing is reproducible
 * and a reload does not reroll the people standing in front of the player.
 */

import type { Rng } from '../../core/rng.js';
import type { Hunter } from '../../core/hunter/Hunter.js';
import type { Candidate } from '../../core/town/recruitment.js';
import type { OriginDef, RecruitData } from '../../data/recruitSchema.js';
import { err, ok, type Result } from '../../core/result.js';

export interface RecruitmentSnapshot {
  readonly candidates: readonly Candidate[];
  /** Tick at which the timed refresh next comes due (REQ-RCT-001). */
  readonly nextRefreshTick: number;
}

export interface GeneratedRecruit {
  readonly hunter: Hunter;
  /** Composite potential 0..1, so the exceptional threshold has something to test. */
  readonly potential: number;
}

export interface RecruitmentDeps {
  readonly content: RecruitData;
  readonly reputationOf: () => number;
  /** Whether a Recruitment Hall actually stands in the town. */
  readonly hallStanding: () => boolean;
  readonly currentTick: () => number;
  readonly ticksPerStep: () => number;
  /**
   * Make one candidate from an origin's biases.
   *
   * Injected because generating a hunter is the composition root's business — it needs the
   * constellation, the name pools and the potential roller, none of which this system should
   * know about. Recruitment decides *who shows up*; the root decides how a hunter is built.
   */
  readonly generate: (origin: OriginDef, rng: Rng) => GeneratedRecruit;
}

export class Recruitment {
  private candidates: Candidate[] = [];
  private nextRefreshTick = 0;

  constructor(private readonly deps: RecruitmentDeps) {}

  available(): readonly Candidate[] {
    // The hall is load-bearing: no building, no pool. Checked on read as well as on refresh
    // so demolishing the hall empties it immediately rather than at the next refresh.
    return this.deps.hallStanding() ? this.candidates : [];
  }

  candidate(hunterId: string): Candidate | undefined {
    return this.available().find((c) => c.hunter.id === hunterId);
  }

  /** Ticks until the free refresh, or undefined when one is already due. */
  ticksUntilRefresh(): number | undefined {
    const remaining = this.nextRefreshTick - this.deps.currentTick();
    return remaining > 0 ? remaining : undefined;
  }

  /**
   * How many people are waiting.
   *
   * REQ-RCT-001 makes the pool depend on the guild's standing, and size is the most legible
   * axis for that — a well-known guild simply has more people to choose from. Capped, so
   * reputation cannot turn recruitment into a shop with everything in it.
   */
  poolSize(): number {
    const { size, sizePerReputation, maxSize } = this.deps.content.pool;
    return Math.min(
      maxSize,
      Math.floor(size + sizePerReputation * Math.max(0, this.deps.reputationOf())),
    );
  }

  /** Which origins can appear at the guild's current standing (REQ-RCT-001). */
  eligibleOrigins(): readonly OriginDef[] {
    const reputation = this.deps.reputationOf();
    return this.deps.content.origins.filter((o) => reputation >= o.reputationAtLeast);
  }

  /**
   * Draw a new pool.
   *
   * Everyone currently waiting is replaced — a refresh is people leaving and other people
   * arriving, not a re-roll of the same faces. That matters for the paid refresh in
   * particular: the player is buying a different set, and keeping anyone would make the
   * price feel arbitrary.
   */
  refresh(rng: Rng): readonly Candidate[] {
    if (!this.deps.hallStanding()) {
      this.candidates = [];
      return [];
    }

    const origins = this.eligibleOrigins();
    const size = this.poolSize();
    const drawn: Candidate[] = [];

    for (let i = 0; i < size; i++) {
      const origin = this.pickOrigin(origins, rng);
      if (!origin) break;

      const recruit = this.deps.generate(origin, rng);
      drawn.push({
        hunter: recruit.hunter,
        originId: origin.id,
        originName: origin.name,
        originNote: origin.description,
        exceptional: recruit.potential >= this.deps.content.exceptional.potentialAtLeast,
        cost: this.costOf(recruit),
      });
    }

    this.candidates = drawn;
    this.nextRefreshTick =
      this.deps.currentTick() + this.deps.content.pool.refreshEverySteps * this.deps.ticksPerStep();
    return this.available();
  }

  /** Refresh only if the timer has come due. Called from the town's coarse step. */
  refreshIfDue(rng: Rng): readonly Candidate[] | undefined {
    if (!this.deps.hallStanding()) return undefined;
    if (this.candidates.length > 0 && this.ticksUntilRefresh() !== undefined) return undefined;
    return this.refresh(rng);
  }

  /**
   * Take a candidate off the board.
   *
   * Returns the Hunter for the caller to enlist. Recruitment does not touch the roster
   * itself — who is in the guild is `Session`'s business, and a system that could add
   * hunters from the side would make the roster's invariants unenforceable.
   */
  hire(hunterId: string): Result<Candidate, string> {
    if (!this.deps.hallStanding()) {
      return err('the guild has no Recruitment Hall');
    }
    const index = this.candidates.findIndex((c) => c.hunter.id === hunterId);
    if (index < 0) return err('that candidate is no longer at the hall');

    const [taken] = this.candidates.splice(index, 1);
    return taken ? ok(taken) : err('that candidate is no longer at the hall');
  }

  /** Someone the guild passed on. They leave; the seat is not refilled until a refresh. */
  turnAway(hunterId: string): Result<Candidate, string> {
    return this.hire(hunterId);
  }

  /**
   * What a candidate costs to take on.
   *
   * Scales with potential rather than with current power, because v1.0 §4 makes recruitment
   * about *who they could become*. Reported and not charged until the Phase 7 ledger exists,
   * like every other price in the game right now.
   */
  private costOf(recruit: GeneratedRecruit): number {
    const base = this.deps.content.pool.paidRefreshGold / 2;
    const scaled = base * (0.5 + recruit.potential * 2);
    return Math.round(scaled / 10) * 10;
  }

  /** Weighted draw over the origins the guild's standing allows. */
  private pickOrigin(origins: readonly OriginDef[], rng: Rng): OriginDef | undefined {
    const total = origins.reduce((sum, o) => sum + o.weight, 0);
    if (total <= 0) return undefined;

    let roll = rng.next() * total;
    for (const origin of origins) {
      roll -= origin.weight;
      if (roll <= 0) return origin;
    }
    return origins[origins.length - 1];
  }

  snapshot(): RecruitmentSnapshot {
    return { candidates: this.candidates, nextRefreshTick: this.nextRefreshTick };
  }

  restore(snapshot: RecruitmentSnapshot | undefined): void {
    this.candidates = [...(snapshot?.candidates ?? [])];
    this.nextRefreshTick = snapshot?.nextRefreshTick ?? 0;
  }
}
