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
import { BuildDashboard } from './buildDashboard.js';
import { ExpeditionView } from './expeditionView.js';
import { TownView } from './townView.js';
import { HallView } from './hallView.js';
import { renderGuildReport } from './reportView.js';
import type { GuildReport } from '../app/GuildReport.js';

type ViewId = 'guild' | 'town' | 'hall' | 'field';

const el = (tag: string, className?: string, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export class AppShell {
  private view: ViewId = 'guild';
  private readonly body: HTMLElement;
  private readonly nav: HTMLElement;
  private readonly alerts: HTMLElement;
  private readonly dashboard: BuildDashboard;
  private readonly town: TownView;
  private readonly hall: HallView;
  private readonly expedition: ExpeditionView;
  private report: GuildReport | undefined;
  private feedOpen = false;

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

    this.dashboard = new BuildDashboard(this.body, session, commands);
    this.town = new TownView(this.body, session, commands);
    this.hall = new HallView(this.body, session, commands);
    this.expedition = new ExpeditionView(this.body, session, commands);

    // A critical notice raised by the live tick must interrupt even if nothing re-renders.
    session.notifications.subscribe((notice) => {
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
    this.renderNav();
    this.renderAlerts();
    const active = document.activeElement;
    if (active && this.body.contains(active) && ['SELECT', 'INPUT', 'TEXTAREA'].includes(active.tagName)) return;
    this.renderBody();
  }

  private renderNav(): void {
    this.nav.replaceChildren();
    for (const [id, label] of [
      ['guild', 'The Guild'],
      ['town', 'The Town'],
      ['hall', 'The Hall'],
      ['field', 'The Field'],
    ] as const) {
      const button = el('button', this.view === id ? 'active' : '', label) as HTMLButtonElement;
      if (this.view === id) button.setAttribute('aria-current', 'page');
      button.onclick = () => {
        this.view = id;
        this.renderNav();
        this.renderBody();
      };
      this.nav.append(button);
    }

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
    this.body.replaceChildren();
    if (this.report) {
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
    if (this.view === 'guild') this.dashboard.mount();
    else if (this.view === 'town') this.town.render();
    else if (this.view === 'hall') this.hall.render();
    else this.expedition.render();
  }
}
