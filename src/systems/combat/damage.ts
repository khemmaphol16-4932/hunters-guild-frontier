/**
 * The damage pipeline.
 *
 * REQ-CBT-002: "hybrid — externally understandable, internally multi-layered". The formula a
 * player could describe is `(attack × power − defence) × crit × variance`. The layering is in
 * what feeds attack and defence — attributes, equipment main stats and substats, set and card
 * effects, mastery — not in the arithmetic here.
 *
 * REQ-CBT-007 fixes variance at ±10%; the balance loader refuses any other value.
 *
 * **Elements carry no multiplier.** v1.0 §7 explicitly forbids substituting a fixed elemental
 * rock-paper-scissors system, and §20 lists the element list and reaction matrix as needing
 * approval. Elements are therefore recorded on skills and monsters and passed through this
 * pipeline untouched, so that adding a reaction matrix later is a deliberate change rather
 * than an edit to a coefficient. See SPEC_RECONCILIATION C4.
 */

import type { CombatBalance } from '../../data/combatSchema.js';
import type { Rng } from '../../core/rng.js';
import type { Combatant } from '../../core/combat/Combatant.js';
import { stat } from '../../core/combat/Combatant.js';

export type DamageType = 'physical' | 'magic' | 'true';

export interface DamageRequest {
  readonly attacker: Combatant;
  readonly defender: Combatant;
  readonly type: DamageType;
  /** Skill power multiplier. 1 is a basic attack. */
  readonly power: number;
  /** Situational accuracy modifier, e.g. attacking from behind cover. */
  readonly accuracyModifier?: number;
  /** Flat and percentage penetration (REQ-CBT-004). */
  readonly flatPenetration?: number;
  readonly percentPenetration?: number;
}

export interface DamageResult {
  readonly hit: boolean;
  readonly critical: boolean;
  readonly amount: number;
  /** Populated when the attack missed, for the combat log. */
  readonly missReason: string | undefined;
}

export class DamagePipeline {
  constructor(private readonly balance: CombatBalance) {}

  /** REQ-CBT-005: accuracy, evasion and a situational modifier. */
  hitChance(request: DamageRequest): number {
    const accuracy = stat(request.attacker, 'accuracy');
    const evasion = stat(request.defender, 'evasion');
    const { base, scale, min, max } = this.balance.accuracy;

    const raw = base + (accuracy - evasion) * scale + (request.accuracyModifier ?? 0);
    return Math.min(max, Math.max(min, raw));
  }

  /** REQ-CBT-006: crit chance, crit damage, and boss-side crit resistance. */
  critChance(request: DamageRequest): number {
    const chance = stat(request.attacker, 'critChance') * this.balance.critical.chanceScale;
    const resistance = stat(request.defender, 'critResistance') * this.balance.critical.chanceScale;
    return Math.min(this.balance.critical.maxChance, Math.max(0, chance - resistance));
  }

  private attackValue(request: DamageRequest): number {
    switch (request.type) {
      case 'physical':
        return stat(request.attacker, 'physicalAttack');
      case 'magic':
        return stat(request.attacker, 'magicAttack');
      case 'true':
        // True damage ignores defence entirely, so it uses the larger of the two so a
        // caster's true damage is not silently worse than a warrior's.
        return Math.max(
          stat(request.attacker, 'physicalAttack'),
          stat(request.attacker, 'magicAttack'),
        );
    }
  }

  private defenceValue(request: DamageRequest): number {
    switch (request.type) {
      case 'physical':
        return stat(request.defender, 'physicalDefense');
      case 'magic':
        return stat(request.defender, 'magicDefense');
      case 'true':
        return 0;
    }
  }

  /**
   * Resolve one attack. Every random draw comes from the injected stream, so an encounter
   * replays identically from its seed (REQ-TEC-005, v1.0 §7).
   */
  resolve(rng: Rng, request: DamageRequest): DamageResult {
    if (!rng.bool(this.hitChance(request))) {
      return { hit: false, critical: false, amount: 0, missReason: 'missed' };
    }

    const attack = this.attackValue(request) * request.power;

    let defence = this.defenceValue(request);
    defence *= 1 - Math.min(0.9, request.percentPenetration ?? 0);
    defence = Math.max(0, defence - (request.flatPenetration ?? 0));

    const critical = rng.bool(this.critChance(request));
    // critDamage is a percentage (150 = 1.5x), scaled by damageScale. Floored at 1 so a
    // badly-authored value can never make a critical hit weaker than a normal one.
    const critMultiplier = critical
      ? Math.max(1, stat(request.attacker, 'critDamage', 150) * this.balance.critical.damageScale)
      : 1;

    const spread = this.balance.damage.varianceSpread;
    const variance = 1 + rng.range(-spread, spread);

    const raw = (attack - defence * this.balance.damage.defenceScale) * critMultiplier * variance;
    const amount = Math.max(this.balance.damage.minimumDamage, Math.round(raw));

    return { hit: true, critical, amount, missReason: undefined };
  }

  /** Healing has no accuracy or defence — it either lands or the skill was not cast. */
  resolveHealing(rng: Rng, healer: Combatant, power: number): number {
    const spread = this.balance.damage.varianceSpread;
    const variance = 1 + rng.range(-spread, spread);
    return Math.max(1, Math.round(stat(healer, 'healingPower') * power * variance));
  }
}
