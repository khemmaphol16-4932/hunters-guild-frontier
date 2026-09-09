/**
 * Generated build tags.
 *
 * v1.0 §5: *"Build tags are generated from actual attributes, skills, weapon/equipment,
 * cards, sets, and elemental interactions. They describe role and behavior (for example,
 * crit melee, fire, sustain); they are not manually chosen labels and do not reduce to
 * Combat Power."* §6 adds that roles are *"functional capability tags, not mandatory
 * tank/DPS/healer boxes."*
 *
 * Three properties follow from that and are enforced here:
 *
 *  - **Derived, never stored.** There is no setter and no tag field on a Hunter. A tag is a
 *    function of the current build, so it cannot drift out of sync with what the hunter
 *    actually is, and it cannot be edited into a lie.
 *  - **No aggregate.** Tags carry a confidence, but nothing sums or averages them into a
 *    rating. §19 forbids Combat Power, and the way that requirement dies is by someone
 *    adding a convenient "overall" number here.
 *  - **Descriptive, not prescriptive.** `roleLean` in `BuildProfile` stays as the continuous
 *    axis the AI's utility layer reads; tags are the player-facing reading of it. The AI
 *    never consumes tags, so tag wording can change freely without touching behaviour.
 */

import type { Role } from '../../data/schema.js';
import type { BuildProfile } from './BuildIdentity.js';

export type BuildTagKind = 'role' | 'range' | 'behaviour' | 'element' | 'resource' | 'utility';

export interface BuildTag {
  /** Short, player-facing, lower case: 'crit melee', 'sustain', 'fire'. */
  readonly label: string;
  readonly kind: BuildTagKind;
  /** 0..1 — how strongly the build supports this reading. Never aggregated. */
  readonly confidence: number;
  /** Why this tag was generated, for the two-level tooltip §13 asks for. */
  readonly because: string;
}

/** Thresholds at which a lean becomes worth naming. Tuning values, not design decisions. */
const TAG_THRESHOLD = {
  dominantRole: 0.4,
  secondaryRole: 0.2,
  range: 0.5,
  disposition: 0.65,
  affinity: 0.35,
} as const;

const ROLE_TAG: Record<Role, string> = {
  tank: 'frontline',
  healer: 'sustain',
  damage: 'damage',
  support: 'support',
  control: 'control',
};

/**
 * Skill-tag → player-facing build tag.
 *
 * Data-shaped rather than a switch so that new skill tags can be surfaced by adding a row.
 * A skill tag with no mapping simply does not produce a build tag, which is the right
 * failure mode — an unmapped tag is invisible rather than wrong.
 */
const AFFINITY_TAG: Readonly<Record<string, { label: string; kind: BuildTagKind }>> = {
  precision: { label: 'crit', kind: 'behaviour' },
  martial: { label: 'martial', kind: 'behaviour' },
  defensive: { label: 'defensive', kind: 'behaviour' },
  threat: { label: 'threat-holding', kind: 'behaviour' },
  restorative: { label: 'restorative', kind: 'behaviour' },
  rescue: { label: 'rescue', kind: 'utility' },
  mobility: { label: 'mobile', kind: 'utility' },
  rallying: { label: 'rallying', kind: 'utility' },
  arcane: { label: 'arcane', kind: 'behaviour' },
  magical: { label: 'magical', kind: 'behaviour' },
  elemental: { label: 'elemental', kind: 'element' },
  physical: { label: 'physical', kind: 'behaviour' },
};

export interface BuildTagOptions {
  /**
   * Element ids the build actually interacts with, from equipped weapon elements, cards and
   * skill elements. Passed in rather than derived here because the element list and reaction
   * matrix are unapproved data (v1.0 §20) — this function must not assume what elements exist.
   */
  readonly elements?: readonly string[];
  readonly maxTags?: number;
}

const DEFAULT_MAX_TAGS = 8;

/**
 * Generate the tags describing a build.
 *
 * Ordered by confidence so the UI can show the most defining first and truncate the rest.
 */
export function generateBuildTags(
  profile: BuildProfile,
  options: BuildTagOptions = {},
): readonly BuildTag[] {
  const tags: BuildTag[] = [];

  // --- Role -----------------------------------------------------------------
  // The primary role is always named, even when weak — "this hunter has no clear role" is
  // itself the useful reading, and it surfaces as a low confidence rather than as silence.
  const roleEntries = (Object.entries(profile.roleLean) as [Role, number][]).sort(
    (a, b) => b[1] - a[1],
  );

  for (const [role, value] of roleEntries) {
    if (value < TAG_THRESHOLD.secondaryRole) continue;
    const isDominant = value >= TAG_THRESHOLD.dominantRole;
    tags.push({
      label: ROLE_TAG[role],
      kind: 'role',
      confidence: value,
      because: isDominant
        ? `${Math.round(value * 100)}% of this build leans ${role}`
        : `a real secondary ${role} contribution (${Math.round(value * 100)}%)`,
    });
  }

  // --- Range ----------------------------------------------------------------
  const rangeEntries = Object.entries(profile.rangeBand).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  const topRange = rangeEntries[0];
  if (topRange && (topRange[1] ?? 0) >= TAG_THRESHOLD.range) {
    tags.push({
      label: topRange[0],
      kind: 'range',
      confidence: topRange[1] ?? 0,
      because: `fights at ${topRange[0]} range ${Math.round((topRange[1] ?? 0) * 100)}% of the time`,
    });
  }

  // --- Disposition ----------------------------------------------------------
  if (profile.riskPosture >= TAG_THRESHOLD.disposition) {
    tags.push({
      label: 'aggressive',
      kind: 'behaviour',
      confidence: profile.riskPosture,
      because: 'presses attacks and takes fights others would refuse',
    });
  } else if (profile.riskPosture <= 1 - TAG_THRESHOLD.disposition) {
    tags.push({
      label: 'cautious',
      kind: 'behaviour',
      confidence: 1 - profile.riskPosture,
      because: 'plays for survival and disengages early',
    });
  }

  // --- Resource shape -------------------------------------------------------
  if (profile.resourceProfile >= TAG_THRESHOLD.disposition) {
    tags.push({
      label: 'sustained',
      kind: 'resource',
      confidence: profile.resourceProfile,
      because: 'cheap, frequent actions rather than saved-up spikes',
    });
  } else if (profile.resourceProfile <= 1 - TAG_THRESHOLD.disposition) {
    tags.push({
      label: 'burst',
      kind: 'resource',
      confidence: 1 - profile.resourceProfile,
      because: 'holds resources for a decisive moment',
    });
  }

  // --- Skill affinities -----------------------------------------------------
  const affinityEntries = Object.entries(profile.skillAffinity).sort((a, b) => b[1] - a[1]);
  const strongestAffinity = affinityEntries[0]?.[1] ?? 0;

  for (const [skillTag, weight] of affinityEntries) {
    const mapped = AFFINITY_TAG[skillTag];
    if (!mapped) continue;
    // Relative to the build's own strongest affinity: an absolute cutoff would give a
    // narrow specialist no tags and a generalist a dozen.
    const relative = strongestAffinity > 0 ? weight / strongestAffinity : 0;
    if (relative < TAG_THRESHOLD.affinity) continue;

    tags.push({
      label: mapped.label,
      kind: mapped.kind,
      confidence: Math.min(1, relative),
      because: `gravitates toward ${skillTag} play`,
    });
  }

  // --- Elements -------------------------------------------------------------
  for (const element of options.elements ?? []) {
    tags.push({
      label: element,
      kind: 'element',
      confidence: 0.8,
      because: `the build interacts with ${element}`,
    });
  }

  // --- Versatility ----------------------------------------------------------
  if (profile.versatility >= 0.5) {
    tags.push({
      label: 'versatile',
      kind: 'utility',
      confidence: profile.versatility,
      because: 'knows far more than the current loadout carries',
    });
  }

  return truncate(dedupe(tags), options.maxTags ?? DEFAULT_MAX_TAGS);
}

/**
 * Trim to the tag budget without losing the answer to "what kind of hunter is this?".
 *
 * Sorting purely by confidence lets a crowd of skill-affinity tags — which routinely reach
 * 1.0 — push the role and range tags out of the list entirely, so a dedicated front-liner
 * could be described as "defensive, threat-holding, martial" while never being called a
 * front-liner. The strongest role and range tags are therefore reserved first, and the
 * remaining budget is filled by confidence.
 */
function truncate(tags: readonly BuildTag[], limit: number): readonly BuildTag[] {
  const byConfidence = [...tags].sort((a, b) => b.confidence - a.confidence);
  if (byConfidence.length <= limit) return byConfidence;

  const reserved: BuildTag[] = [];
  for (const kind of ['role', 'range'] as const) {
    const best = byConfidence.find((t) => t.kind === kind);
    if (best) reserved.push(best);
  }

  const rest = byConfidence.filter((t) => !reserved.includes(t));
  return [...reserved, ...rest]
    .slice(0, limit)
    .sort((a, b) => b.confidence - a.confidence);
}

/** Keep the highest-confidence instance of each label. */
function dedupe(tags: readonly BuildTag[]): BuildTag[] {
  const best = new Map<string, BuildTag>();
  for (const tag of tags) {
    const existing = best.get(tag.label);
    if (!existing || tag.confidence > existing.confidence) best.set(tag.label, tag);
  }
  return [...best.values()];
}

/**
 * Compose tags into the short phrase v1.0 §5 uses as its own example ("crit melee").
 * Behaviour and range tags read naturally together; the role anchors the phrase.
 */
export function composeTagPhrase(tags: readonly BuildTag[]): string {
  const pick = (kind: BuildTagKind): BuildTag | undefined => tags.find((t) => t.kind === kind);

  const behaviour = pick('behaviour');
  const range = pick('range');
  const role = pick('role');

  const words = [behaviour?.label, range?.label, role?.label].filter(
    (w): w is string => w !== undefined,
  );

  return words.length > 0 ? [...new Set(words)].join(' ') : 'undefined build';
}
