/**
 * How hard a hunter hits right now, beyond their stats — the combat half of their traits and
 * friendships.
 *
 * Three sources, all additive on a multiplier of 1:
 *   - **Battle-Born** (`sustainedCombatBonus`) grows over the fight and is at full strength
 *     after `sustainedFullSeconds`. "Grows more dangerous the longer a fight lasts."
 *   - **Inspiring allies** (`partySupportBonus`): every standing ally who carries it lifts
 *     everyone beside them. "Makes the hunters around them better."
 *   - **A friend in the fight** (REQ-HUN-012): one bonus, however many friends are there —
 *     friendship is a reason to fight harder, not a stat to stack.
 *
 * Lives in `systems/` so the encounter can ask without knowing traits or friendship exist.
 */

import type { Combatant } from '../../core/combat/Combatant.js';
import type { Hunter } from '../../core/hunter/Hunter.js';
import type { HunterId } from '../../core/ids.js';
import type { TraitDef } from '../../data/schema.js';
import type { FriendshipBalance } from '../../data/friendshipSchema.js';
import { traitSum } from '../hunter/traitEffects.js';

export interface OutgoingDeps {
  readonly traitsById: ReadonlyMap<string, TraitDef>;
  readonly hunterOf: (id: HunterId) => Hunter | undefined;
  readonly areFriends: (a: HunterId, b: HunterId) => boolean;
  readonly balance: FriendshipBalance;
}

export function outgoingMultiplier(
  actor: Combatant,
  allies: readonly Combatant[],
  elapsedSeconds: number,
  deps: OutgoingDeps,
): number {
  const self = actor.hunterId ? deps.hunterOf(actor.hunterId) : undefined;
  if (!self) return 1;

  let multiplier = 1;
  const ramp = Math.min(1, Math.max(0, elapsedSeconds) / deps.balance.sustainedFullSeconds);
  multiplier += traitSum(self, deps.traitsById, 'sustainedCombatBonus') * ramp;

  let friendPresent = false;
  for (const ally of allies) {
    if (!ally.hunterId) continue;
    const hunter = deps.hunterOf(ally.hunterId);
    if (hunter) multiplier += traitSum(hunter, deps.traitsById, 'partySupportBonus');
    if (!friendPresent && deps.areFriends(self.id, ally.hunterId)) friendPresent = true;
  }
  if (friendPresent) multiplier += deps.balance.friendCombatBonus;

  return multiplier;
}
