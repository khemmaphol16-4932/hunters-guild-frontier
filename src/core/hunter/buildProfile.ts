/**
 * The build profile shape.
 *
 * This type lives in `core/` rather than beside the system that derives it because it is the
 * contract *between* layers: `systems/hunter/BuildIdentity` produces it, `ai/` consumes it,
 * and `core/combat/Combatant` carries it. A shared vocabulary type owned by one of its own
 * consumers would force an upward import, which the architecture test rejects — correctly,
 * because that is the first step toward every layer depending on every other.
 *
 * The derivation, its weights and its balance data all stay in the system. Only the shape is
 * here (REQ-BLD-001/002/003).
 */

import type { RangeBand, Role } from '../../data/schema.js';
import type { HunterId } from '../ids.js';

export type IdentityShape = 'specialist' | 'hybrid' | 'generalist';

export interface BuildProfile {
  readonly hunterId: HunterId;

  /** Normalised across all five roles; sums to 1 when the hunter has any identity at all. */
  readonly roleLean: Readonly<Record<Role, number>>;
  readonly primaryRole: Role;
  readonly secondaryRole: Role | undefined;

  readonly rangeBand: Readonly<Record<RangeBand, number>>;
  readonly primaryRange: RangeBand;

  /** 0 = maximally cautious, 1 = maximally aggressive. */
  readonly riskPosture: number;
  /** 0 = burst (few decisive actions), 1 = sustain (many cheap actions). */
  readonly resourceProfile: number;

  /** Skill tag -> weight. What kind of play this hunter gravitates to. */
  readonly skillAffinity: Readonly<Record<string, number>>;

  /** 0..1 breadth from known-but-unequipped skills — the Skill Books axis of §16. */
  readonly versatility: number;

  /** How dominant the primary role is. Drives how strictly the AI holds to identity. */
  readonly focus: number;
  readonly shape: IdentityShape;
  /**
   * How much a hunter weighs a fallen ally's safety beyond what their risk posture says —
   * from traits (Loyal: allySafetyWeightShift). Optional so hand-built profiles stay valid.
   */
  readonly allySafety?: number;
}
