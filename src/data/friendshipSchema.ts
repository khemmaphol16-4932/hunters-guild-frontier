import { ContentValidationError, expectNumber, expectObject, field } from './schema.js';

/** Friendship (REQ-HUN-012) and the trait-driven combat bonuses that sit beside it. */
export interface FriendshipBalance {
  /** Bond gained by two hunters who both came home from the same expedition. */
  readonly sharedExpedition: number;
  /** Bond gained when one hunter rescues another. */
  readonly rescue: number;
  /** Bond strength at which two hunters count as friends. */
  readonly friendThreshold: number;
  /** Outgoing power a hunter gains while a friend is fighting beside them. */
  readonly friendCombatBonus: number;
  /** Seconds of a fight after which Battle-Born's sustainedCombatBonus is at full strength. */
  readonly sustainedFullSeconds: number;
}

const FILE = 'balance/friendship.json';

function fraction(value: unknown, path: string): number {
  const n = expectNumber(value, path);
  if (n < 0 || n > 1) throw new ContentValidationError(path, 'must be between 0 and 1');
  return n;
}

export function parseFriendship(raw: unknown): FriendshipBalance {
  const o = expectObject(raw, FILE);
  const threshold = fraction(field(o, 'friendThreshold', FILE), `${FILE}.friendThreshold`);
  if (threshold === 0) throw new ContentValidationError(`${FILE}.friendThreshold`, 'a threshold of zero makes everyone friends');
  const seconds = expectNumber(field(o, 'sustainedFullSeconds', FILE), `${FILE}.sustainedFullSeconds`);
  if (seconds <= 0) throw new ContentValidationError(`${FILE}.sustainedFullSeconds`, 'must be positive');
  return {
    sharedExpedition: fraction(field(o, 'sharedExpedition', FILE), `${FILE}.sharedExpedition`),
    rescue: fraction(field(o, 'rescue', FILE), `${FILE}.rescue`),
    friendThreshold: threshold,
    friendCombatBonus: fraction(field(o, 'friendCombatBonus', FILE), `${FILE}.friendCombatBonus`),
    sustainedFullSeconds: seconds,
  };
}
