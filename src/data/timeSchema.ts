import { ContentValidationError, expectNumber, expectObject, field } from './schema.js';

/** How simulation time maps onto real time, live and offline (REQ-OFF-001). */
export interface TimeBalance {
  readonly realSecondsPerStep: number;
  readonly maxOfflineHours: number;
  readonly catchUpChunkSteps: number;
  /** A live-clock gap at least this many steps long is an absence, caught up with a report. */
  readonly absenceSteps: number;
}

const FILE = 'balance/time.json';

export function parseTime(raw: unknown): TimeBalance {
  const o = expectObject(raw, FILE);
  const positive = (key: keyof TimeBalance): number => {
    const n = expectNumber(field(o, key, FILE), `${FILE}.${key}`);
    if (n <= 0) throw new ContentValidationError(`${FILE}.${key}`, 'must be positive');
    return n;
  };
  const maxOfflineHours = positive('maxOfflineHours');
  if (maxOfflineHours > 72) {
    throw new ContentValidationError(`${FILE}.maxOfflineHours`, 'REQ-OFF-001 caps offline progress at three days');
  }
  const chunk = positive('catchUpChunkSteps');
  if (!Number.isInteger(chunk)) throw new ContentValidationError(`${FILE}.catchUpChunkSteps`, 'must be a whole number of steps');
  const absence = positive('absenceSteps');
  if (!Number.isInteger(absence)) throw new ContentValidationError(`${FILE}.absenceSteps`, 'must be a whole number of steps');
  return { realSecondsPerStep: positive('realSecondsPerStep'), maxOfflineHours, catchUpChunkSteps: chunk, absenceSteps: absence };
}
