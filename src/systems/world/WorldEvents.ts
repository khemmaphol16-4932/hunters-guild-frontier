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
}

const RESPAWN_STEPS = 500;

/** Deterministic world-boss appearance and respawn state (REQ-BOS-003). */
export class WorldEvents {
  private activeBoss: WorldBossEvent | undefined;
  private nextAppearance = 0;
  private defeats = 0;

  currentWorldBoss(tick: number): WorldBossEvent | undefined {
    if (!this.activeBoss && tick >= this.nextAppearance) {
      this.activeBoss = {
        id: `drowned-choir:${this.defeats + 1}`,
        bossId: 'the_drowned_choir',
        regionId: 'ashfall_barrows',
        appearedAtTick: tick,
      };
    }
    return this.activeBoss;
  }

  defeat(eventId: string, tick: number): boolean {
    if (this.activeBoss?.id !== eventId) return false;
    this.activeBoss = undefined;
    this.defeats += 1;
    this.nextAppearance = tick + RESPAWN_STEPS;
    return true;
  }

  snapshot(): WorldEventsSnapshot {
    return {
      ...(this.activeBoss ? { activeWorldBoss: this.activeBoss } : {}),
      nextWorldBossAtTick: this.nextAppearance,
      worldBossDefeats: this.defeats,
    };
  }

  restore(snapshot: WorldEventsSnapshot | undefined): void {
    this.activeBoss = snapshot?.activeWorldBoss;
    this.nextAppearance = Math.max(0, snapshot?.nextWorldBossAtTick ?? 0);
    this.defeats = Math.max(0, snapshot?.worldBossDefeats ?? 0);
  }
}
