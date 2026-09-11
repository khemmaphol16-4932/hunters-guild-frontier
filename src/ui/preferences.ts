/**
 * Per-player UI preferences: how much of the AI's reasoning to show (REQ-UX-002), and the
 * accessibility settings.
 *
 * These are about the *viewer*, not the guild, so they live in the browser's own storage and
 * never in the save: two people sharing a save should each see the game the way they asked
 * to. Every read and write is guarded, because storage can be unavailable (private windows,
 * blocked site data) and a preference must never be the thing that stops the game loading.
 */

export type DetailLevel = 'easy' | 'advanced';

export interface Preferences {
  /** REQ-UX-002: plain explanations, or the policy, constraints and utility behind them. */
  readonly detail: DetailLevel;
  /** Larger type throughout. */
  readonly largeText: boolean;
  /** Stronger contrast for text and borders. */
  readonly highContrast: boolean;
  /** No transitions or animated emphasis. */
  readonly reducedMotion: boolean;
  /** Hints the player has dismissed (REQ-UX-001). */
  readonly dismissedHints: readonly string[];
}

const KEY = 'hgf.preferences';
const DEFAULTS: Preferences = { detail: 'easy', largeText: false, highContrast: false, reducedMotion: false, dismissedHints: [] };

let current: Preferences = load();
const listeners = new Set<(prefs: Preferences) => void>();

function load(): Preferences {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      detail: parsed.detail === 'advanced' ? 'advanced' : 'easy',
      largeText: parsed.largeText === true,
      highContrast: parsed.highContrast === true,
      reducedMotion: parsed.reducedMotion === true,
      dismissedHints: Array.isArray(parsed.dismissedHints) ? parsed.dismissedHints.filter((h): h is string => typeof h === 'string') : [],
    };
  } catch {
    return DEFAULTS;
  }
}

export function preferences(): Preferences {
  return current;
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  current = { ...current, [key]: value };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage unavailable: the preference still applies for this visit.
  }
  for (const listener of listeners) listener(current);
}

export function onPreferencesChanged(listener: (prefs: Preferences) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
