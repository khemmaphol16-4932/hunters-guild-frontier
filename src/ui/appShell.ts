/**
 * The top-level view switch.
 *
 * Two screens, because the loop has two halves: the guild you build, and the field you send
 * it to. Keeping them apart rather than adding a panel to the dashboard reflects the design
 * — planning is a different act from watching, and mixing them invites the player to try to
 * intervene mid-expedition, which is exactly what v1.0 §1 removes.
 */

import type { Session } from '../app/Session.js';
import type { GuildCommands } from '../app/GuildCommands.js';
import { BuildDashboard } from './buildDashboard.js';
import { ExpeditionView } from './expeditionView.js';
import { TownView } from './townView.js';
import { HallView } from './hallView.js';

type ViewId = 'guild' | 'town' | 'hall' | 'field';

export class AppShell {
  private view: ViewId = 'guild';
  private readonly body: HTMLElement;
  private readonly nav: HTMLElement;
  private readonly dashboard: BuildDashboard;
  private readonly town: TownView;
  private readonly hall: HallView;
  private readonly expedition: ExpeditionView;

  constructor(
    private readonly root: HTMLElement,
    session: Session,
    commands: GuildCommands,
  ) {
    this.nav = document.createElement('nav');
    this.nav.id = 'view-switch';

    this.body = document.createElement('div');
    this.body.id = 'view-body';

    this.dashboard = new BuildDashboard(this.body, session, commands);
    this.town = new TownView(this.body, session, commands);
    this.hall = new HallView(this.body, session, commands);
    this.expedition = new ExpeditionView(this.body, session, commands);
  }

  mount(): void {
    this.root.replaceChildren(this.nav, this.body);
    this.renderNav();
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
      const button = document.createElement('button');
      button.textContent = label;
      button.className = this.view === id ? 'active' : '';
      button.onclick = () => {
        this.view = id;
        this.renderNav();
        this.renderBody();
      };
      this.nav.append(button);
    }
  }

  private renderBody(): void {
    this.body.replaceChildren();
    if (this.view === 'guild') this.dashboard.mount();
    else if (this.view === 'town') this.town.render();
    else if (this.view === 'hall') this.hall.render();
    else this.expedition.render();
  }
}
