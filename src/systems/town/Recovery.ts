/**
 * How long a hunter is off the roster, and why.
 *
 * This repays a debt taken deliberately in Phase 3. `GuildCommands` carried two flat
 * constants — `INJURY_TICKS = 2000`, `RECOVERY_TICKS = 400` — and TECH_DEBT.md named Phase 6
 * as the trigger, because v1.0 §4 requires recovery to depend on *time + food + housing and
 * service quality + appropriate rest*, and §18 makes "recovery measurably varies with time,
 * food, housing/services, and rest" an acceptance criterion. A constant cannot vary.
 *
 * The maths is not new: `core/hunter/availability.recoveryRatePerStep` already modelled every
 * one of those terms, correctly, from Phase 2.5 onward. Nothing consumed it. That is worth
 * recording as its own lesson — an interface with a complete implementation and no caller is
 * indistinguishable from a stub, and the flat constants sat next to a working model for three
 * phases without anyone noticing they disagreed.
 *
 * The conversion is deliberately stated as *ratio against a baseline town*: a town at exactly
 * baseline housing, food and services heals an injury in `injuryStepsAtBaseline` steps, and
 * every term divides that. It makes the direction impossible to get wrong — better town,
 * fewer steps — and it means the balance file holds a number a designer can reason about
 * ("about forty steps") instead of a rate they cannot.
 */

import type { TownBalance } from '../../data/townSchema.js';
import type { TraitDef } from '../../data/schema.js';
import type { Hunter } from '../../core/hunter/Hunter.js';
import {
  BASELINE_RECOVERY,
  recoveryRatePerStep,
  type RecoveryInputs,
} from '../../core/hunter/availability.js';

export interface RecoveryEstimate {
  /** Coarse simulation steps until the hunter is ready. */
  readonly steps: number;
  /** The same duration in ticks, which is what `availability.readyAtTick` wants. */
  readonly ticks: number;
  /** Fatigue cleared per step under current conditions — the rate §18 asks to vary. */
  readonly ratePerStep: number;
  /** Player-readable, and it names the terms so the player can act on them. */
  readonly explanation: string;
  readonly inputs: RecoveryInputs;
}

export interface RecoveryDeps {
  readonly balance: TownBalance;
  readonly traitsById: ReadonlyMap<string, TraitDef>;
  /** Live town readings. Injected so Recovery never reaches into Town's internals. */
  readonly housingQuality: () => number;
  readonly serviceQuality: () => number;
  readonly foodAvailable: () => boolean;
  /**
   * What research has done for the infirmary (REQ-RES-001).
   *
   * Folded into the trait multiplier rather than given its own term, because it answers the
   * same question a trait does — how fast does this recovery *go* — and adding a parallel
   * term would mean two places to look when a duration surprises someone.
   */
  readonly researchScale?: () => number;
  /**
   * Fine ticks per coarse step, read from the simulation clock.
   *
   * Injected rather than taken from balance data because DL-020 makes the coarse cadence a
   * property of the clock — a second copy in a balance file is exactly the drift that
   * decision exists to prevent, and the two had already diverged (50 here against the
   * clock's 20) before anything noticed.
   */
  readonly ticksPerStep: () => number;
}

export class Recovery {
  constructor(private readonly deps: RecoveryDeps) {}

  /** The trait multiplier a hunter brings to their own recovery, e.g. Tireless. */
  traitMultiplier(hunter: Hunter): number {
    let multiplier = 1;
    for (const traitId of hunter.traitIds) {
      const effect = this.deps.traitsById.get(traitId)?.effects['fatigueRecoveryMultiplier'];
      if (typeof effect === 'number') multiplier *= effect;
    }
    return multiplier;
  }

  /** Everything recovery depends on, gathered from the hunter and the town. */
  inputsFor(hunter: Hunter): RecoveryInputs {
    return {
      ...BASELINE_RECOVERY,
      fatigue: hunter.condition.fatigue,
      hunger: hunter.condition.hunger,
      housingQuality: this.deps.housingQuality(),
      serviceQuality: this.deps.serviceQuality(),
      foodAvailable: this.deps.foodAvailable(),
      traitMultiplier: this.traitMultiplier(hunter) * (this.deps.researchScale?.() ?? 1),
    };
  }

  /**
   * Fatigue an idle hunter sheds per coarse step, just by being in the town.
   *
   * This closes a hole the injury path hid. `estimate` answers "how long is this hunter off
   * the roster", which only ever applied to somebody `injured` or `recovering` — so a hunter
   * who was *available* and doing town work accumulated fatigue every outing and shed none,
   * ever. Two hunters reached fatigue 1.0 in a browser session and became permanently
   * unemployable: above the work ceiling, so off the rota; not injured, so never resting.
   *
   * v1.0 §4 makes recovery a function of time, food, housing and rest, and none of those
   * clauses say "only if wounded". Everyone in town recovers; town work adds fatigue on top;
   * the balance between the two is what makes a work rota sustainable or not.
   */
  restPerStep(hunter: Hunter): number {
    return recoveryRatePerStep(
      this.inputsFor(hunter),
      this.deps.balance.recovery.baseFatigueClearedPerStep,
    );
  }

  /**
   * How long until this hunter is deployable again.
   *
   * `injured` picks which baseline applies: an injury is a longer stay than an ordinary
   * return, and both are shortened by the same town terms. Clamped at both ends so a
   * gloriously overbuilt town cannot produce a zero-step injury and a failing one cannot
   * produce an infinite sentence.
   */
  estimate(hunter: Hunter, options: { readonly injured: boolean }): RecoveryEstimate {
    const config = this.deps.balance.recovery;
    const inputs = this.inputsFor(hunter);

    const ratePerStep = recoveryRatePerStep(inputs, config.baseFatigueClearedPerStep);
    const baselineRate = recoveryRatePerStep(
      { ...BASELINE_RECOVERY, fatigue: inputs.fatigue, hunger: 0 },
      config.baseFatigueClearedPerStep,
    );

    const baselineSteps = options.injured
      ? config.injuryStepsAtBaseline
      : config.recoveryStepsAtBaseline;

    // Ratio against baseline: a town twice as good heals in half the steps.
    const scale = ratePerStep <= 0 ? config.maxSteps : baselineRate / ratePerStep;
    const steps = Math.min(
      config.maxSteps,
      Math.max(config.minSteps, Math.round(baselineSteps * scale)),
    );

    return {
      steps,
      ticks: steps * this.deps.ticksPerStep(),
      ratePerStep,
      explanation: this.explain(hunter, inputs, steps, options.injured),
      inputs,
    };
  }

  /**
   * Why it will take that long.
   *
   * REQ-UX-004's "the player can always find out why" applied to the least dramatic system
   * in the game. A hunter who is out for eighty steps instead of forty should be able to tell
   * the player it is because nobody built a cookhouse.
   */
  private explain(
    hunter: Hunter,
    inputs: RecoveryInputs,
    steps: number,
    injured: boolean,
  ): string {
    const notes: string[] = [];

    if (!inputs.foodAvailable) notes.push('the town cannot feed everyone');
    else if (inputs.hunger > 0.4) notes.push('they came back hungry');

    if (inputs.housingQuality < 0.9) notes.push('there is nowhere decent to sleep');
    else if (inputs.housingQuality > 1.2) notes.push('the housing is good');

    if (inputs.serviceQuality < 0.9) notes.push('the town has few comforts');
    else if (inputs.serviceQuality > 1.2) notes.push('the infirmary and baths help');

    // Read from the hunter rather than from `inputs.traitMultiplier`, which now also carries
    // the research scale — attributing the guild's medical knowledge to someone's
    // constitution would be a small lie in exactly the sentence meant to explain things.
    const traits = this.traitMultiplier(hunter);
    if (traits > 1.05) notes.push(`${hunter.name} recovers quickly`);
    else if (traits < 0.95) notes.push(`${hunter.name} recovers slowly`);

    if ((this.deps.researchScale?.() ?? 1) > 1.05) notes.push('the guild knows its medicine');

    const what = injured ? 'Injured' : 'Recovering';
    const because = notes.length > 0 ? ` — ${notes.join(', ')}` : '';
    return `${what} for about ${steps} step${steps === 1 ? '' : 's'}${because}.`;
  }
}
