/**
 * Progressive disclosure (REQ-UX-001): the game teaches through play.
 *
 * A hint appears on the screen it belongs to, while the situation it explains is actually in
 * front of the player, until they dismiss it — and a screen shows one hint at a time. There
 * is no sequence to click through and nothing is explained before it matters: the walls hint
 * appears when the walls are empty, not on the first screen of a new save.
 *
 * Reads the game; writes nothing. Which hints a player has dismissed is a viewer preference
 * and is passed in by the UI.
 */

import type { Session } from './Session.js';
import type { GuidanceCondition, GuidanceScreen, HintDef } from '../data/guidanceSchema.js';
import { unspentAttributePoints } from '../core/hunter/Hunter.js';

type Evaluator = (session: Session) => boolean;

const CONDITIONS: Readonly<Record<GuidanceCondition, Evaluator>> = {
  noExpeditionsYet: (s) => s.roster.all().every((h) => s.chronicle.counter(h.id, 'expeditions') === 0),
  unspentAttributePoints: (s) => s.roster.all().some((h) => unspentAttributePoints(h, s.content.balance.attributes) > 0),
  sameClassPair: (s) => {
    const seen = new Set<string>();
    for (const hunter of s.roster.all()) {
      if (seen.has(hunter.archetype)) return true;
      seen.add(hunter.archetype);
    }
    return false;
  },
  townUnderPressure: (s) => s.population.report().pressures.some((p) => p.pressure > 0.2),
  noDefence: (s) => s.town.grid.size > 0 && s.town.capacity().defence === 0,
  foodShort: (s) => s.food.fedFraction < 1,
  noStandingOrder: (s) => s.standingOrders.order === undefined && s.roster.size > 0,
  contractsAvailable: (s) => s.contracts.active() === undefined,
  legacyPointsAvailable: (s) => s.legacy.points > 0,
};

export function hintFor(
  session: Session,
  screen: GuidanceScreen,
  dismissed: ReadonlySet<string>,
): HintDef | undefined {
  return session.content.guidance.find(
    (hint) => hint.screen === screen && !dismissed.has(hint.id) && CONDITIONS[hint.when](session),
  );
}
