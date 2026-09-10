import { err, ok, type Result } from '../../core/result.js';

export interface NewGamePlusOptions {
  readonly startingChoice?: 'prepared_caravan';
  readonly archetype?: 'frontier_exile';
  readonly worldVariant?: 'long_winter';
  readonly mentorIds?: readonly string[];
}

export interface NewGamePlusSnapshot {
  readonly cycle: number;
  readonly variant?: string;
  readonly lastStartingChoice?: string;
  readonly lastArchetype?: string;
}

export class NewGamePlus {
  private cycleNumber = 0;
  private variant: string | undefined;
  private startingChoice: string | undefined;
  private archetype: string | undefined;

  constructor(private readonly hasUnlock: (id: string) => boolean) {}

  get cycle(): number { return this.cycleNumber; }
  get worldVariant(): string | undefined { return this.variant; }

  begin(options: NewGamePlusOptions): Result<NewGamePlusSnapshot, string> {
    for (const choice of [options.startingChoice, options.archetype, options.worldVariant]) {
      if (choice !== undefined && !this.hasUnlock(choice)) return err(`Legacy unlock "${choice}" is required`);
    }
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
