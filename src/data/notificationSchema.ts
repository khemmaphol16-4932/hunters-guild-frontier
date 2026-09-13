import { ContentValidationError, expectEnum, expectNumber, expectObject, field } from './schema.js';

export const NOTIFICATION_PRIORITIES = ['critical', 'important', 'routine'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export const NOTIFICATION_KINDS = [
  'hunterDied',
  'townBreached',
  'worldBossAppeared',
  'legendaryFound',
  'stageReached',
  'researchCompleted',
  'contractResolved',
  'worldBossDefeated',
  'endlessRecord',
  'rareFound',
  'frontierEntered',
  'townDefended',
  'hunterLeveled',
  'rescue',
  'bossDefeated',
  'partyReturned',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationRules {
  readonly feedSize: number;
  readonly priorities: Readonly<Record<NotificationKind, NotificationPriority>>;
}

const FILE = 'ui/notifications.json';

export function parseNotifications(raw: unknown): NotificationRules {
  const o = expectObject(raw, FILE);
  const feedSize = expectNumber(field(o, 'feedSize', FILE), `${FILE}.feedSize`);
  if (!Number.isInteger(feedSize) || feedSize < 1) throw new ContentValidationError(`${FILE}.feedSize`, 'must be a positive whole number');
  const p = expectObject(field(o, 'priorities', FILE), `${FILE}.priorities`);
  const priorities = {} as Record<NotificationKind, NotificationPriority>;
  // Every kind must be classified: an unclassified event would be a notification nobody
  // decided the importance of, which is the one thing REQ-UX-005 asks to be decided.
  for (const kind of NOTIFICATION_KINDS) {
    priorities[kind] = expectEnum(field(p, kind, `${FILE}.priorities`), `${FILE}.priorities.${kind}`, NOTIFICATION_PRIORITIES);
  }
  for (const key of Object.keys(p)) {
    if (!key.startsWith('$') && !(NOTIFICATION_KINDS as readonly string[]).includes(key)) {
      throw new ContentValidationError(`${FILE}.priorities.${key}`, 'is not a notification kind the game raises');
    }
  }
  return { feedSize, priorities };
}
