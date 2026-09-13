/**
 * Notifications (REQ-UX-005): importance-prioritised, and only the important ones interrupt.
 *
 * A passive subscriber, like the Chronicle and the Monument: it turns domain events into
 * short sentences, each carrying a priority from `ui/notifications.json`. The UI shows
 * critical ones as an interrupting banner, counts important ones on a badge, and leaves
 * routine ones in the feed for whoever wants to scroll.
 *
 * It lives in `app/` because a sentence about a hunter needs the roster, a region, a boss
 * and an item — every system at once — and it writes nothing back to any of them.
 */

import type { Session } from './Session.js';
import type { NotificationKind, NotificationPriority } from '../data/notificationSchema.js';
import type { HunterId, ItemId } from '../core/ids.js';

export interface Notification {
  readonly id: number;
  readonly tick: number;
  readonly kind: NotificationKind;
  readonly priority: NotificationPriority;
  readonly text: string;
  read: boolean;
}

export class Notifications {
  private readonly feed: Notification[] = [];
  private nextId = 1;
  private readonly unsubscribes: (() => void)[] = [];
  private readonly listeners = new Set<(n: Notification) => void>();

  constructor(private readonly session: Session) {
    const events = session.events;
    const name = (id: HunterId) => session.roster.get(id)?.name ?? 'A hunter';
    const monster = (id: string) => session.content.monstersById.get(id)?.name ?? id;
    const region = (id: string) => session.content.worldRegionsById.get(id)?.name ?? id;
    const on = this.unsubscribes;

    on.push(events.on('hunter.died', ({ hunterId }) => this.push('hunterDied', `${name(hunterId)} died in the field.`)));
    on.push(events.on('town.defended', ({ threatName, held }) =>
      held
        ? this.push('townDefended', `The walls held against ${threatName}.`)
        : this.push('townBreached', `${threatName} broke through the walls.`)));
    on.push(events.on('worldBoss.appeared', ({ bossId, regionId }) =>
      this.push('worldBossAppeared', `${monster(bossId)} has appeared in ${region(regionId)}.`)));
    on.push(events.on('loot.rareFound', ({ itemId, rarity }) => {
      const item = session.armoury.get(itemId as ItemId)?.name ?? itemId;
      this.push(rarity === 'legendary' ? 'legendaryFound' : 'rareFound', `Found ${item} (${rarity}).`);
    }));
    on.push(events.on('town.stageReached', ({ name: stage }) => this.push('stageReached', `The town is now a ${stage}.`)));
    on.push(events.on('research.completed', ({ name: node }) => this.push('researchCompleted', `Research complete: ${node}.`)));
    // One notification per contract, though the event fires once per party member.
    const contractsSeen = new Set<string>();
    on.push(events.on('contract.completed', ({ contractId, name: contract, succeeded }) => {
      if (contractsSeen.has(contractId)) return;
      contractsSeen.add(contractId);
      this.push('contractResolved', `${succeeded ? 'Completed' : 'Failed'}: ${contract}.`);
    }));
    const bossesSeen = new Set<string>();
    on.push(events.on('combat.bossDefeated', ({ bossId, worldBoss }) => {
      const key = `${bossId}@${session.clock.tick}`;
      if (bossesSeen.has(key)) return;
      bossesSeen.add(key);
      this.push(worldBoss ? 'worldBossDefeated' : 'bossDefeated', `${monster(bossId)} fell.`);
    }));
    on.push(events.on('journey.returned', ({ regionName, wiped }) =>
      this.push('partyReturned', wiped ? `The party was carried home from ${regionName}.` : `The party is home from ${regionName}.`)));
    on.push(events.on('endless.recordSet', ({ regionName, depth }) => this.push('endlessRecord', `New endless record: depth ${depth} in ${regionName}.`)));
    on.push(events.on('zone.firstEntered', ({ hunterId, zoneId, tier }) => {
      if (tier === 'red' || tier === 'black') this.push('frontierEntered', `${name(hunterId)}'s party entered ${region(zoneId)} for the first time.`);
    }));
    on.push(events.on('hunter.leveled', ({ hunterId, level }) => this.push('hunterLeveled', `${name(hunterId)} reached level ${level}.`)));
    on.push(events.on('combat.rescued', ({ hunterId, byHunterId }) => this.push('rescue', `${name(byHunterId)} dragged ${name(hunterId)} clear.`)));
  }

  all(): readonly Notification[] { return [...this.feed].reverse(); }
  unread(priority?: NotificationPriority): readonly Notification[] {
    return this.all().filter((n) => !n.read && (priority === undefined || n.priority === priority));
  }
  /** Unread notifications that should interrupt the player (REQ-UX-005: critical only). */
  interrupting(): readonly Notification[] { return this.unread('critical'); }
  /** The badge: critical and important, never routine. */
  badgeCount(): number { return this.unread().filter((n) => n.priority !== 'routine').length; }

  markRead(id?: number): void {
    for (const n of this.feed) if (id === undefined || n.id === id) n.read = true;
  }

  /** Called when something the player will read in full elsewhere (the Guild Report) covered these. */
  markAllRead(): void { this.markRead(); }

  subscribe(listener: (n: Notification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
  }

  private push(kind: NotificationKind, text: string): void {
    const rules = this.session.content.notifications;
    const notification: Notification = {
      id: this.nextId++,
      tick: this.session.clock.tick,
      kind,
      priority: rules.priorities[kind],
      text,
      read: false,
    };
    this.feed.push(notification);
    if (this.feed.length > rules.feedSize) this.feed.splice(0, this.feed.length - rules.feedSize);
    for (const listener of this.listeners) listener(notification);
  }
}
