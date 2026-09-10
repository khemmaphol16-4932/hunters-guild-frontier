export const GUILD_ACTIVITIES = [
  'expedition',
  'crafting',
  'recruitment',
  'defense',
  'research',
  'contract',
] as const;

export type GuildActivity = typeof GUILD_ACTIVITIES[number];

export interface GuildMasterySnapshot {
  readonly points: number;
  readonly byActivity: Readonly<Record<string, number>>;
}

export class GuildMastery {
  private total = 0;
  private readonly activity = new Map<GuildActivity, number>();

  record(kind: GuildActivity, points: number): number {
    const gain = Math.max(0, points);
    this.total += gain;
    this.activity.set(kind, (this.activity.get(kind) ?? 0) + gain);
    return this.total;
  }

  get points(): number { return this.total; }
  pointsFrom(kind: GuildActivity): number { return this.activity.get(kind) ?? 0; }
  level(): number { return Math.floor(Math.sqrt(this.total / 25)) + 1; }

  snapshot(): GuildMasterySnapshot {
    return {
      points: this.total,
      byActivity: Object.fromEntries(GUILD_ACTIVITIES.map((kind) => [kind, this.pointsFrom(kind)])),
    };
  }

  restore(snapshot: GuildMasterySnapshot | undefined): void {
    this.total = Math.max(0, snapshot?.points ?? 0);
    this.activity.clear();
    for (const kind of GUILD_ACTIVITIES) {
      this.activity.set(kind, Math.max(0, snapshot?.byActivity[kind] ?? 0));
    }
  }
}
