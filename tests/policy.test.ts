/**
 * The decision pipeline's structural guarantee.
 *
 * REQ-POL-002/004, risk R3. The point of these tests is not that the pipeline computes
 * scores correctly — it is that a hard constraint cannot be outvoted, however attractive
 * the forbidden action looks. That property must hold by construction, not by tuning.
 */

import { describe, expect, it } from 'vitest';
import {
  DecisionPipeline,
  basePriorityStage,
  hardConstraintStage,
  type Candidate,
  type FilterStage,
  type HardConstraint,
  type WeightStage,
} from '../src/ai/policy/pipeline.js';

interface Action extends Candidate {
  readonly id: string;
  readonly kind: 'attack' | 'retreat' | 'heal';
  readonly basePriority: number;
  readonly requiresMelee: boolean;
}

interface Context {
  readonly retreatRequired: boolean;
  readonly canFightInMelee: boolean;
}

const actions: Action[] = [
  { id: 'charge', kind: 'attack', basePriority: 100, requiresMelee: true },
  { id: 'snipe', kind: 'attack', basePriority: 60, requiresMelee: false },
  { id: 'fall-back', kind: 'retreat', basePriority: 10, requiresMelee: false },
  { id: 'mend', kind: 'heal', basePriority: 40, requiresMelee: false },
];

/** REQ-POL-005: a required retreat threshold is a hard constraint. */
const retreatConstraint: HardConstraint<Action, Context> = {
  id: 'retreat-threshold',
  describe: 'Guild policy requires retreat below the configured threshold',
  permits: (candidate, context) => !context.retreatRequired || candidate.kind === 'retreat',
};

const capabilityFilter: FilterStage<Action, Context> = {
  name: 'capability',
  permits: (candidate, context) => !candidate.requiresMelee || context.canFightInMelee,
  reason: (candidate) => `${candidate.id} needs a melee-capable build`,
};

/** A weight stage that loves exactly the action policy forbids. */
const recklessUtility: WeightStage<Action, Context> = {
  name: 'utility',
  weigh: (candidate) => (candidate.kind === 'attack' ? 10_000 : 0),
};

function buildPipeline(): DecisionPipeline<Action, Context> {
  return new DecisionPipeline<Action, Context>({
    filters: [hardConstraintStage([retreatConstraint]), capabilityFilter],
    weights: [basePriorityStage<Action, Context>(), recklessUtility],
  });
}

describe('hard constraints always win (REQ-POL-004)', () => {
  it('cannot be outscored by an enormous utility value', () => {
    const decision = buildPipeline().evaluate(actions, {
      retreatRequired: true,
      canFightInMelee: true,
    });

    expect(decision.chosen?.kind).toBe('retreat');
    // The forbidden actions were never scored at all.
    expect(decision.scored.every((s) => s.candidate.kind === 'retreat')).toBe(true);
  });

  it('explains which constraint rejected each candidate', () => {
    const decision = buildPipeline().evaluate(actions, {
      retreatRequired: true,
      canFightInMelee: true,
    });

    const rejection = decision.rejected.find((r) => r.candidate.id === 'charge');
    expect(rejection?.stage).toBe('hardConstraints');
    expect(rejection?.reason).toMatch(/requires retreat/);
  });

  it('refuses to build a pipeline whose first stage is not the hard constraints', () => {
    expect(
      () =>
        new DecisionPipeline<Action, Context>({
          filters: [capabilityFilter, hardConstraintStage([retreatConstraint])],
          weights: [],
        }),
    ).toThrow(/hard constraints must be the first filter stage/);
  });

  it('reports when everything was filtered out rather than improvising', () => {
    const pipeline = new DecisionPipeline<Action, Context>({
      filters: [
        hardConstraintStage([
          { id: 'forbid-all', describe: 'nothing is permitted', permits: () => false },
        ]),
      ],
      weights: [basePriorityStage<Action, Context>()],
    });

    const decision = pipeline.evaluate(actions, { retreatRequired: false, canFightInMelee: true });
    expect(decision.chosen).toBeUndefined();
    expect(decision.allRejected).toBe(true);
  });
});

describe('capability filtering (REQ-POL-002 step 3)', () => {
  it('removes actions the build cannot perform', () => {
    // Conflict A6: party strategy cannot force a hunter into a role its build cannot do.
    const decision = buildPipeline().evaluate(actions, {
      retreatRequired: false,
      canFightInMelee: false,
    });

    expect(decision.chosen?.id).toBe('snipe');
    expect(decision.rejected.find((r) => r.candidate.id === 'charge')?.stage).toBe('capability');
  });

  it('lets the best capable action win when nothing is forbidden', () => {
    const decision = buildPipeline().evaluate(actions, {
      retreatRequired: false,
      canFightInMelee: true,
    });
    expect(decision.chosen?.id).toBe('charge');
  });
});

describe('weights reorder but never resurrect', () => {
  it('records each stage’s contribution for the advanced AI view (REQ-UX-002)', () => {
    const decision = buildPipeline().evaluate(actions, {
      retreatRequired: false,
      canFightInMelee: true,
    });

    const top = decision.scored[0];
    expect(top?.contributions['basePriority']).toBe(100);
    expect(top?.contributions['utility']).toBe(10_000);
    expect(top?.score).toBe(10_100);
  });

  it('orders survivors by score, highest first', () => {
    const decision = buildPipeline().evaluate(actions, {
      retreatRequired: false,
      canFightInMelee: true,
    });
    const scores = decision.scored.map((s) => s.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('never scores a filtered candidate', () => {
    const decision = buildPipeline().evaluate(actions, {
      retreatRequired: true,
      canFightInMelee: true,
    });
    const scoredIds = new Set(decision.scored.map((s) => s.candidate.id));
    for (const rejection of decision.rejected) {
      expect(scoredIds.has(rejection.candidate.id)).toBe(false);
    }
  });

  it('handles an empty candidate set without claiming everything was rejected', () => {
    const decision = buildPipeline().evaluate([], {
      retreatRequired: false,
      canFightInMelee: true,
    });
    expect(decision.chosen).toBeUndefined();
    expect(decision.allRejected).toBe(false);
  });
});
