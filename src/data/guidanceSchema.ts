import { ContentValidationError, assertUniqueIds, expectArray, expectEnum, expectObject, expectString, field } from './schema.js';

export const GUIDANCE_SCREENS = ['guild', 'town', 'hall', 'field'] as const;
export type GuidanceScreen = (typeof GUIDANCE_SCREENS)[number];

/** Every condition a hint may name. Each has an evaluator in app/Guidance.ts. */
export const GUIDANCE_CONDITIONS = [
  'noExpeditionsYet',
  'unspentAttributePoints',
  'sameClassPair',
  'townUnderPressure',
  'noDefence',
  'foodShort',
  'noStandingOrder',
  'contractsAvailable',
  'legacyPointsAvailable',
] as const;
export type GuidanceCondition = (typeof GUIDANCE_CONDITIONS)[number];

export interface HintDef {
  readonly id: string;
  readonly screen: GuidanceScreen;
  readonly when: GuidanceCondition;
  readonly text: string;
}

const FILE = 'ui/guidance.json';

export function parseGuidance(raw: unknown): readonly HintDef[] {
  const o = expectObject(raw, FILE);
  const hints = expectArray(field(o, 'hints', FILE), `${FILE}.hints`).map((value, i): HintDef => {
    const p = `${FILE}.hints[${i}]`;
    const h = expectObject(value, p);
    const text = expectString(field(h, 'text', p), `${p}.text`);
    // REQ-UX-001 forbids a tutorial dump; a hint that needs a paragraph is a manual page.
    if (text.length > 220) throw new ContentValidationError(`${p}.text`, 'a hint should be a sentence or two, not a manual page');
    return {
      id: expectString(field(h, 'id', p), `${p}.id`),
      screen: expectEnum(field(h, 'screen', p), `${p}.screen`, GUIDANCE_SCREENS),
      when: expectEnum(field(h, 'when', p), `${p}.when`, GUIDANCE_CONDITIONS),
      text,
    };
  });
  assertUniqueIds(hints.map((h) => h.id), `${FILE}.hints`);
  return hints;
}
