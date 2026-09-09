/**
 * Party composition.
 *
 * REQ-V1-PTY-001: the AI proposes a party for a stated *objective*, and the player edits it.
 * The order matters — objective first, then roster, then formation — because a proposal that
 * starts from "who is free" produces whoever is free, while a proposal that starts from the
 * objective produces an argument the player can disagree with.
 *
 * REQ-PTY-002: formations are templates, not hard slots. A formation states what the party
 * *wants* — how many of each role, and at what range — and the planner scores candidates
 * against that want. A party that cannot fill a slot still forms; it is reported as
 * unbalanced rather than rejected, because refusing to form a party is the one outcome the
 * player cannot act on.
 *
 * Nothing here reads combat state. This is pre-combat strategy (v1.0 §7), and the whole
 * point is that it is the last moment the player has direct influence.
 */

import type { Role } from '../../data/schema.js';
import type { RangeBand } from '../../data/schema.js';
import type { HunterId } from '../../core/ids.js';
import type { Hunter } from '../../core/hunter/Hunter.js';
import type { BuildProfile } from '../hunter/BuildIdentity.js';
import { isDeployable } from '../../core/hunter/availability.js';

export type ObjectiveId = 'clear' | 'survive' | 'loot' | 'scout' | 'slay';

export interface ObjectiveDef {
  readonly id: ObjectiveId;
  readonly name: string;
  readonly description: string;
  /** How much each role is worth to this objective. */
  readonly roleValue: Readonly<Record<Role, number>>;
  /** 0 = the objective wants caution, 1 = it wants aggression. */
  readonly riskPreference: number;
  readonly preferredFormation: string;
}

export interface FormationDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Desired count per role. A template, never a hard requirement (REQ-PTY-002). */
  readonly wants: Readonly<Partial<Record<Role, number>>>;
  /** Where the formation puts each role on the distance axis, as a fraction of engagement. */
  readonly line: Readonly<Partial<Record<Role, number>>>;
}

export interface PartyMember {
  readonly hunterId: HunterId;
  readonly name: string;
  readonly role: Role;
  readonly range: RangeBand;
  /** Position on the line, 0 = front. Derived from the formation, not stored on the hunter. */
  readonly linePosition: number;
  /** Why the planner picked them — surfaced verbatim in the UI (REQ-UX-003). */
  readonly rationale: string;
  readonly score: number;
}

export interface PartyProposal {
  readonly objective: ObjectiveDef;
  readonly formation: FormationDef;
  readonly members: readonly PartyMember[];
  /** Roles the formation wanted and the roster could not supply. */
  readonly unfilled: readonly Role[];
  /** Player-readable summary of the trade-off the planner made. */
  readonly summary: string;
  readonly reasonCodes: readonly string[];
}

export const OBJECTIVES: readonly ObjectiveDef[] = [
  {
    id: 'clear',
    name: 'Clear the route',
    description: 'Kill everything on the way and come back. The default expedition.',
    roleValue: { tank: 0.9, healer: 0.8, damage: 1, support: 0.5, control: 0.6 },
    riskPreference: 0.5,
    preferredFormation: 'standard',
  },
  {
    id: 'survive',
    name: 'Bring everyone home',
    description: 'Losses matter more than progress. Retreat early, take no chances.',
    roleValue: { tank: 1, healer: 1, damage: 0.4, support: 0.8, control: 0.7 },
    riskPreference: 0.15,
    preferredFormation: 'turtle',
  },
  {
    id: 'loot',
    name: 'Gather',
    description: 'Reach the caches. Fights are obstacles, not the point.',
    roleValue: { tank: 0.6, healer: 0.7, damage: 0.7, support: 1, control: 0.8 },
    riskPreference: 0.35,
    preferredFormation: 'standard',
  },
  {
    id: 'scout',
    name: 'Map the region',
    description: 'Reach depth and return with knowledge. Speed over completeness.',
    roleValue: { tank: 0.5, healer: 0.7, damage: 0.6, support: 0.9, control: 1 },
    riskPreference: 0.3,
    preferredFormation: 'skirmish',
  },
  {
    id: 'slay',
    name: 'Kill the boss',
    description: 'The route is preamble. Everything is spent on one fight.',
    roleValue: { tank: 1, healer: 0.9, damage: 1, support: 0.6, control: 0.7 },
    riskPreference: 0.7,
    preferredFormation: 'standard',
  },
];

export const FORMATIONS: readonly FormationDef[] = [
  {
    id: 'standard',
    name: 'Standard line',
    description: 'A tank in front, damage behind, support at the back.',
    wants: { tank: 1, healer: 1, damage: 2 },
    line: { tank: 0, control: 0.3, damage: 0.5, support: 0.8, healer: 1 },
  },
  {
    id: 'turtle',
    name: 'Turtle',
    description: 'Two front-liners and heavy sustain. Slow, hard to break.',
    wants: { tank: 2, healer: 1, damage: 1 },
    line: { tank: 0, damage: 0.6, control: 0.5, support: 0.9, healer: 1 },
  },
  {
    id: 'skirmish',
    name: 'Skirmish',
    description: 'No anchor. Everyone stays mobile and out of reach.',
    wants: { damage: 2, control: 1, support: 1 },
    line: { tank: 0.2, damage: 0.4, control: 0.5, support: 0.8, healer: 1 },
  },
];

export interface PartyPlannerDeps {
  readonly profileOf: (hunter: Hunter) => BuildProfile;
  readonly maxSize: number;
}

export class PartyPlanner {
  constructor(private readonly deps: PartyPlannerDeps) {}

  objective(id: ObjectiveId): ObjectiveDef {
    const found = OBJECTIVES.find((o) => o.id === id);
    if (!found) throw new Error(`PartyPlanner: unknown objective "${id}"`);
    return found;
  }

  formation(id: string): FormationDef {
    const found = FORMATIONS.find((f) => f.id === id);
    if (!found) throw new Error(`PartyPlanner: unknown formation "${id}"`);
    return found;
  }

  /**
   * Propose a party.
   *
   * Deterministic: no RNG, no wall clock. The same roster and objective always produce the
   * same proposal, so the player can trust that re-opening the planner does not reshuffle
   * their party underneath them.
   */
  propose(
    roster: readonly Hunter[],
    objectiveId: ObjectiveId,
    formationId?: string,
  ): PartyProposal {
    const objective = this.objective(objectiveId);
    const formation = this.formation(formationId ?? objective.preferredFormation);

    const available = roster.filter((h) => isDeployable(h.availability));
    const scored = available
      .map((hunter) => {
        const profile = this.deps.profileOf(hunter);
        return { hunter, profile, ...this.score(profile, objective) };
      })
      // Ties break on hunter id so ordering is stable across runs and machines.
      .sort((a, b) => b.score - a.score || a.hunter.id.localeCompare(b.hunter.id));

    const members: PartyMember[] = [];
    const remaining = new Map<Role, number>(
      Object.entries(formation.wants).map(([role, count]) => [role as Role, count]),
    );
    const taken = new Set<HunterId>();

    // Pass 1 — fill the formation's stated wants, best candidate per want first.
    for (const [role, count] of remaining) {
      for (let i = 0; i < count; i++) {
        const pick = scored.find(
          (c) => !taken.has(c.hunter.id) && c.profile.primaryRole === role,
        );
        if (!pick) break;
        taken.add(pick.hunter.id);
        members.push(this.toMember(pick.hunter, pick.profile, formation, pick.reason, pick.score));
        remaining.set(role, (remaining.get(role) ?? 1) - 1);
      }
    }

    // Pass 2 — a secondary-role match is a real fill, just a weaker one. This is where
    // "templates, not hard slots" becomes visible: a support who leans healer covers the
    // healer want rather than leaving it empty.
    for (const [role, stillWanted] of remaining) {
      for (let i = 0; i < stillWanted; i++) {
        const pick = scored.find(
          (c) => !taken.has(c.hunter.id) && c.profile.secondaryRole === role,
        );
        if (!pick) break;
        taken.add(pick.hunter.id);
        members.push(
          this.toMember(
            pick.hunter,
            pick.profile,
            formation,
            `covering ${role} as a secondary lean; ${pick.reason}`,
            pick.score,
          ),
        );
        remaining.set(role, (remaining.get(role) ?? 1) - 1);
      }
    }

    // Pass 3 — fill to size with the best remaining, whatever they are.
    for (const candidate of scored) {
      if (members.length >= this.deps.maxSize) break;
      if (taken.has(candidate.hunter.id)) continue;
      taken.add(candidate.hunter.id);
      members.push(
        this.toMember(
          candidate.hunter,
          candidate.profile,
          formation,
          `best remaining fit; ${candidate.reason}`,
          candidate.score,
        ),
      );
    }

    members.sort((a, b) => a.linePosition - b.linePosition);

    const shortfalls = [...remaining.entries()]
      .filter(([, count]) => count > 0)
      .map(([role, missing]) => {
        const wanted = formation.wants[role] ?? missing;
        return { role, wanted, filled: wanted - missing };
      });
    const unfilled = shortfalls.map((s) => s.role);

    return {
      objective,
      formation,
      members: members.slice(0, this.deps.maxSize),
      unfilled,
      summary: this.summarise(objective, formation, members, shortfalls, available.length),
      reasonCodes: [
        `objective:${objective.id}`,
        `formation:${formation.id}`,
        ...(unfilled.length > 0 ? [`unfilled:${unfilled.join('+')}`] : []),
        ...(available.length < this.deps.maxSize ? ['roster_short'] : []),
      ],
    };
  }

  /**
   * Score one hunter against one objective.
   *
   * Reads only the build profile, never raw stats. That is the same discipline the combat AI
   * follows (REQ-BLD-003), and it means a hunter who is *statistically* strong but whose
   * identity does not serve the objective loses to one who fits.
   */
  private score(
    profile: BuildProfile,
    objective: ObjectiveDef,
  ): { score: number; reason: string } {
    let score = 0;
    const parts: string[] = [];

    const roleFit = (Object.entries(profile.roleLean) as [Role, number][]).reduce(
      (sum, [role, lean]) => sum + lean * (objective.roleValue[role] ?? 0),
      0,
    );
    score += roleFit * 2;
    parts.push(`${profile.primaryRole} suits ${objective.name.toLowerCase()}`);

    // A focused hunter is worth more than a diffuse one for a demanding objective, and
    // less for one that wants flexibility.
    const focusValue = objective.id === 'scout' || objective.id === 'loot'
      ? profile.versatility
      : profile.focus;
    score += focusValue * 0.6;
    if (focusValue > 0.6) {
      parts.push(objective.id === 'scout' || objective.id === 'loot' ? 'adaptable' : 'focused');
    }

    // Risk mismatch is a penalty in both directions: a reckless hunter on a survival run is
    // as wrong as a cautious one on a boss kill.
    const riskGap = Math.abs(profile.riskPosture - objective.riskPreference);
    score -= riskGap * 0.8;
    if (riskGap > 0.35) parts.push('risk posture pulls against the objective');

    return { score, reason: parts.join(', ') };
  }

  private toMember(
    hunter: Hunter,
    profile: BuildProfile,
    formation: FormationDef,
    rationale: string,
    score: number,
  ): PartyMember {
    return {
      hunterId: hunter.id,
      name: hunter.name,
      role: profile.primaryRole,
      range: profile.primaryRange,
      linePosition: formation.line[profile.primaryRole] ?? 0.5,
      rationale,
      score: Math.round(score * 100) / 100,
    };
  }

  private summarise(
    objective: ObjectiveDef,
    formation: FormationDef,
    members: readonly PartyMember[],
    shortfalls: readonly { role: Role; wanted: number; filled: number }[],
    availableCount: number,
  ): string {
    if (members.length === 0) {
      return `No hunter is available to ${objective.name.toLowerCase()}.`;
    }

    const roles = new Map<Role, number>();
    for (const member of members) roles.set(member.role, (roles.get(member.role) ?? 0) + 1);
    const composition = [...roles.entries()].map(([role, n]) => `${n} ${role}`).join(', ');

    const lead = `${formation.name} for "${objective.name}": ${composition}.`;
    if (shortfalls.length === 0) return `${lead} The formation is complete.`;

    // "No tank" and "one tank short of two" are different problems and lead the player to
    // different actions — recruit, or wait for someone to recover. Saying the first when the
    // second is true, next to a composition line that lists a tank, reads as a bug.
    const described = shortfalls
      .map(({ role, wanted, filled }) =>
        filled === 0 ? `no ${role}` : `${wanted - filled} short of ${wanted} ${role}`,
      )
      .join(', ');

    const cause =
      availableCount <= members.length
        ? `only ${availableCount} hunters are deployable`
        : 'the roster does not lean that way';
    return `${lead} The formation wanted ${described} — ${cause}. The party forms anyway.`;
  }
}
