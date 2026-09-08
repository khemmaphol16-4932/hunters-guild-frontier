/**
 * Real equipment and card contributions to build identity.
 *
 * This file is the payoff of DL-009 / conflict B7. In Phase 1, `BuildIdentity` consumed
 * `EquipmentContribution` and `CardContribution` interfaces backed by null objects, and the
 * §16 source weights already reserved equipment's share (2) and cards' share (1). Phase 2
 * replaces the null objects with these implementations and **BuildIdentity is not touched
 * at all** — no interface change, no reweighting, no new coupling.
 *
 * That was the design bet, and it is the reason this phase did not require reopening the
 * keystone system. Worth stating plainly because the alternative — deferring build identity
 * until equipment existed — would have blocked the entire AI layer behind items.
 */

import type { RangeBand, Role } from '../../data/schema.js';
import type { GameContent } from '../../data/loader.js';
import type { IdentityContributionData } from '../../data/itemSchema.js';
import type { Hunter } from '../../core/hunter/Hunter.js';
import type { Item } from '../../core/items/Item.js';
import { itemQuality } from '../../core/items/Item.js';
import type {
  CardContribution,
  EquipmentContribution,
  IdentityContribution,
} from '../hunter/contributions.js';
import type { Cards } from './Cards.js';
import type { Equipment } from './Equipment.js';
import type { Sets } from './Sets.js';

type MutableRoles = Partial<Record<Role, number>>;
type MutableRanges = Partial<Record<RangeBand, number>>;

interface Accumulator {
  roleLean: MutableRoles;
  rangeBand: MutableRanges;
  riskPostureShift: number;
  skillAffinity: Record<string, number>;
  weight: number;
}

function emptyAccumulator(): Accumulator {
  return { roleLean: {}, rangeBand: {}, riskPostureShift: 0, skillAffinity: {}, weight: 0 };
}

function accumulate(target: Accumulator, source: IdentityContributionData, weight: number): void {
  for (const [role, value] of Object.entries(source.roleLean) as [Role, number][]) {
    target.roleLean[role] = (target.roleLean[role] ?? 0) + value * weight;
  }
  for (const [band, value] of Object.entries(source.rangeBand) as [RangeBand, number][]) {
    target.rangeBand[band] = (target.rangeBand[band] ?? 0) + value * weight;
  }
  for (const [tag, value] of Object.entries(source.skillAffinity)) {
    target.skillAffinity[tag] = (target.skillAffinity[tag] ?? 0) + value * weight;
  }
  target.riskPostureShift += source.riskPostureShift * weight;
  target.weight += weight;
}

/** Normalise by total weight so a hunter in seven pieces is not seven times as opinionated. */
function finish(acc: Accumulator): IdentityContribution {
  if (acc.weight <= 0) {
    return { roleLean: {}, rangeBand: {}, riskPostureShift: 0, skillAffinity: {} };
  }

  const roleLean: MutableRoles = {};
  for (const [role, value] of Object.entries(acc.roleLean) as [Role, number][]) {
    roleLean[role] = value / acc.weight;
  }
  const rangeBand: MutableRanges = {};
  for (const [band, value] of Object.entries(acc.rangeBand) as [RangeBand, number][]) {
    rangeBand[band] = value / acc.weight;
  }
  const skillAffinity: Record<string, number> = {};
  for (const [tag, value] of Object.entries(acc.skillAffinity)) {
    skillAffinity[tag] = value / acc.weight;
  }

  return {
    roleLean,
    rangeBand,
    riskPostureShift: acc.riskPostureShift / acc.weight,
    skillAffinity,
  };
}

export interface ItemIdentityDeps {
  readonly content: GameContent;
  readonly equipment: Equipment;
  readonly cards: Cards;
  readonly sets: Sets;
}

/**
 * Equipment's contribution: what the hunter is wearing, what legendary effects those pieces
 * carry, and which set bonuses are live.
 *
 * A weapon counts for more than a pair of boots — the weapon is the loudest statement a
 * hunter's gear makes about what they do — and a better-rolled item speaks slightly louder
 * than a poorly-rolled one, so upgrading a piece nudges identity rather than only stats.
 */
export class EquipmentIdentity implements EquipmentContribution {
  /** Slot influence. Weapon dominates; incidental slots contribute least. */
  private static readonly SLOT_WEIGHT: Record<string, number> = {
    weapon: 3,
    offhand: 2,
    body: 2,
    trinket: 1.5,
    head: 1,
    hands: 1,
    feet: 1,
  };

  private readonly content: GameContent;
  private readonly equipment: Equipment;
  private readonly sets: Sets;

  constructor(deps: ItemIdentityDeps) {
    this.content = deps.content;
    this.equipment = deps.equipment;
    this.sets = deps.sets;
  }

  contributionFor(hunter: Hunter): IdentityContribution {
    const items = this.equipment.equippedItems(hunter);
    if (items.length === 0) {
      return { roleLean: {}, rangeBand: {}, riskPostureShift: 0, skillAffinity: {} };
    }

    const acc = emptyAccumulator();

    for (const item of items) {
      const weight = this.weightOf(item);

      const type = this.content.itemTypesById.get(item.typeId);
      if (type) {
        accumulate(
          acc,
          {
            roleLean: type.roleLean,
            rangeBand: type.rangeBand,
            riskPostureShift: type.riskPostureShift,
            skillAffinity: type.skillAffinity,
          },
          weight,
        );
      }

      // REQ-EQP-007: a legendary changes how the build works, so it speaks loudly —
      // as much again as the item type it sits on.
      if (item.uniqueEffectId) {
        const unique = this.content.uniqueEffectsById.get(item.uniqueEffectId);
        if (unique) accumulate(acc, unique.identity, weight);
      }
    }

    // Set bonuses describe the whole outfit rather than one slot, so they are weighted
    // by how many tiers are actually live.
    for (const active of this.sets.active(items)) {
      for (const tier of active.tiers) {
        accumulate(acc, tier.identity, tier.pieces / 2);
      }
    }

    return finish(acc);
  }

  private weightOf(item: Item): number {
    const slotWeight = EquipmentIdentity.SLOT_WEIGHT[item.slot] ?? 1;
    // Roll quality shifts influence by at most ±15%, so a perfect item states its identity
    // a little more firmly without quality becoming a second identity axis.
    return slotWeight * (0.925 + itemQuality(item) * 0.15);
  }
}

/**
 * Cards' contribution.
 *
 * REQ-CRD-001 says cards are build-changing, and this is half of how: the other half is
 * `Equipment.aggregateEffects`, which Phase 4 combat and AI consume. A boss card is
 * weighted more heavily than a common one, because "that Boss Card completely changed this
 * Hunter" (§131) has to be visible in the profile, not only in the combat log.
 */
export class CardIdentity implements CardContribution {
  private readonly content: GameContent;
  private readonly equipment: Equipment;
  private readonly cards: Cards;

  constructor(deps: ItemIdentityDeps) {
    this.content = deps.content;
    this.equipment = deps.equipment;
    this.cards = deps.cards;
  }

  contributionFor(hunter: Hunter): IdentityContribution {
    const items = this.equipment.equippedItems(hunter);
    const acc = emptyAccumulator();

    for (const item of items) {
      for (const card of this.cards.definitionsIn(item)) {
        accumulate(acc, card.identity, this.weightOf(card.source.kind, card.rarity));
      }
    }

    return finish(acc);
  }

  private weightOf(kind: 'common' | 'boss', rarity: string): number {
    const rarityRank = this.content.rarities.order.indexOf(rarity);
    const rarityWeight = 1 + Math.max(0, rarityRank) * 0.25;
    return kind === 'boss' ? rarityWeight * 2 : rarityWeight;
  }
}
