/**
 * Accessibility helpers (Phase 9).
 *
 * Most controls in the UI are real buttons and selects, which the browser already makes
 * keyboard-operable. A few are rows the player clicks — a hunter in the roster, a node in a
 * route report — and those were mouse-only. `activatable` gives such a row a button's role,
 * a place in the tab order, and Enter/Space activation, with Shift carried through so
 * "shift-click to compare" has a keyboard form too.
 */

import { onPreferencesChanged, preferences, type Preferences } from './preferences.js';

export function activatable(
  node: HTMLElement,
  onActivate: (event: { readonly shiftKey: boolean }) => void,
  label?: string,
): void {
  node.setAttribute('role', 'button');
  node.tabIndex = 0;
  if (label) node.setAttribute('aria-label', label);
  node.onclick = (event) => onActivate(event);
  node.onkeydown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate(event);
    }
  };
}

/** Reflect the accessibility preferences as classes on the document, now and on change. */
export function applyAccessibilityPreferences(root: HTMLElement = document.documentElement): void {
  const apply = (prefs: Preferences) => {
    root.classList.toggle('large-text', prefs.largeText);
    root.classList.toggle('high-contrast', prefs.highContrast);
    root.classList.toggle('reduced-motion', prefs.reducedMotion);
  };
  apply(preferences());
  onPreferencesChanged(apply);
}
