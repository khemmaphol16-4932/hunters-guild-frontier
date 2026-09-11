/**
 * The bridge between the durable Hunter record and the scratch Combatant.
 *
 * This is the only place a hunter's stats, build profile and loadout are collapsed into the
 * flat shape combat consumes. Keeping it in one function means a fight can never disagree
 * with the build dashboard about what a hunter is — they read the same derivation.
 */

import type { AttributeBalance } from '../../data/schema.js';
import type { CombatBalance, MonsterDef } from '../../data/combatSchema.js';
import type { Hunter } from '../../core/hunter/Hunter.js';
import { computeDerivedStats } from '../../core/hunter/attributes.js';
import type { Combatant } from '../../core/combat/Combatant.js';
import type { BuildProfile } from '../hunter/BuildIdentity.js';

export interface HunterCombatantDeps {
  readonly attributeBalance: AttributeBalance;
  readonly combatBalance: CombatBalance;
  readonly profileOf: (hunter: Hunter) => BuildProfile;
  readonly conditionMultiplier: (hunter: Hunter) => number;
  readonly equipmentStats: (hunter: Hunter) => Readonly<Record<string, number>>;
  /**
   * Trait multipliers on individual derived stats (Sure Hands: accuracy). Applied last, so a
   * trait scales the hunter as equipped and as tired as they actually are.
   */
  readonly traitStatScale?: (hunter: Hunter) => Readonly<Record<string, number>>;
}

export function hunterCombatant(hunter: Hunter, deps: HunterCombatantDeps): Combatant {
  const profile = deps.profileOf(hunter);
  const derived = computeDerivedStats(hunter.attributes, hunter.level, deps.attributeBalance, {
    globalMultiplier: deps.conditionMultiplier(hunter),
    flat: deps.equipmentStats(hunter),
  });
  const scale = deps.traitStatScale?.(hunter) ?? {};
  const stats: Record<string, number> = { ...derived };
  for (const [stat, multiplier] of Object.entries(scale)) {
    const value = stats[stat];
    if (value !== undefined) stats[stat] = value * multiplier;
  }

  const maxHealth = Math.max(1, Math.round(stats['maxHp'] ?? 100));
  const maxResource = Math.max(1, Math.round(stats['maxResource'] ?? 50));

  return {
    id: hunter.id,
    name: hunter.name,
    side: 'guild',
    hunterId: hunter.id,
    monsterId: undefined,
    stats,
    profile,
    loadout: hunter.loadout,
    health: maxHealth,
    maxHealth,
    resource: maxResource,
    maxResource,
    position: 0,
    preferredRange: profile.primaryRange,
    cooldowns: new Map(),
    aiCooldown: 0,
    attackCooldown: 0,
    statuses: [],
    ccHistory: new Map(),
    threat: new Map(),
    targetId: undefined,
    downed: false,
    downedRemaining: 0,
    dead: false,
    rescuingId: undefined,
    rescueProgress: 0,
    telegraph: undefined,
    phase: 0,
    disengaging: false,
    secondsSinceAttacked: 999,
  };
}

export function monsterCombatant(def: MonsterDef, index: number, position: number): Combatant {
  const maxHealth = Math.max(1, Math.round(def.stats['maxHp'] ?? 100));

  return {
    id: `${def.id}#${index}`,
    // Numbered only when there is more than one, so a solo boss reads as itself.
    name: index === 0 ? def.name : `${def.name} ${index + 1}`,
    side: 'monster',
    hunterId: undefined,
    monsterId: def.id,
    stats: def.stats,
    profile: undefined,
    loadout: [],
    health: maxHealth,
    maxHealth,
    resource: 0,
    maxResource: 0,
    position,
    preferredRange: def.rangeBand,
    cooldowns: new Map(),
    aiCooldown: 0,
    attackCooldown: 0,
    statuses: [],
    ccHistory: new Map(),
    threat: new Map(),
    targetId: undefined,
    downed: false,
    downedRemaining: 0,
    dead: false,
    rescuingId: undefined,
    rescueProgress: 0,
    telegraph: undefined,
    phase: 0,
    disengaging: false,
    secondsSinceAttacked: 999,
  };
}
