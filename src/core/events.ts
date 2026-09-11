/**
 * Typed domain event bus.
 *
 * This is the mechanism that keeps the dependency graph acyclic (see DEPENDENCY_GRAPH.md).
 * Chronicle, Behavior Memory, Guild Mastery, Notifications and the Decision Log all need to
 * know when things happen, but none of them may be *called* by gameplay code — that would
 * make them universal dependencies, exactly what §126 forbids. They subscribe instead.
 *
 * It is also how REQ-CHR-003 is enforced structurally: Chronicle is a pure subscriber with
 * no outbound edges, so recording history cannot feed back into combat. Behavior Memory is
 * a *separate* subscriber with an explicit, small list of events it converts into
 * mechanical effect.
 *
 * Adding an event type touches this file and every exhaustive subscriber — that friction is
 * intentional and is listed as an integration point in the dependency graph.
 */

import type { HunterId, SkillId, ItemId } from './ids.js';

export interface DomainEventMap {
  'hunter.created': { hunterId: HunterId; name: string };
  'hunter.leveled': { hunterId: HunterId; level: number };
  'constellation.nodeTaken': { hunterId: HunterId; nodeId: string; regionId: string };
  'hunter.respec': { hunterId: HunterId };
  'hunter.died': { hunterId: HunterId; zoneTier: string };

  'skill.learned': { hunterId: HunterId; skillId: SkillId; source: 'book' | 'node' | 'debug' };
  'loadout.changed': { hunterId: HunterId; skills: readonly SkillId[] };

  'mastery.gained': { hunterId: HunterId; skillId: SkillId; points: number; total: number };
  'mastery.milestone': { hunterId: HunterId; skillId: SkillId; milestone: number };

  'condition.changed': {
    hunterId: HunterId;
    hunger: number;
    fatigue: number;
    morale: number;
  };

  'zone.firstEntered': { hunterId: HunterId; zoneId: string; tier: string };
  'combat.nearDeath': { hunterId: HunterId };
  'combat.rescued': { hunterId: HunterId; byHunterId: HunterId };
  'combat.rescuePerformed': { hunterId: HunterId; targetId: HunterId };
  'combat.bossDefeated': { hunterId: HunterId; bossId: string; worldBoss: boolean };
  'combat.companionLost': { hunterId: HunterId; lostHunterId: HunterId };

  'loot.rareFound': { hunterId: HunterId; itemId: ItemId; rarity: string };
  /** `regionName` is for anything that writes a sentence about the trip; `expeditionId` is an id. */
  'expedition.completed': { hunterId: HunterId; expeditionId: string; durationSeconds: number; regionName?: string };
  /** `contractId` is the individual offer; `templateId` is which contract it was (DL-047). */
  'contract.completed': { hunterId: HunterId; contractId: string; templateId: string; name: string; succeeded: boolean };

  /**
   * The town grew into a new stage (REQ-TWN-002).
   *
   * Guild-scoped rather than hunter-scoped, which makes it the first event here without a
   * `hunterId`. The Chronicle is per-hunter and deliberately ignores it — a town becoming a
   * Fortified Town is the *guild's* history, and §19's "the town is a physical Chronicle"
   * means the town records it by looking like one, not by writing into anyone's record.
   */
  'town.stageReached': { stageId: string; name: string };
  'town.buildingPlaced': { buildingId: string; instanceId: string; x: number; y: number };
  'town.populationChanged': { population: number; delta: number };
  /** Guild technology, not hunter experience — REQ-RES-002 keeps the two ledgers apart. */
  'research.completed': { nodeId: string; name: string };
  /**
   * A new personal best in an endless expedition (REQ-END-003). `milestone` is true when the
   * depth crosses an authored milestone — the Monument carves those, not every record.
   */
  /** A threat reached the walls and was fought (REQ-TWN-008). Guild-scoped, like town events. */
  'town.defended': { threatName: string; held: boolean };
  /** The world boss has appeared somewhere in the world (REQ-BOS-003). */
  'worldBoss.appeared': { bossId: string; regionId: string };
  'endless.recordSet': { regionId: string; regionName: string; objectiveName: string; depth: number; milestone: boolean };
}

export type DomainEventName = keyof DomainEventMap;

export type EventHandler<K extends DomainEventName> = (payload: DomainEventMap[K]) => void;

export interface Unsubscribe {
  (): void;
}

export class EventBus {
  private handlers = new Map<DomainEventName, Set<(payload: unknown) => void>>();
  /** Guards against a handler emitting an event that re-enters itself indefinitely. */
  private depth = 0;
  private readonly maxDepth = 16;

  on<K extends DomainEventName>(event: K, handler: EventHandler<K>): Unsubscribe {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    const erased = handler as (payload: unknown) => void;
    set.add(erased);
    return () => {
      set?.delete(erased);
    };
  }

  emit<K extends DomainEventName>(event: K, payload: DomainEventMap[K]): void {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;

    if (this.depth >= this.maxDepth) {
      throw new Error(`EventBus: re-entrancy depth exceeded while emitting "${event}"`);
    }

    this.depth += 1;
    try {
      // Copy so a handler that unsubscribes during dispatch cannot corrupt iteration.
      for (const handler of [...set]) {
        handler(payload);
      }
    } finally {
      this.depth -= 1;
    }
  }

  /** Test and debug affordance — never used by gameplay code. */
  handlerCount(event: DomainEventName): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}
