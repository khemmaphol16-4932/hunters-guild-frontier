import type { WorldBossDef } from '../../data/worldBossSchema.js';

export interface WorldBossEvent {
  readonly id: string;
  readonly bossId: string;
  readonly regionId: string;
  readonly appearedAtTick: number;
}

export interface WorldEventsSnapshot {
  readonly activeWorldBoss?: WorldBossEvent;
  readonly nextWorldBossAtTick: number;
  readonly worldBossDefeats: number;
  /** Kills since the boss last dropped its card — the duplicate-protection counter. */
  readonly killsSinceCard?: number;
}

export interface WorldEventsDeps {
  readonly boss: WorldBossDef;
  /** Fine ticks per coarse step, from the clock (DL-020, DL-042). */
  readonly ticksPerStep: () => number;
  /** Told once, when the boss appears. */
  readonly onAppeared?: (event: WorldBossEvent) => void;
}

/**
 * Deterministic world-boss appearance and respawn state (REQ-BOS-003).
 *
 * The respawn interval is authored in coarse steps and converted with the clock's ratio.
 * The first version added a step count straight to the tick, so the Choir returned after 25
 * steps rather than 500 — the same second-clock mistake DL-042 recorded, in a new file.
 */
export class WorldEvents {
  private activeBoss: WorldBossEvent | undefined;
  private nextAppearance: number;
  private defeats = 0;
  private sinceCard = 0;

  constructor(private readonly deps: WorldEventsDeps) {
    this.nextAppearance = deps.boss.firstAppearanceSteps * deps.ticksPerStep();
  }

  /**
   * The boss, if it is abroad at `tick`. Appearance is decided here, lazily, because it is a
   * pure function of the clock: asking twice at the same tick always gives the same answer.
   */
  currentWorldBoss(tick: number): WorldBossEvent | undefined {
    if (!this.activeBoss && tick >= this.nextAppearance) {
      this.activeBoss = {
        id: `${this.deps.boss.id}:${this.defeats + 1}`,
        bossId: this.deps.boss.bossId,
        regionId: this.deps.boss.regionId,
        appearedAtTick: tick,
      };
      this.deps.onAppeared?.(this.activeBoss);
    }
    return this.activeBoss;
  }

  defeat(eventId: string, tick: number): boolean {
    if (this.activeBoss?.id !== eventId) return false;
    this.activeBoss = undefined;
    this.defeats += 1;
    this.nextAppearance = tick + this.deps.boss.respawnSteps * this.deps.ticksPerStep();
    return true;
  }

  get killsSinceCard(): number { return this.sinceCard; }
  recordCardRoll(dropped: boolean): void { this.sinceCard = dropped ? 0 : this.sinceCard + 1; }

  snapshot(): WorldEventsSnapshot {
    return {
      ...(this.activeBoss ? { activeWorldBoss: this.activeBoss } : {}),
      nextWorldBossAtTick: this.nextAppearance,
      worldBossDefeats: this.defeats,
      killsSinceCard: this.sinceCard,
    };
  }

  restore(snapshot: WorldEventsSnapshot | undefined): void {
    this.activeBoss = snapshot?.activeWorldBoss;
    this.nextAppearance = Math.max(0, snapshot?.nextWorldBossAtTick ?? 0);
    this.defeats = Math.max(0, snapshot?.worldBossDefeats ?? 0);
    this.sinceCard = Math.max(0, snapshot?.killsSinceCard ?? 0);
  }
}
