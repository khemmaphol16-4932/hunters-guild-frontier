/**
 * Build-identity contribution interfaces.
 *
 * DL-009 / conflict B7. REQ-BLD-001 lists equipment and cards as build inputs, but they
 * arrive in Phase 2. Rather than deferring build identity (which everything in the AI layer
 * depends on) or hardcoding a gap that must later be surgically reopened, BuildIdentity
 * consumes these interfaces and Phase 1 supplies null objects.
 *
 * The §16 source weights already reserve equipment's and cards' share, so when Phase 2
 * lands there is nothing to reweight — only two null objects to replace.
 */

import type { RangeBand, Role } from '../../data/schema.js';
import type { Hunter } from '../../core/hunter/Hunter.js';

export interface IdentityContribution {
  readonly roleLean: Readonly<Partial<Record<Role, number>>>;
  readonly rangeBand: Readonly<Partial<Record<RangeBand, number>>>;
  readonly riskPostureShift: number;
  /** Skill tag -> affinity weight. How strongly this source pulls toward a kind of play. */
  readonly skillAffinity: Readonly<Record<string, number>>;
}

export const EMPTY_CONTRIBUTION: IdentityContribution = {
  roleLean: {},
  rangeBand: {},
  riskPostureShift: 0,
  skillAffinity: {},
};

export interface EquipmentContribution {
  contributionFor(hunter: Hunter): IdentityContribution;
}

export interface CardContribution {
  contributionFor(hunter: Hunter): IdentityContribution;
}

/** Phase 1 placeholder. Replaced by systems/items/Equipment in Phase 2. */
export const NULL_EQUIPMENT_CONTRIBUTION: EquipmentContribution = {
  contributionFor: () => EMPTY_CONTRIBUTION,
};

/** Phase 1 placeholder. Replaced by systems/items/Cards in Phase 2. */
export const NULL_CARD_CONTRIBUTION: CardContribution = {
  contributionFor: () => EMPTY_CONTRIBUTION,
};
