import { err, ok, type Result } from '../../core/result.js';
import type { LegacyUnlockCategory, LegacyUnlockDef } from '../../data/progressionSchema.js';

export interface NewGamePlusOptions {
  /** A Legacy unlock of category `startingChoice`. */
  readonly startingChoice?: string;
  /** A Legacy unlock of category `archetype`. */
  readonly archetype?: string;
  /** A Legacy unlock of category `worldVariant`. */
  readonly worldVariant?: string;
  readonly mentorIds?: readonly string[];
}

export interface NewGamePlusSnapshot {
  readonly cycle: number;
  readonly variant?: string;
  readonly lastStartingChoice?: string;
  readonly lastArchetype?: string;
}

export interface NewGamePlusDeps {
  readonly hasUnlock: (id: string) => boolean;
  readonly findUnlock: (id: string) => LegacyUnlockDef | undefined;
}

/**
 * The New Game+ cycle counter and the choices a cycle began with (REQ-LEG-002/003).
 *
 * This class only validates and records. What a reset *does* — the world wiped, Legacy kept,
 * the guild founded again — is composed in `Session.beginNewGamePlus` and
 * `GuildCommands.beginNewGamePlus`, because it touches every system.
 *
 * The rules themselves are a pending-approval default: v1.0 §12 and §20 reserve New Game+
 * carry-over and cycle rules for the design owner.
 */
export class NewGamePlus {
  private cycleNumber = 0;
  private variant: string | undefined;
  private startingChoice: string | undefined;
  private archetype: string | undefined;

  constructor(private readonly deps: NewGamePlusDeps) {}

  get cycle(): number { return this.cycleNumber; }
  get worldVariant(): string | undefined { return this.variant; }

  /** Check the options without starting a cycle. */
  validate(options: NewGamePlusOptions): Result<void, string> {
    const slots: readonly [string | undefined, LegacyUnlockCategory][] = [
      [options.startingChoice, 'startingChoice'],
      [options.archetype, 'archetype'],
      [options.worldVariant, 'worldVariant'],
    ];
    for (const [choice, category] of slots) {
      if (choice === undefined) continue;
      const unlock = this.deps.findUnlock(choice);
      if (!unlock) return err(`unknown Legacy unlock "${choice}"`);
      if (unlock.category !== category) return err(`${unlock.name} is not a ${category} option`);
      if (!this.deps.hasUnlock(choice)) return err(`Legacy unlock "${unlock.name}" is required`);
    }
    return ok(undefined);
  }

  begin(options: NewGamePlusOptions): Result<NewGamePlusSnapshot, string> {
    const valid = this.validate(options);
    if (!valid.ok) return valid;
    this.cycleNumber += 1;
    this.variant = options.worldVariant;
    this.startingChoice = options.startingChoice;
    this.archetype = options.archetype;
    return ok(this.snapshot());
  }

  snapshot(): NewGamePlusSnapshot {
    return {
      cycle: this.cycleNumber,
      ...(this.variant !== undefined ? { variant: this.variant } : {}),
      ...(this.startingChoice !== undefined ? { lastStartingChoice: this.startingChoice } : {}),
      ...(this.archetype !== undefined ? { lastArchetype: this.archetype } : {}),
    };
  }

  restore(snapshot: NewGamePlusSnapshot | undefined): void {
    this.cycleNumber = Math.max(0, Math.floor(snapshot?.cycle ?? 0));
    this.variant = snapshot?.variant;
    this.startingChoice = snapshot?.lastStartingChoice;
    this.archetype = snapshot?.lastArchetype;
  }
}
