/**
 * A combatant — a hunter or a monster, inside one encounter.
 *
 * Deliberately mutable, unlike the Hunter aggregate. A hunter record is immutable because it
 * is saved, replayed and compared; a combatant is scratch state that lives for the length of
 * one fight and is stepped tens of times a second. Copying it per tick would be pure waste,
 * and nothing outside the encounter holds a reference.
 *
 * The link back is `hunterId`: what happens here is written back to the durable Hunter
 * record once, at the end, by the encounter's caller.
 */

import type { RangeBand } from '../../data/schema.js';
import type { HunterId } from '../ids.js';
import type { BuildProfile } from '../hunter/buildProfile.js';

export type Side = 'guild' | 'monster';

export interface ActiveStatus {
  readonly statusId: string;
  stacks: number;
  remainingSeconds: number;
  nextTickIn: number;
  /** Attack value of whoever applied it, so damage-over-time scales with its source. */
  readonly sourceAttack: number;
  readonly sourceId: string;
}

export interface Combatant {
  readonly id: string;
  readonly name: string;
  readonly side: Side;

  /** Set for guild combatants; undefined for monsters. */
  readonly hunterId: HunterId | undefined;
  /** Set for monsters; undefined for hunters. */
  readonly monsterId: string | undefined;

  /** Derived stats, already including equipment and condition. */
  readonly stats: Readonly<Record<string, number>>;
  /** Build profile — the *only* thing the hunter AI reads about identity (REQ-BLD-003). */
  readonly profile: BuildProfile | undefined;
  /** Active skill loadout. Empty for monsters, which use their own skill list. */
  readonly loadout: readonly string[];

  health: number;
  readonly maxHealth: number;
  resource: number;
  readonly maxResource: number;

  /**
   * Position on a single distance axis. Guild side starts at 0, monsters at the region's
   * starting separation; both close toward each other. See DL-025 for why one axis.
   */
  position: number;
  readonly preferredRange: RangeBand;

  /** Skill id -> seconds until usable. */
  readonly cooldowns: Map<string, number>;
  /** Seconds until the next AI re-evaluation. */
  aiCooldown: number;
  /** Seconds until the basic attack is ready (monsters). */
  attackCooldown: number;

  readonly statuses: ActiveStatus[];
  /** Hard-CC applications, for diminishing returns (REQ-CBT-009). */
  readonly ccHistory: Map<string, { applications: number; windowEndsAt: number }>;

  /** Threat this combatant has generated, per enemy id (REQ-AI-003). */
  readonly threat: Map<string, number>;
  /** Locked target. Changes only on death or invalidation (REQ-AI-006, DL-004). */
  targetId: string | undefined;

  /** REQ-CBT-012: downed hunters cannot act and die when the timer expires. */
  downed: boolean;
  downedRemaining: number;
  dead: boolean;

  /** Seconds spent rescuing, and who. */
  rescuingId: string | undefined;
  rescueProgress: number;

  /** Monster wind-up: skill id and seconds remaining before it lands (REQ-BOS-001). */
  telegraph: { skillId: string; remaining: number } | undefined;
  /** Phase index for bosses. */
  phase: number;

  /** Time since this combatant last took damage — feeds the `wasAttackedWithin` condition. */
  secondsSinceAttacked: number;
}

export function isActive(c: Combatant): boolean {
  return !c.dead && !c.downed;
}

export function healthFraction(c: Combatant): number {
  return c.maxHealth > 0 ? c.health / c.maxHealth : 0;
}

export function resourceFraction(c: Combatant): number {
  return c.maxResource > 0 ? c.resource / c.maxResource : 0;
}

export function distanceBetween(a: Combatant, b: Combatant): number {
  return Math.abs(a.position - b.position);
}

export function stat(c: Combatant, name: string, fallback = 0): number {
  return c.stats[name] ?? fallback;
}

/** Total threat a combatant has generated against one enemy. */
export function threatAgainst(c: Combatant, enemyId: string): number {
  return c.threat.get(enemyId) ?? 0;
}

export function addThreat(c: Combatant, enemyId: string, amount: number): void {
  c.threat.set(enemyId, (c.threat.get(enemyId) ?? 0) + amount);
}

/** Movement speed after slow statuses. */
export function speedMultiplier(
  c: Combatant,
  statusMagnitude: (statusId: string) => number,
): number {
  let multiplier = 1;
  for (const status of c.statuses) {
    const magnitude = statusMagnitude(status.statusId);
    if (magnitude > 0) multiplier *= 1 - magnitude;
  }
  return Math.max(0.1, multiplier);
}

/** Whether a hard-CC status currently prevents action. */
export function isControlled(c: Combatant, isControlStatus: (statusId: string) => boolean): boolean {
  return c.statuses.some((s) => isControlStatus(s.statusId));
}
