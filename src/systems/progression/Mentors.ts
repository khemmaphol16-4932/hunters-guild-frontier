import type { Hunter } from '../../core/hunter/Hunter.js';
import type { HunterId } from '../../core/ids.js';
import type { ChronicleEntry } from '../hunter/Chronicle.js';

export interface MentorProfile {
  readonly hunterId: HunterId;
  readonly name: string;
  readonly retiredAtLevel: number;
  readonly speciality: string;
  readonly experienceScale: number;
  readonly masteryScale: number;
  readonly trainingEfficiency: number;
  readonly legacyTraits: readonly string[];
}

export interface MentorsSnapshot { readonly mentors: readonly MentorProfile[] }

export class Mentors {
  private readonly profiles = new Map<HunterId, MentorProfile>();

  retire(hunter: Hunter, historic: readonly ChronicleEntry[]): MentorProfile {
    const masteryPeak = Math.max(0, ...Object.values(hunter.mastery));
    const speciality = Object.entries(hunter.attributes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'general';
    const profile: MentorProfile = {
      hunterId: hunter.id,
      name: hunter.name,
      retiredAtLevel: hunter.level,
      speciality,
      experienceScale: 1 + Math.min(0.2, hunter.level / 500),
      masteryScale: 1 + Math.min(0.25, masteryPeak / 2_000),
      trainingEfficiency: 1 + Math.min(0.2, (hunter.potential.facets['growthRate'] ?? 1) / 10),
      legacyTraits: [...new Set(historic.map((entry) => entry.kind))].sort(),
    };
    this.profiles.set(hunter.id, profile);
    return profile;
  }

  all(): readonly MentorProfile[] { return [...this.profiles.values()]; }
  has(hunterId: HunterId): boolean { return this.profiles.has(hunterId); }

  experienceScale(): number {
    return Math.min(1.5, this.all().reduce((scale, mentor) => scale + mentor.experienceScale - 1, 1));
  }

  masteryScale(): number {
    return Math.min(1.5, this.all().reduce((scale, mentor) => scale + mentor.masteryScale - 1, 1));
  }

  trainingEfficiency(): number {
    return Math.min(1.5, this.all().reduce((scale, mentor) => scale + mentor.trainingEfficiency - 1, 1));
  }

  snapshot(): MentorsSnapshot { return { mentors: this.all() }; }
  snapshotSelected(ids: readonly string[]): MentorsSnapshot {
    const selected = new Set(ids);
    return { mentors: this.all().filter((mentor) => selected.has(mentor.hunterId)) };
  }
  restore(snapshot: MentorsSnapshot | undefined): void {
    this.profiles.clear();
    for (const mentor of snapshot?.mentors ?? []) this.profiles.set(mentor.hunterId, mentor);
  }
}
