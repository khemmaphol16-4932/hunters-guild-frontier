/**
 * Emergency authorisations — the only way a hard constraint can be overridden.
 *
 * v1.0 §2.1: *"A hard constraint is absolute unless an explicitly configured emergency policy
 * permits its override."* §18 restates it: *"Hard constraints are never violated unless a
 * configured emergency exception applies."*
 *
 * This replaces the absolute rule the project was originally built on (REQ-POL-004), and it
 * is the single most dangerous change in the v1.0 reconciliation: an override path is exactly
 * how "hard constraint" degrades into "strong suggestion". Four properties keep it narrow:
 *
 *  1. **No wildcards.** An authorisation names the specific constraint id it may override.
 *     There is deliberately no "override anything in an emergency" option, because that is
 *     indistinguishable from having no constraints.
 *  2. **Player-authored only.** `author: 'player'` mirrors the party-template provenance rule.
 *     The AI cannot mint itself permission.
 *  3. **Conditional.** An authorisation applies only when its trigger holds, so "override the
 *     retreat threshold" is scoped to the situation the player had in mind rather than
 *     standing open permanently.
 *  4. **Audited, never silent.** Every override produces an audit record with a reason code,
 *     so §18's "every important AI action can be explained" holds for precisely the decisions
 *     a player would most want explained.
 *
 * A constraint with no matching authorisation behaves exactly as it did before this existed.
 */

export const EMERGENCY_TRIGGERS = [
  'allyDowned',
  'allyAboutToDie',
  'selfAboutToDie',
  'partyWipeImminent',
  'objectiveAboutToFail',
] as const;
export type EmergencyTrigger = (typeof EMERGENCY_TRIGGERS)[number];

export interface EmergencyAuthorisation {
  readonly id: string;
  /** The specific hard-constraint id this may override. No wildcards. */
  readonly constraintId: string;
  /** The situation in which the override is permitted. */
  readonly trigger: EmergencyTrigger;
  /** Provenance. Only player-authored authorisations are honoured. */
  readonly author: 'player';
  /** Player-readable justification, surfaced in the audit trail and the policy editor. */
  readonly rationale: string;
}

/** What the pipeline knows about the current situation when it evaluates an override. */
export interface EmergencyContext {
  readonly activeTriggers: readonly EmergencyTrigger[];
}

export interface OverrideDecision {
  readonly constraintId: string;
  readonly authorisationId: string;
  readonly trigger: EmergencyTrigger;
  readonly rationale: string;
}

/**
 * A set of player-authored emergency authorisations.
 *
 * Construction goes through `authorise` rather than accepting a raw array, so an
 * authorisation cannot arrive from data or from the AI without passing the provenance check.
 */
export class EmergencyPolicy {
  private readonly authorisations = new Map<string, EmergencyAuthorisation>();

  /** Register a player-authored authorisation. Rejects anything not authored by the player. */
  authorise(authorisation: EmergencyAuthorisation): void {
    if (authorisation.author !== 'player') {
      throw new Error(
        `EmergencyPolicy: "${authorisation.id}" is not player-authored; ` +
          'only the player may permit a hard constraint to be overridden (v1.0 §2.1)',
      );
    }
    this.authorisations.set(authorisation.id, authorisation);
  }

  revoke(authorisationId: string): void {
    this.authorisations.delete(authorisationId);
  }

  all(): readonly EmergencyAuthorisation[] {
    return [...this.authorisations.values()];
  }

  get size(): number {
    return this.authorisations.size;
  }

  /**
   * May this constraint be overridden right now?
   *
   * Returns the authorising decision, or undefined — and undefined is the answer in every
   * case that is not an exact match on both constraint id and an active trigger.
   */
  permits(constraintId: string, context: EmergencyContext): OverrideDecision | undefined {
    for (const authorisation of this.authorisations.values()) {
      if (authorisation.constraintId !== constraintId) continue;
      if (!context.activeTriggers.includes(authorisation.trigger)) continue;

      return {
        constraintId,
        authorisationId: authorisation.id,
        trigger: authorisation.trigger,
        rationale: authorisation.rationale,
      };
    }
    return undefined;
  }

  snapshot(): readonly EmergencyAuthorisation[] {
    return this.all();
  }

  restore(authorisations: readonly EmergencyAuthorisation[]): void {
    this.authorisations.clear();
    for (const authorisation of authorisations) {
      // Restoring skips the provenance throw but keeps the filter: a tampered save cannot
      // introduce an AI-authored authorisation, it can only fail to restore one.
      if (authorisation.author === 'player') {
        this.authorisations.set(authorisation.id, authorisation);
      }
    }
  }

  clear(): void {
    this.authorisations.clear();
  }
}

/** No authorisations — hard constraints behave as absolute. The default for a new guild. */
export const NO_EMERGENCY_POLICY = new EmergencyPolicy();
