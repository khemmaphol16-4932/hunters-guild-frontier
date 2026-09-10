/**
 * The Hunter Chronicle.
 *
 * REQ-CHR-001..005 and DL-006. This is a core identity system, not flavour text (§19) —
 * but it is also strictly *passive*. It subscribes to the event bus and has no outbound
 * dependencies at all, which is how REQ-CHR-003 is enforced structurally rather than by
 * convention: recording "died in the Red Zone" cannot change a derived stat or an AI weight,
 * because Chronicle has no way to reach either. Only Behavior Memory, Mastery, Traits and
 * Legacy Traits convert history into mechanics, and each of those is a separate subscriber
 * with its own explicit, small list of events it acts on.
 *
 * Storage shape (DL-006): permanent unbounded counters — exactly the ones §19 displays —
 * plus a bounded, significance-ranked ring of notable entries. A guild played for months
 * should not accumulate an unbounded event log per hunter.
 */

import type { ChronicleBalance } from '../../data/schema.js';
import type { EventBus, DomainEventName, EventHandler } from '../../core/events.js';
import type { HunterId } from '../../core/ids.js';

/**
 * v1.0 §11 fixes three named levels. The numeric significance is retained *internally*
 * because ring retention needs a total ordering to decide what a full ring displaces —
 * but the level is what surfaces, and it is what "only remarkable events enter" means.
 */
export const CHRONICLE_LEVELS = ['minor', 'major', 'historic'] as const;
export type ChronicleLevel = (typeof CHRONICLE_LEVELS)[number];

/** Significance 1–5 → the three named levels. */
export function chronicleLevel(significance: number): ChronicleLevel {
  if (significance >= 5) return 'historic';
  if (significance >= 3) return 'major';
  return 'minor';
}

export interface ChronicleEntry {
  readonly kind: string;
  readonly significance: number;
  /** v1.0 §11's named level, derived from significance. */
  readonly level: ChronicleLevel;
  /** Simulation tick, so entries order correctly regardless of wall-clock time (DL-003). */
  readonly tick: number;
  readonly text: string;
}

export interface HunterChronicle {
  readonly hunterId: HunterId;
  readonly counters: Readonly<Record<string, number>>;
  readonly notable: readonly ChronicleEntry[];
  readonly favouriteSkill: string | undefined;
}

interface MutableChronicle {
  hunterId: HunterId;
  counters: Record<string, number>;
  notable: ChronicleEntry[];
  favouriteSkill: string | undefined;
}

export interface ChronicleDeps {
  readonly balance: ChronicleBalance;
  readonly events: EventBus;
  /** Supplies the current simulation tick. Never reads wall-clock time (DL-003). */
  readonly currentTick: () => number;
}

export class Chronicle {
  private readonly balance: ChronicleBalance;
  private readonly currentTick: () => number;
  private readonly records = new Map<HunterId, MutableChronicle>();
  private readonly unsubscribes: (() => void)[] = [];
  /** Tracks best-known mastery per hunter so "favourite skill" stays accurate. */
  private readonly masteryPeak = new Map<HunterId, { skillId: string; points: number }>();

  constructor(deps: ChronicleDeps) {
    this.balance = deps.balance;
    this.currentTick = deps.currentTick;
    this.subscribe(deps.events);
  }

  /** Detach every subscription. Used when tearing down a game session or a test. */
  dispose(): void {
    for (const off of this.unsubscribes) off();
    this.unsubscribes.length = 0;
  }

  of(hunterId: HunterId): HunterChronicle {
    return this.ensure(hunterId);
  }

  /** All chronicles, for save serialisation. */
  all(): readonly HunterChronicle[] {
    return [...this.records.values()];
  }

  counter(hunterId: HunterId, name: string): number {
    return this.records.get(hunterId)?.counters[name] ?? 0;
  }

  /**
   * Entries at or above a named level.
   *
   * v1.0 §11 gives historic events consequences — they *"can affect hunter legacy and guild
   * monuments"* — so those systems need to select by level rather than re-deriving a
   * threshold each time and risking disagreement about what counts as historic.
   */
  entriesAtLevel(hunterId: HunterId, level: ChronicleLevel): readonly ChronicleEntry[] {
    const minimum = CHRONICLE_LEVELS.indexOf(level);
    return (this.records.get(hunterId)?.notable ?? []).filter(
      (entry) => CHRONICLE_LEVELS.indexOf(entry.level) >= minimum,
    );
  }

  /** Every historic entry across the guild — the raw material for monuments (§11). */
  historicEntries(): readonly { hunterId: HunterId; entry: ChronicleEntry }[] {
    const out: { hunterId: HunterId; entry: ChronicleEntry }[] = [];
    for (const record of this.records.values()) {
      for (const entry of record.notable) {
        if (entry.level === 'historic') out.push({ hunterId: record.hunterId, entry });
      }
    }
    return out;
  }

  /** Restore from a save. Replaces any in-memory record for those hunters. */
  restore(records: readonly HunterChronicle[]): void {
    for (const record of records) {
      this.records.set(record.hunterId, {
        hunterId: record.hunterId,
        counters: { ...record.counters },
        notable: [...record.notable],
        favouriteSkill: record.favouriteSkill,
      });
    }
  }

  // --- Subscriptions --------------------------------------------------------

  private subscribe(events: EventBus): void {
    const on: <K extends DomainEventName>(
      name: K,
      handler: EventHandler<K>,
    ) => void = (name, handler) => {
      this.unsubscribes.push(events.on(name, handler));
    };

    on('hunter.created', ({ hunterId }) => {
      this.ensure(hunterId);
    });

    on('hunter.leveled', ({ hunterId, level }) => {
      if (level % 10 === 0) {
        this.record(hunterId, 'levelMilestone', `Reached level ${level}.`);
      }
    });

    on('constellation.nodeTaken', ({ hunterId, nodeId, regionId }) => {
      this.record(hunterId, 'constellationNode', `Learned ${nodeId}, deepening into ${regionId}.`);
    });

    on('zone.firstEntered', ({ hunterId, zoneId, tier }) => {
      this.increment(hunterId, 'zonesFirstEntered', 1);
      const kind =
        tier === 'black' ? 'firstBlackZone' : tier === 'red' ? 'firstRedZone' : 'firstZoneEntry';
      this.record(hunterId, kind, `First entered ${zoneId}.`);
    });

    on('combat.nearDeath', ({ hunterId }) => {
      this.increment(hunterId, 'nearDeaths', 1);
      this.record(hunterId, 'nearDeath', 'Came within moments of death.');
    });

    on('combat.rescued', ({ hunterId, byHunterId }) => {
      this.increment(hunterId, 'timesRescued', 1);
      this.record(hunterId, 'rescued', `Was dragged clear by ${byHunterId}.`);
    });

    on('combat.rescuePerformed', ({ hunterId, targetId }) => {
      this.increment(hunterId, 'rescuesPerformed', 1);
      this.record(hunterId, 'rescuePerformed', `Pulled ${targetId} out of a losing fight.`);
    });

    on('combat.bossDefeated', ({ hunterId, bossId, worldBoss }) => {
      this.increment(hunterId, 'bossesDefeated', 1);
      this.record(
        hunterId,
        worldBoss ? 'worldBossDefeated' : 'bossDefeated',
        `Took part in the defeat of ${bossId}.`,
      );
    });

    on('combat.companionLost', ({ hunterId, lostHunterId }) => {
      this.increment(hunterId, 'companionsLost', 1);
      this.record(hunterId, 'companionLost', `Lost ${lostHunterId} in the field.`);
    });

    on('loot.rareFound', ({ hunterId, itemId, rarity }) => {
      this.increment(hunterId, 'rareItemsFound', 1);
      const kind = rarity === 'legendary' ? 'legendaryEquipment' : 'rareDiscovery';
      this.record(hunterId, kind, `Recovered ${itemId}.`);
    });

    on('expedition.completed', ({ hunterId, expeditionId, durationSeconds }) => {
      this.increment(hunterId, 'expeditions', 1);
      const record = this.ensure(hunterId);
      if (durationSeconds > (record.counters['longestExpeditionSeconds'] ?? 0)) {
        record.counters['longestExpeditionSeconds'] = durationSeconds;
        this.record(
          hunterId,
          'rareDiscovery',
          `Longest expedition yet: ${expeditionId}, ${Math.round(durationSeconds)}s.`,
        );
      }
    });
    on('contract.completed', ({ hunterId, name, succeeded }) => {
      this.increment(hunterId, succeeded ? 'contractsCompleted' : 'contractsFailed', 1);
      this.record(hunterId, succeeded ? 'contractCompleted' : 'contractFailed', `${succeeded ? 'Completed' : 'Failed'} ${name}.`);
    });

    on('mastery.milestone', ({ hunterId, skillId, milestone }) => {
      this.record(hunterId, 'masteryMilestone', `Reached ${milestone} mastery in ${skillId}.`);
    });

    on('mastery.gained', ({ hunterId, skillId, total }) => {
      const peak = this.masteryPeak.get(hunterId);
      if (!peak || total > peak.points) {
        this.masteryPeak.set(hunterId, { skillId, points: total });
        this.ensure(hunterId).favouriteSkill = skillId;
      }
    });
  }

  // --- Internals ------------------------------------------------------------

  private ensure(hunterId: HunterId): MutableChronicle {
    let record = this.records.get(hunterId);
    if (!record) {
      const counters: Record<string, number> = {};
      for (const name of this.balance.counters) counters[name] = 0;
      record = { hunterId, counters, notable: [], favouriteSkill: undefined };
      this.records.set(hunterId, record);
    }
    return record;
  }

  private increment(hunterId: HunterId, counter: string, amount: number): void {
    const record = this.ensure(hunterId);
    record.counters[counter] = (record.counters[counter] ?? 0) + amount;
  }

  /**
   * Add a notable entry, keeping the ring bounded.
   * When full, the least significant entry is displaced — a hunter's first Black Zone
   * survives, a routine level milestone does not.
   */
  private record(hunterId: HunterId, kind: string, text: string): void {
    const significance = this.balance.significance[kind] ?? 1;
    if (significance < this.balance.notableRing.minSignificance) return;

    const record = this.ensure(hunterId);
    const entry: ChronicleEntry = {
      kind,
      significance,
      level: chronicleLevel(significance),
      tick: this.currentTick(),
      text,
    };

    record.notable.push(entry);
    if (record.notable.length <= this.balance.notableRing.capacity) return;

    let weakestIndex = 0;
    for (let i = 1; i < record.notable.length; i++) {
      const candidate = record.notable[i];
      const weakest = record.notable[weakestIndex];
      if (!candidate || !weakest) continue;
      // Ties break toward displacing the older entry.
      if (
        candidate.significance < weakest.significance ||
        (candidate.significance === weakest.significance && candidate.tick < weakest.tick)
      ) {
        weakestIndex = i;
      }
    }
    record.notable.splice(weakestIndex, 1);
  }
}
