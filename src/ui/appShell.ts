/**
 * The top-level view switch.
 *
 * Four screens, because the loop has four halves and a hinge: the hunters you build, the
 * town they live in, the institution they belong to, and the field you send them to.
 * Planning is a different act from watching, and keeping the field apart stops the player
 * trying to intervene mid-expedition, which v1.0 §1 removes.
 *
 * Above the screens sit the two things that cross all of them: the notice feed
 * (REQ-UX-005 — critical notices interrupt as a banner, important ones raise a badge,
 * routine ones wait in the feed) and the Guild Report shown on return (REQ-UX-006).
 */

import type { Session } from '../app/Session.js';
import type { GuildCommands } from '../app/GuildCommands.js';
import { WorldView } from './worldView.js';
import { renderGuildReport } from './reportView.js';
import type { GuildReport } from '../app/GuildReport.js';
import { onPreferencesChanged, preferences, setPreference } from './preferences.js';
import { applyAccessibilityPreferences } from './a11y.js';
import { playNoticeCue } from './audio.js';
import { hintFor } from '../app/Guidance.js';


const el = (tag: string, className?: string, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export class AppShell {
  speed: 1 | 2 | 4 = 1;
  private readonly body: HTMLElement;
  private readonly nav: HTMLElement;
  private readonly alerts: HTMLElement;
  private readonly world: WorldView;
  private report: GuildReport | undefined;
  private feedOpen = false;
  private settingsOpen = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly session: Session,
    commands: GuildCommands,
  ) {
    this.nav = document.createElement('nav');
    this.nav.id = 'view-switch';
    this.nav.setAttribute('aria-label', 'Screens');

    this.alerts = document.createElement('div');
    this.alerts.id = 'alerts';

    this.body = document.createElement('main');
    this.body.id = 'view-body';

    // Opening or closing a drawer changes which screen's hint applies.
    this.world = new WorldView(this.body, session, commands, () => this.renderAlerts());

    applyAccessibilityPreferences();
    // Easy/Advanced changes what every screen says, so a change re-renders the current one.
    onPreferencesChanged(() => this.renderBody());

    // A critical notice raised by the live tick must interrupt even if nothing re-renders.
    session.notifications.subscribe((notice) => {
      playNoticeCue(notice.kind);
      if (notice.priority !== 'routine') {
        this.renderNav();
        this.renderAlerts();
      }
    });
  }

  mount(): void {
    this.root.replaceChildren(this.nav, this.alerts, this.body);
    this.renderNav();
    this.renderAlerts();
    this.renderBody();
  }

  /** Show a Guild Report above the current screen until the player dismisses it. */
  showReport(report: GuildReport): void {
    this.report = report;
    // Everything the report covers has been read in full there; do not interrupt with it again.
    this.session.notifications.markAllRead();
    this.renderNav();
    this.renderAlerts();
    this.renderBody();
  }

  /**
   * Re-render after time passed on its own (the live tick). Skipped while the player is in
   * the middle of using a control, so a tick never snatches a half-made choice away.
   */
  refresh(): void {
    const active = document.activeElement;
    // Each renderer replaces its region's children. Preserve the focused region so the
    // live clock cannot throw a keyboard user back to the document every few seconds.
    // Other regions still refresh, so the town and its notices do not appear frozen while
    // somebody is navigating the top bar or changing a setting.
    if (!active || !this.nav.contains(active)) this.renderNav();
    if (!active || !this.alerts.contains(active)) this.renderAlerts();
    if (
      !active ||
      !this.body.contains(active) ||
      !['SELECT', 'INPUT', 'TEXTAREA'].includes(active.tagName)
    ) {
      this.renderBody();
    }
  }

  private renderNav(): void {
    this.nav.replaceChildren();
    const brand = el('div', 'guild-brand');
    brand.append(el('span', 'guild-crest', '⚑'), el('span', undefined, 'HUNTER’S GUILD'), el('small', undefined, 'FRONTIER'));
    this.nav.append(brand);
    for (const [id, label] of [
      ['guild', 'Hunters'],
      ['hall', 'Guild affairs'],
    ] as const) {
      const button = el('button', '', label) as HTMLButtonElement;
      button.onclick = () => {
        this.world.open(id);
      };
      this.nav.append(button);
    }
    const time = el('div', 'time-controls');
    time.setAttribute('aria-label', 'Simulation speed');
    for (const speed of [1, 2, 4] as const) {
      const b = el('button', speed === this.speed ? 'active' : '', `${speed}×`) as HTMLButtonElement;
      b.setAttribute('aria-pressed', String(speed === this.speed));
      b.onclick = () => { this.speed = speed; this.renderNav(); };
      time.append(b);
    }
    this.nav.append(time);

    const count = this.session.notifications.badgeCount();
    const notices = el('button', `notices${this.feedOpen ? ' active' : ''}`, count > 0 ? `Notices (${count})` : 'Notices') as HTMLButtonElement;
    notices.setAttribute('aria-expanded', String(this.feedOpen));
    notices.setAttribute('aria-label', count > 0 ? `Notices, ${count} unread` : 'Notices');
    notices.onclick = () => {
      this.feedOpen = !this.feedOpen;
      this.renderNav();
      this.renderAlerts();
    };
    this.nav.append(notices);

    const settings = el('button', this.settingsOpen ? 'active' : '', 'Settings') as HTMLButtonElement;
    settings.setAttribute('aria-expanded', String(this.settingsOpen));
    settings.onclick = () => {
      this.settingsOpen = !this.settingsOpen;
      this.renderNav();
      this.renderAlerts();
    };
    this.nav.append(settings);
  }

  /** REQ-UX-002's Easy/Advanced switch, and the accessibility options. */
  private renderSettings(): HTMLElement {
    const panel = el('section', 'card settings-panel');
    panel.setAttribute('aria-label', 'Settings');
    panel.append(el('h3', undefined, 'Settings'));
    const prefs = preferences();

    const detail = el('fieldset', 'settings-group');
    detail.append(el('legend', undefined, 'How much of the AI to show'));
    for (const [value, label, hint] of [
      ['easy', 'Easy', 'Plain explanations of what the guild and its hunters decided.'],
      ['advanced', 'Advanced', 'Also the policy, constraints, reason codes and build numbers behind each decision.'],
    ] as const) {
      const option = el('label', 'settings-option');
      const radio = el('input') as HTMLInputElement;
      radio.type = 'radio';
      radio.name = 'detail';
      radio.checked = prefs.detail === value;
      radio.onchange = () => setPreference('detail', value);
      option.append(radio, document.createTextNode(` ${label} — ${hint}`));
      detail.append(option);
    }
    panel.append(detail);

    const access = el('fieldset', 'settings-group');
    access.append(el('legend', undefined, 'Accessibility'));
    for (const [key, label] of [
      ['largeText', 'Larger text'],
      ['highContrast', 'Higher contrast'],
      ['reducedMotion', 'Reduce motion'],
    ] as const) {
      const option = el('label', 'settings-option');
      const box = el('input') as HTMLInputElement;
      box.type = 'checkbox';
      box.checked = prefs[key];
      box.onchange = () => setPreference(key, box.checked);
      option.append(box, document.createTextNode(` ${label}`));
      access.append(option);
    }
    panel.append(access);

    const hints = el('button', 'small', 'Show dismissed hints again') as HTMLButtonElement;
    hints.disabled = prefs.dismissedHints.length === 0;
    hints.onclick = () => {
      setPreference('dismissedHints', []);
      this.renderAlerts();
    };
    panel.append(hints);
    return panel;
  }

  /** The interrupting banner for critical notices, and the feed when it is open. */
  private renderAlerts(): void {
    this.alerts.replaceChildren();
    const notifications = this.session.notifications;

    const critical = notifications.interrupting();
    if (critical.length > 0 && !this.feedOpen) {
      const banner = el('div', 'alert-banner');
      banner.setAttribute('role', 'alert');
      banner.append(el('span', undefined, critical[0]!.text));
      if (critical.length > 1) banner.append(el('span', 'meta', ` (+${critical.length - 1} more)`));
      const dismiss = el('button', 'small', 'Dismiss') as HTMLButtonElement;
      dismiss.onclick = () => {
        for (const notice of critical) notifications.markRead(notice.id);
        this.renderNav();
        this.renderAlerts();
      };
      banner.append(dismiss);
      this.alerts.append(banner);
    }

    if (this.settingsOpen) this.alerts.append(this.renderSettings());

    // REQ-UX-001: one hint, for what is on screen, about something that is true right now.
    // The first screen with a live hint wins, so the bare world shows one hint, not two.
    const dismissedHints = new Set(preferences().dismissedHints);
    const hint = this.report
      ? undefined
      : this.world.screens.map((screen) => hintFor(this.session, screen, dismissedHints)).find((h) => h !== undefined);
    if (hint) {
      const box = el('div', 'hint');
      box.setAttribute('role', 'note');
      box.append(el('span', undefined, hint.text));
      const got = el('button', 'small', 'Got it') as HTMLButtonElement;
      got.onclick = () => {
        setPreference('dismissedHints', [...preferences().dismissedHints, hint.id]);
        this.renderAlerts();
      };
      box.append(got);
      this.alerts.append(box);
    }

    if (this.feedOpen) {
      const feed = el('section', 'card notice-feed');
      feed.setAttribute('role', 'log');
      feed.setAttribute('aria-label', 'Notice feed');
      feed.append(el('h3', undefined, 'Notices'));
      const all = notifications.all();
      if (all.length === 0) feed.append(el('p', 'empty', 'Nothing yet.'));
      for (const notice of all.slice(0, 30)) {
        const line = el('p', `notice notice-${notice.priority}${notice.read ? '' : ' unread'}`, notice.text);
        feed.append(line);
      }
      const clear = el('button', 'small', 'Mark all read') as HTMLButtonElement;
      clear.onclick = () => {
        notifications.markAllRead();
        this.renderNav();
        this.renderAlerts();
      };
      feed.append(clear);
      this.alerts.append(feed);
    }
  }

  private renderBody(): void {
    if (this.report) {
      this.body.replaceChildren();
      const report = this.report;
      this.body.append(
        renderGuildReport(
          report,
          this.session.content.time.realSecondsPerStep,
          (id) => this.session.content.resourcesById.get(id)?.name ?? id,
          () => {
            this.report = undefined;
            this.renderBody();
          },
        ),
      );
      return;
    }
    this.world.render();
  }
}
