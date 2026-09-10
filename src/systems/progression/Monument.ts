import type { DomainEventName, EventBus, EventHandler } from '../../core/events.js';
import type { HunterId } from '../../core/ids.js';
import type { MonumentKind } from '../../data/progressionSchema.js';

export type { MonumentKind } from '../../data/progressionSchema.js';

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
  /** The level at which a hunter's name goes on the Monument (balance/progression.json). */
  readonly legendaryHunterLevel: number;
}

/**
 * The guild's permanent record of historic achievements (REQ-MON-001).
 *
 * Stable ids make every plaque idempotent: a boss or contract event emitted once per party
 * member still creates one guild achievement. The Monument is a passive event subscriber;
 * recording history can never change the systems that produced it.
 *
 * A contract is historic the first time the guild completes *that contract*, keyed by its
 * template rather than by the individual offer. Keying by offer made every routine job a
 * plaque, and each plaque was worth Legacy points — so the contract board minted unlimited
 * Legacy (DL-047). Legacy now also caps awards per kind per cycle; either fix alone would
 * have stopped the farm, and both are needed for the Monument to mean "historic".
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

  /**
   * Carve something that did not arrive as a domain event — the founders' facade a new cycle
   * opens with. Idempotent like every other plaque.
   */
  inscribe(entry: Omit<MonumentEntry, 'tick'>): void {
    this.add(entry);
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
    on('contract.completed', ({ hunterId, templateId, name, succeeded }) => {
      if (!succeeded) return;
      this.add({ id: `contract:${templateId}`, kind: 'historicContract', hunterId, title: 'Historic Contract', detail: `The guild first completed ${name}.` });
    });
    on('hunter.leveled', ({ hunterId, level }) => {
      if (level < this.deps.legendaryHunterLevel) return;
      this.add({ id: `legendary-hunter:${hunterId}`, kind: 'legendaryHunter', hunterId, title: 'Legendary Hunter', detail: `${hunterId} reached level ${level}.` });
    });
    on('town.stageReached', ({ stageId, name }) => {
      this.add({ id: `town-stage:${stageId}`, kind: 'townMilestone', title: name, detail: `The guild's home became ${name}.` });
    });
    on('endless.recordSet', ({ regionId, regionName, objectiveName, depth, milestone }) => {
      // REQ-MON-001's "exceptional expeditions". Only milestone depths are carved; a record
      // broken by one depth at a time would otherwise fill the Monument with near-duplicates.
      if (!milestone) return;
      this.add({ id: `endless:${regionId}:${depth}`, kind: 'endlessRecord', title: `Depth ${depth} of ${regionName}`, detail: `The guild's deepest ${objectiveName.toLowerCase()} run reached depth ${depth}.` });
    });
    on('research.completed', ({ nodeId, name }) => {
      this.add({ id: `research:${nodeId}`, kind: 'researchBreakthrough', title: name, detail: `The guild completed ${name}.` });
    });
  }
}
