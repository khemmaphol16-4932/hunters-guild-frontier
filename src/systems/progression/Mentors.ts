import type { Hunter } from '../../core/hunter/Hunter.js';
import type { HunterId } from '../../core/ids.js';
import type { MentorBalance } from '../../data/progressionSchema.js';

export interface MentorProfile {
  readonly hunterId: HunterId;
  readonly name: string;
  readonly retiredAtLevel: number;
  readonly speciality: string;
  readonly experienceScale: number;
  readonly masteryScale: number;
  readonly trainingEfficiency: number;
  /**
   * Legacy Trait ids this mentor can pass on (REQ-LEG-004). Saves from before the review
   * hold raw Chronicle kinds here; those match no trait and simply cannot be inherited.
   */
  readonly legacyTraits: readonly string[];
}

export interface MentorsSnapshot {
  readonly mentors: readonly MentorProfile[];
  /** Apprentices each mentor has taken on. Absent in older saves (read as none). */
  readonly apprenticeCounts?: Readonly<Record<string, number>>;
}

/**
 * Retired hunters who teach (REQ-LEG-004): EXP bonuses, mastery training and training
 * efficiency, each depending on who the mentor was.
 *
 * Every number comes from `balance/progression.json`. `practiceScale` is the one place two of
 * the effects meet: mastery training and training efficiency both apply to a practice
 * session, so they multiply — and the product is capped as a whole, because two separately
 * capped bonuses stacking on the same gain was the double count the Phase 8 review found.
 */
export class Mentors {
  private readonly profiles = new Map<HunterId, MentorProfile>();
  private readonly apprentices = new Map<string, number>();

  constructor(private readonly balance: MentorBalance) {}

  /**
   * Retire a hunter into a mentor. `legacyTraitIds` are the Legacy Traits their historic
   * Chronicle entries earned; the caller resolves them against content.
   */
  retire(hunter: Hunter, legacyTraitIds: readonly string[]): MentorProfile {
    const b = this.balance;
    const masteryPeak = Math.max(0, ...Object.values(hunter.mastery));
    const speciality = Object.entries(hunter.attributes).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'general';
    const profile: MentorProfile = {
      hunterId: hunter.id,
      name: hunter.name,
      retiredAtLevel: hunter.level,
      speciality,
      experienceScale: 1 + Math.min(b.experienceCap, hunter.level * b.experiencePerLevel),
      masteryScale: 1 + Math.min(b.masteryCap, masteryPeak * b.masteryPerPeakPoint),
      trainingEfficiency: 1 + Math.min(b.trainingCap, (hunter.potential.facets['growthRate'] ?? 1) * b.trainingPerGrowthRate),
      legacyTraits: [...new Set(legacyTraitIds)].sort(),
    };
    this.profiles.set(hunter.id, profile);
    return profile;
  }

  all(): readonly MentorProfile[] { return [...this.profiles.values()]; }
  get(hunterId: string): MentorProfile | undefined { return this.profiles.get(hunterId as HunterId); }
  apprenticesOf(hunterId: string): number { return this.apprentices.get(hunterId) ?? 0; }
  recordApprentice(hunterId: string): void { this.apprentices.set(hunterId, this.apprenticesOf(hunterId) + 1); }
  has(hunterId: HunterId): boolean { return this.profiles.has(hunterId); }

  experienceScale(): number { return this.guildWide((mentor) => mentor.experienceScale); }
  masteryScale(): number { return this.guildWide((mentor) => mentor.masteryScale); }
  trainingEfficiency(): number { return this.guildWide((mentor) => mentor.trainingEfficiency); }

  /** The multiplier on mastery from a practice session: both training effects, capped together. */
  practiceScale(): number {
    return Math.min(this.balance.practiceCap, this.masteryScale() * this.trainingEfficiency());
  }

  snapshot(): MentorsSnapshot {
    return { mentors: this.all(), apprenticeCounts: Object.fromEntries(this.apprentices) };
  }

  snapshotSelected(ids: readonly string[]): MentorsSnapshot {
    const selected = new Set(ids);
    return {
      mentors: this.all().filter((mentor) => selected.has(mentor.hunterId)),
      apprenticeCounts: Object.fromEntries([...this.apprentices].filter(([id]) => selected.has(id))),
    };
  }

  restore(snapshot: MentorsSnapshot | undefined): void {
    this.profiles.clear();
    this.apprentices.clear();
    for (const mentor of snapshot?.mentors ?? []) this.profiles.set(mentor.hunterId, mentor);
    for (const [id, count] of Object.entries(snapshot?.apprenticeCounts ?? {})) this.apprentices.set(id, count);
  }

  private guildWide(pick: (mentor: MentorProfile) => number): number {
    return 1 + Math.min(this.balance.guildWideCap, this.all().reduce((sum, mentor) => sum + pick(mentor) - 1, 0));
  }
}
