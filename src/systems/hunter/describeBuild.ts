/**
 * Plain-language rendering of a build profile.
 *
 * REQ-UX-003: the player should be able to answer "what kind of Hunter is this?" at a
 * glance. REQ-AI-011/REQ-UX-002: explanations are readable sentences, never raw utility
 * scores — "holds the line and expects to be hit" is useful, "roleLean.tank = 0.62" is not.
 *
 * Lives in systems/ rather than ui/ because it is domain reasoning about what a profile
 * *means*; the UI only decides how to lay it out (REQ-TEC-010).
 */

import type { RangeBand, Role } from '../../data/schema.js';
import type { BuildProfile } from './BuildIdentity.js';

const ROLE_NOUN: Record<Role, string> = {
  tank: 'front-liner',
  healer: 'healer',
  damage: 'damage dealer',
  support: 'support hunter',
  control: 'controller',
};

const RANGE_PHRASE: Record<RangeBand, string> = {
  melee: 'fights at arm’s length',
  mid: 'works the middle distance',
  ranged: 'stays at range',
};

export interface BuildDescription {
  /** One-sentence answer to "what kind of hunter is this?" */
  readonly summary: string;
  /** How this build will tend to behave once combat AI is driving it. */
  readonly tendencies: readonly string[];
  /** Where this build is weak — the honest half of the dashboard (REQ-UX-003). */
  readonly weaknesses: readonly string[];
}

export function describeBuild(profile: BuildProfile): BuildDescription {
  const primary = ROLE_NOUN[profile.primaryRole];
  const shapeWord =
    profile.shape === 'specialist'
      ? 'dedicated'
      : profile.shape === 'hybrid'
        ? 'capable but split'
        : 'unfocused';

  const secondaryClause = profile.secondaryRole
    ? ` with a real second role as a ${ROLE_NOUN[profile.secondaryRole]}`
    : '';

  const summary = `A ${shapeWord} ${primary}${secondaryClause} who ${RANGE_PHRASE[profile.primaryRange]}.`;

  const tendencies: string[] = [];

  if (profile.riskPosture >= 0.68) {
    tendencies.push('Presses the attack — will take fights others would refuse.');
  } else if (profile.riskPosture <= 0.35) {
    tendencies.push('Plays for survival — disengages early and heals before it is urgent.');
  } else {
    tendencies.push('Weighs each fight on its merits rather than defaulting to aggression or caution.');
  }

  if (profile.resourceProfile >= 0.65) {
    tendencies.push('Applies constant pressure with cheap, frequent actions.');
  } else if (profile.resourceProfile <= 0.35) {
    tendencies.push('Holds resources for a decisive moment rather than spending steadily.');
  }

  if (profile.versatility >= 0.5) {
    tendencies.push('Knows far more than they carry — adapts well when the loadout is changed.');
  }

  const affinities = Object.entries(profile.skillAffinity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([tag]) => tag);
  if (affinities.length > 0) {
    tendencies.push(`Gravitates toward ${affinities.join(' and ')} play.`);
  }

  const weaknesses: string[] = [];

  if (profile.shape === 'generalist') {
    weaknesses.push('No dominant role — competent everywhere, decisive nowhere.');
  }
  if ((profile.roleLean.healer ?? 0) < 0.05 && (profile.roleLean.support ?? 0) < 0.05) {
    weaknesses.push('Contributes nothing to keeping the party alive.');
  }
  if ((profile.roleLean.tank ?? 0) < 0.08 && profile.primaryRange === 'melee') {
    weaknesses.push('Fights in melee without the durability to hold that position.');
  }
  if (profile.riskPosture >= 0.75 && (profile.roleLean.tank ?? 0) < 0.2) {
    weaknesses.push('Aggressive without the survivability to absorb the consequences.');
  }
  if (profile.versatility <= 0.1) {
    weaknesses.push('Knows little beyond the current loadout — inflexible if the situation shifts.');
  }

  return { summary, tendencies, weaknesses };
}

/**
 * Distance between two build profiles, 0 (identical) to roughly 1 (nothing in common).
 *
 * The acceptance test for REQ-BLD-003 uses this: two hunters of the same class with
 * different attribute spreads and mastery must be *measurably* different, not merely
 * different-looking. It is also how the party system will later reason about whether a
 * substitute hunter actually fills the slot they are replacing.
 */
export function profileDistance(a: BuildProfile, b: BuildProfile): number {
  let roleDelta = 0;
  for (const role of Object.keys(a.roleLean) as Role[]) {
    roleDelta += Math.abs((a.roleLean[role] ?? 0) - (b.roleLean[role] ?? 0));
  }

  let rangeDelta = 0;
  for (const band of Object.keys(a.rangeBand) as RangeBand[]) {
    rangeDelta += Math.abs((a.rangeBand[band] ?? 0) - (b.rangeBand[band] ?? 0));
  }

  const riskDelta = Math.abs(a.riskPosture - b.riskPosture);
  const resourceDelta = Math.abs(a.resourceProfile - b.resourceProfile);
  const versatilityDelta = Math.abs(a.versatility - b.versatility);

  // Role lean and range are the axes the AI leans on hardest, so they dominate.
  return (
    (roleDelta / 2) * 0.4 +
    (rangeDelta / 2) * 0.25 +
    riskDelta * 0.2 +
    resourceDelta * 0.1 +
    versatilityDelta * 0.05
  );
}
