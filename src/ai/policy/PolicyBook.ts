/**
 * The player's standing orders.
 *
 * §29 lets the player forbid actions outright — no retreat from this contract, never enter a
 * Black Zone, don't use that skill. Those are hard constraints, and this is where the ones
 * currently in force live so that the expedition and the combat AI read the *same* set the
 * player authored rather than an empty placeholder.
 *
 * Deliberately mutable and deliberately small. It is a list, not a rules engine: the
 * pipeline already guarantees that anything in here vetoes absolutely (REQ-POL-004), so the
 * only thing this type has to get right is *which* constraints are active.
 *
 * Empty by default. A guild with no policy behaves exactly as it did before policy existed,
 * which is what makes hard constraints the player's instrument rather than the game's.
 */

import type { CombatAction, CombatView } from '../hunter/hunterAI.js';
import type { HardConstraint } from './pipeline.js';

export type CombatConstraint = HardConstraint<CombatAction, CombatView>;

export class PolicyBook {
  private readonly constraints = new Map<string, CombatConstraint>();

  /** Put a standing order in force. Re-adding the same id replaces it. */
  add(constraint: CombatConstraint): void {
    this.constraints.set(constraint.id, constraint);
  }

  remove(id: string): boolean {
    return this.constraints.delete(id);
  }

  clear(): void {
    this.constraints.clear();
  }

  has(id: string): boolean {
    return this.constraints.has(id);
  }

  all(): readonly CombatConstraint[] {
    return [...this.constraints.values()];
  }

  /** What the player has forbidden, in their own words — for the UI and the audit log. */
  describe(): readonly string[] {
    return this.all().map((c) => c.describe);
  }

  get size(): number {
    return this.constraints.size;
  }
}
