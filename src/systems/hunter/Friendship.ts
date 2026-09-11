/**
 * Friendship — the one relationship hunters have (REQ-HUN-012: "modelled as Friendship
 * only. No full life simulation").
 *
 * A bond between two hunters, 0..1, that grows from what they live through together: an
 * expedition they both came home from, and — much more — one dragging the other out of a
 * losing fight. Loyal hunters bond faster (friendshipGainMultiplier). Past a threshold the
 * two are friends, and friends fight harder side by side.
 *
 * Deliberately small: no decay, no rivalry, no gossip. A bond ends only when one of them
 * leaves the guild, dies or retires, because a friendship with someone who is not there
 * would be a number with nothing to act on.
 */

import type { HunterId } from '../../core/ids.js';
import type { EventBus } from '../../core/events.js';
import type { FriendshipBalance } from '../../data/friendshipSchema.js';

export interface FriendshipSnapshot { readonly bonds: Readonly<Record<string, number>> }

export interface Bond { readonly with: HunterId; readonly strength: number; readonly friends: boolean }

export interface FriendshipDeps {
  readonly balance: FriendshipBalance;
  readonly events: EventBus;
  /** A hunter's own bonding rate (Loyal: 1.5). */
  readonly gainMultiplier: (hunterId: HunterId) => number;
}

export class Friendship {
  private readonly bonds = new Map<string, number>();
  private readonly unsubscribes: (() => void)[] = [];

  constructor(private readonly deps: FriendshipDeps) {
    this.unsubscribes.push(
      deps.events.on('combat.rescued', ({ hunterId, byHunterId }) => {
        this.grow(hunterId, byHunterId, deps.balance.rescue);
      }),
    );
  }

  strength(a: HunterId, b: HunterId): number {
    return a === b ? 0 : this.bonds.get(key(a, b)) ?? 0;
  }

  areFriends(a: HunterId, b: HunterId): boolean {
    return this.strength(a, b) >= this.deps.balance.friendThreshold;
  }

  /** Everyone this hunter has any bond with, strongest first. */
  bondsOf(hunterId: HunterId): readonly Bond[] {
    const out: Bond[] = [];
    for (const [pair, strength] of this.bonds) {
      const [a, b] = pair.split('|') as [HunterId, HunterId];
      if (a !== hunterId && b !== hunterId) continue;
      out.push({ with: a === hunterId ? b : a, strength, friends: strength >= this.deps.balance.friendThreshold });
    }
    return out.sort((x, y) => y.strength - x.strength);
  }

  /** Everyone in `ids` came home from the same expedition. */
  recordShared(ids: readonly HunterId[]): void {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) this.grow(ids[i]!, ids[j]!, this.deps.balance.sharedExpedition);
    }
  }

  /** A hunter is gone from the guild — dead, retired or dismissed. */
  forget(hunterId: HunterId): void {
    for (const pair of [...this.bonds.keys()]) {
      const [a, b] = pair.split('|');
      if (a === hunterId || b === hunterId) this.bonds.delete(pair);
    }
  }

  snapshot(): FriendshipSnapshot { return { bonds: Object.fromEntries(this.bonds) }; }

  restore(snapshot: FriendshipSnapshot | undefined): void {
    this.bonds.clear();
    for (const [pair, strength] of Object.entries(snapshot?.bonds ?? {})) {
      if (typeof strength === 'number' && strength > 0) this.bonds.set(pair, Math.min(1, strength));
    }
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
  }

  private grow(a: HunterId, b: HunterId, base: number): void {
    if (a === b) return;
    const rate = (this.deps.gainMultiplier(a) + this.deps.gainMultiplier(b)) / 2;
    const k = key(a, b);
    this.bonds.set(k, Math.min(1, (this.bonds.get(k) ?? 0) + base * rate));
  }
}

function key(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
