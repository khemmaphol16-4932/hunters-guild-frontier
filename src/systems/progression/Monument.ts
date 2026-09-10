import type { DomainEventName, EventBus, EventHandler } from '../../core/events.js';
import type { HunterId } from '../../core/ids.js';

export type MonumentKind =
  | 'worldBossVictory'
  | 'frontierDiscovery'
  | 'legendaryFind'
  | 'historicContract'
  | 'legendaryHunter'
  | 'townMilestone'
  | 'researchBreakthrough';

export interface MonumentEntry {
  readonly id: string;
  readonly kind: MonumentKind;
  readonly tick: number;
  readonly title: string;
  readonly detail: string;
  readonly hunterId?: HunterId;
}

export interface MonumentSnapshot {
  readonly entries: readonly MonumentEntry[];
}

export interface MonumentDeps {
  readonly events: EventBus;
  readonly currentTick: () => number;
}

/**
 * The guild's permanent record of historic achievements (REQ-MON-001).
 *
 * Stable ids make every plaque idempotent: a boss or contract event emitted once per party
 * member still creates one guild achievement. The Monument is a passive event subscriber;
 * recording history can never change the systems that produced it.
 */
export class Monument {
  private readonly entriesById = new Map<string, MonumentEntry>();
  private readonly unsubscribes: (() => void)[] = [];

  constructor(private readonly deps: MonumentDeps) {
    this.subscribe();
  }

  all(): readonly MonumentEntry[] {
    return [...this.entriesById.values()].sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));
  }

  has(id: string): boolean {
    return this.entriesById.has(id);
  }

  snapshot(): MonumentSnapshot {
    return { entries: this.all() };
  }

  restore(snapshot: MonumentSnapshot | undefined): void {
    this.entriesById.clear();
    for (const entry of snapshot?.entries ?? []) this.entriesById.set(entry.id, entry);
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
  }

  private add(entry: Omit<MonumentEntry, 'tick'>): void {
    if (this.entriesById.has(entry.id)) return;
    this.entriesById.set(entry.id, { ...entry, tick: this.deps.currentTick() });
  }

  private subscribe(): void {
    const on: <K extends DomainEventName>(name: K, handler: EventHandler<K>) => void =
      (name, handler) => this.unsubscribes.push(this.deps.events.on(name, handler));

    on('combat.bossDefeated', ({ hunterId, bossId, worldBoss }) => {
      if (!worldBoss) return;
      this.add({ id: `world-boss:${bossId}`, kind: 'worldBossVictory', hunterId, title: 'World Boss Defeated', detail: `The guild defeated ${bossId}.` });
    });
    on('zone.firstEntered', ({ hunterId, zoneId, tier }) => {
      if (tier !== 'red' && tier !== 'black') return;
      this.add({ id: `frontier:${zoneId}`, kind: 'frontierDiscovery', hunterId, title: `First ${tier.toUpperCase()} Frontier`, detail: `The guild first entered ${zoneId}.` });
    });
    on('loot.rareFound', ({ hunterId, itemId, rarity }) => {
      if (rarity !== 'legendary') return;
      this.add({ id: `legendary-item:${itemId}`, kind: 'legendaryFind', hunterId, title: 'Legendary Discovery', detail: `${itemId} entered the guild armoury.` });
    });
    on('contract.completed', ({ hunterId, contractId, name, succeeded }) => {
      if (!succeeded) return;
      this.add({ id: `contract:${contractId}`, kind: 'historicContract', hunterId, title: 'Historic Contract', detail: `The guild completed ${name}.` });
    });
    on('hunter.leveled', ({ hunterId, level }) => {
      if (level < 50) return;
      this.add({ id: `legendary-hunter:${hunterId}`, kind: 'legendaryHunter', hunterId, title: 'Legendary Hunter', detail: `${hunterId} reached level ${level}.` });
    });
    on('town.stageReached', ({ stageId, name }) => {
      this.add({ id: `town-stage:${stageId}`, kind: 'townMilestone', title: name, detail: `The guild's home became ${name}.` });
    });
    on('research.completed', ({ nodeId, name }) => {
      this.add({ id: `research:${nodeId}`, kind: 'researchBreakthrough', title: name, detail: `The guild completed ${name}.` });
    });
  }
}
