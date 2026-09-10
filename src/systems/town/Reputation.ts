/**
 * Guild reputation.
 *
 * This exists to close a gap Phase 5 left open honestly. REQ-WLD-002 gates regions on
 * combinations of level, reputation, story and capability, and the reputation axis was
 * *parsed and carried but reported as unsatisfied* (DL-033) because nothing tracked it. A
 * region gated on reputation was therefore permanently shut. Now it is a real quantity, and
 * `GuildCommands.regionAvailability` can evaluate it instead of apologising for it.
 *
 * v1.0 §10 asks that reputation's formula be *transparent enough to explain meaningful
 * changes* without exposing every hidden probability. So every change is a named, bounded
 * delta with a reason string attached, and the recent history is kept — the player can read
 * why the number moved rather than watching it drift.
 *
 * What reputation is not: a difficulty score, or a second guild level. §10 explicitly keeps
 * progression multi-axis, so this is one axis among several and it deliberately has no
 * effect on combat, loot or hunter power. It changes who arrives in town (Population) and
 * where the guild is allowed to go (region unlocks).
 */

import type { TownBalance } from '../../data/townSchema.js';

export interface ReputationChange {
  readonly delta: number;
  readonly reason: string;
}

export interface ReputationSnapshot {
  readonly value: number;
  readonly recent: readonly ReputationChange[];
}

/** How many changes are kept for explanation. Bounded, like the Chronicle's notable ring. */
const RECENT_CAPACITY = 20;

export interface ReputationDeps {
  readonly balance: TownBalance;
  /**
   * What research has done for the guild's standing.
   *
   * Applied to *gains* only, never to losses. Research is meant to make good work count for
   * more; letting it soften the cost of losing a party would turn a reputation system into
   * an insurance policy, and the whole point of the black zones is that they cost something.
   */
  readonly researchScale?: () => number;
}

export class Reputation {
  private value: number;
  private recent: ReputationChange[] = [];

  constructor(private readonly deps: ReputationDeps) {
    this.value = deps.balance.reputation.starting;
  }

  get current(): number {
    return this.value;
  }

  /** The last few changes, newest first — the "why did this move" list. */
  history(): readonly ReputationChange[] {
    return [...this.recent];
  }

  /**
   * Apply a change. Clamped to [0, max], and a clamped change records what actually
   * happened rather than what was asked for, so the history never claims credit the number
   * did not receive.
   */
  change(delta: number, reason: string): number {
    const max = this.deps.balance.reputation.max;
    const before = this.value;
    const scaled = delta > 0 ? delta * (this.deps.researchScale?.() ?? 1) : delta;
    this.value = Math.min(max, Math.max(0, before + scaled));

    const actual = this.value - before;
    if (actual !== 0) {
      this.recent.unshift({ delta: actual, reason });
      if (this.recent.length > RECENT_CAPACITY) this.recent.length = RECENT_CAPACITY;
    }
    return this.value;
  }

  /**
   * What an expedition was worth.
   *
   * Weighted by danger, so a hundred walks through a Blue zone are worth nothing and one
   * Black-zone route is worth noticing — the frontier is not impressed by safe work. A wipe
   * costs reputation and so does a death, because the guild's standing is partly a claim
   * about competence.
   */
  recordExpedition(outcome: {
    readonly zoneTier: string;
    readonly bossDefeated: boolean;
    readonly worldBoss: boolean;
    readonly wiped: boolean;
    readonly deaths: number;
    readonly regionName: string;
  }): number {
    const balance = this.deps.balance.reputation;

    let delta = balance.perExpedition + (balance.perZoneTier[outcome.zoneTier] ?? 0);
    if (outcome.bossDefeated) {
      delta += outcome.worldBoss ? balance.perWorldBossDefeated : balance.perBossDefeated;
    }
    if (outcome.wiped) delta -= balance.lossPerWipe;
    delta -= balance.lossPerDeath * Math.max(0, outcome.deaths);

    return this.change(delta, reasonFor(outcome));
  }

  snapshot(): ReputationSnapshot {
    return { value: this.value, recent: this.history() };
  }

  restore(snapshot: ReputationSnapshot | undefined): void {
    this.value = snapshot?.value ?? this.deps.balance.reputation.starting;
    this.recent = [...(snapshot?.recent ?? [])].slice(0, RECENT_CAPACITY);
  }
}

function reasonFor(outcome: {
  readonly bossDefeated: boolean;
  readonly worldBoss: boolean;
  readonly wiped: boolean;
  readonly deaths: number;
  readonly regionName: string;
}): string {
  if (outcome.wiped) return `the party lost in ${outcome.regionName}`;
  if (outcome.bossDefeated) {
    return outcome.worldBoss
      ? `killed the warden of ${outcome.regionName}`
      : `cleared ${outcome.regionName} to its end`;
  }
  if (outcome.deaths > 0) return `${outcome.regionName}, at a cost`;
  return `an expedition into ${outcome.regionName}`;
}
