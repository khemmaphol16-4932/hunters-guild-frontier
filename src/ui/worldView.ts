/** World-first viewport. Scene locations show facilities and assignments, not invented travel. */
import type { Session } from '../app/Session.js';
import type { GuildCommands } from '../app/GuildCommands.js';
import type { HunterId } from '../core/ids.js';
import { describeAvailability } from '../core/hunter/availability.js';
import { TownView } from './townView.js';
import { ExpeditionView } from './expeditionView.js';
import { HallView } from './hallView.js';
import { BuildDashboard } from './buildDashboard.js';

const el = (tag: string, cls = '', text?: string): HTMLElement => {
  const n = document.createElement(tag); n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const button = (label: string, action: () => void, cls = ''): HTMLButtonElement => {
  const b = el('button', cls, label) as HTMLButtonElement; b.type = 'button'; b.onclick = action; return b;
};
type Panel = 'build' | 'frontier' | 'hall' | 'guild' | undefined;

export class WorldView {
  private selected: HunterId | undefined;
  private x = 0;
  private y = 0;
  private zoom = 1;
  private readonly drawer = el('aside', 'world-drawer');
  private readonly panelBody = el('div', 'world-drawer-body');
  private readonly scene = el('div', 'frontier-scene');
  private readonly viewport = el('section', 'world-viewport');
  private readonly inspector = el('aside', 'hunter-inspector');
  private readonly resourceBar = el('div', 'resource-bar');
  private readonly roster = el('div', 'hunter-dock');
  private readonly town: TownView;
  private readonly frontier: ExpeditionView;
  private readonly hall: HallView;
  private readonly guild: BuildDashboard;
  private readonly layout = el('div', 'world-workspace');
  private returnFocus: HTMLElement | null = null;

  constructor(private readonly host: HTMLElement, private readonly session: Session, commands: GuildCommands) {
    this.town = new TownView(this.panelBody, session, commands);
    this.frontier = new ExpeditionView(this.panelBody, session, commands);
    this.hall = new HallView(this.panelBody, session, commands);
    this.guild = new BuildDashboard(this.panelBody, session, commands);
    this.viewport.tabIndex = 0;
    this.viewport.setAttribute('aria-label', 'Hunter City map. Drag to pan. Arrow keys pan; plus and minus zoom.');
    this.viewport.append(this.scene);
    let drag: { x: number; y: number; px: number; py: number } | undefined;
    this.viewport.onpointerdown = (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      drag = { x: e.clientX, y: e.clientY, px: this.x, py: this.y };
      this.viewport.setPointerCapture(e.pointerId);
    };
    this.viewport.onpointermove = (e) => {
      if (!drag) return;
      this.x = drag.px + e.clientX - drag.x; this.y = drag.py + e.clientY - drag.y; this.transform();
    };
    this.viewport.onpointerup = this.viewport.onpointercancel = () => { drag = undefined; };
    this.viewport.onkeydown = (e) => {
      if (e.target !== this.viewport) return;
      if (e.key === '+' || e.key === '=') this.changeZoom(.15);
      else if (e.key === '-') this.changeZoom(-.15);
      else if (e.key === 'ArrowLeft') this.x += 40;
      else if (e.key === 'ArrowRight') this.x -= 40;
      else if (e.key === 'ArrowUp') this.y += 40;
      else if (e.key === 'ArrowDown') this.y -= 40;
      else return;
      e.preventDefault(); this.transform();
    };
    this.viewport.addEventListener('wheel', (e) => {
      e.preventDefault(); this.changeZoom(e.deltaY < 0 ? .08 : -.08);
    }, { passive: false });
    const location = el('div', 'location-plaque');
    location.append(el('span', 'eyebrow', 'YOUR GUILD · YOUR FRONTIER'), el('h1', '', 'Hunter City'), el('p', '', 'A place worth coming home to.'));
    const tools = el('div', 'world-tools');
    tools.setAttribute('aria-label', 'World management');
    for (const [id, icon, label] of [['build', '⌂', 'Build & town'], ['guild', '♙', 'Hunters'], ['hall', '⚑', 'Guild affairs'], ['frontier', '⌁', 'Expeditions']] as const) {
      const b = button('', () => this.open(id));
      b.append(el('span', 'tool-icon', icon), el('span', '', label)); tools.append(b);
    }
    const camera = el('div', 'camera-tools');
    camera.append(button('−', () => this.changeZoom(-.15)), button('Center town', () => { this.x = 0; this.y = 0; this.zoom = 1; this.transform(); }), button('+', () => this.changeZoom(.15)));
    camera.firstElementChild?.setAttribute('aria-label', 'Zoom out'); camera.lastElementChild?.setAttribute('aria-label', 'Zoom in');
    const guide = el('div', 'map-guide', 'Drag to explore · Scroll to zoom · Select a building or hunter');
    this.layout.append(this.viewport, location, this.resourceBar, tools, camera, guide, this.roster, this.inspector, this.drawer);
    this.drawer.hidden = true; this.inspector.hidden = true;
    this.layout.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.close(); this.selected = undefined; this.renderInspector(); } });
  }

  render(): void {
    if (!this.host.contains(this.layout)) this.host.replaceChildren(this.layout);
    this.refresh();
  }

  refresh(): void {
    this.resourceBar.replaceChildren();
    for (const [label, value] of [['Gold', Math.floor(this.session.resources.amount('gold')).toLocaleString()], ['Provisions', Math.floor(this.session.resources.amount('food')).toLocaleString()], ['Materials', Math.floor(this.session.resources.amount('materials')).toLocaleString()], ['Residents', String(this.session.population.report().population)]] as const) {
      const stat = el('div', 'resource'); stat.append(el('span', '', label), el('strong', '', value)); this.resourceBar.append(stat);
    }
    // Do not remove a focused map button on an autonomous tick.
    if (!this.scene.contains(document.activeElement)) this.renderScene();
    if (!this.roster.contains(document.activeElement)) this.renderRoster();
    if (!this.inspector.contains(document.activeElement)) this.renderInspector();
    // Keep focused forms and scroll positions intact. Existing panels refresh through their actions.
  }

  open(panel: Exclude<Panel, undefined>): void {
    this.returnFocus = document.activeElement as HTMLElement | null;
    const title = { build: 'Build & town', frontier: 'Expeditions', hall: 'Guild affairs', guild: 'Hunters' }[panel];
    const head = el('div', 'drawer-heading');
    head.append(el('h2', '', title), button('Close ×', () => this.close()));
    this.drawer.replaceChildren(head, this.panelBody); this.drawer.hidden = false;
    this.drawer.setAttribute('aria-label', title);
    if (panel === 'build') this.town.render();
    else if (panel === 'frontier') this.frontier.render();
    else if (panel === 'hall') this.hall.render();
    else this.guild.mount();
    this.panelBody.scrollTop = 0;
    (head.querySelector('button') as HTMLButtonElement).focus();
  }

  private close(): void {
    this.drawer.hidden = true; this.refresh();
    if (this.returnFocus?.isConnected) this.returnFocus.focus(); else this.viewport.focus();
  }

  private transform(): void {
    this.x = Math.max(-850, Math.min(850, this.x)); this.y = Math.max(-550, Math.min(550, this.y));
    this.scene.style.transform = `translate(calc(-50% + ${this.x}px), calc(-50% + ${this.y}px)) scale(${this.zoom})`;
  }
  private changeZoom(delta: number): void { this.zoom = Math.min(1.8, Math.max(.55, this.zoom + delta)); this.transform(); }

  private renderScene(): void {
    this.scene.replaceChildren();
    const land = el('div', 'landscape');
    // Authored scenery is presentation only: no decorative NPCs or pretend simulated roads.
    land.innerHTML = `<svg viewBox="0 0 1600 1000" aria-hidden="true"><defs><pattern id="grass" width="60" height="40" patternUnits="userSpaceOnUse"><path d="M8 16l3-4 2 4M39 29l2-4 3 4" stroke="#82905b" stroke-width="1" fill="none" opacity=".32"/></pattern><linearGradient id="land" x2=".3" y2="1"><stop stop-color="#415845"/><stop offset="1" stop-color="#859061"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#land)"/><rect width="1600" height="1000" fill="url(#grass)"/><path d="M1280 -50C1150 180 1530 210 1340 380S1140 580 1400 760L1610 1010" stroke="#a1baa4" stroke-width="110" fill="none"/><path d="M1280 -50C1150 180 1530 210 1340 380S1140 580 1400 760L1610 1010" stroke="#4c8589" stroke-width="86" fill="none"/><path d="M1280 -50C1150 180 1530 210 1340 380S1140 580 1400 760L1610 1010" stroke="#86b1ad" stroke-width="2" fill="none"/><ellipse cx="725" cy="512" rx="360" ry="210" fill="#869267" opacity=".55"/></svg>`;
    this.scene.append(land);
    for (let i = 0; i < 94; i++) {
      const x = (i * 173 + 37) % 1540, y = (i * 97 + 53) % 940;
      if (x > 350 && x < 1130 && y > 255 && y < 755 || x > 1250) continue;
      const tree = el('div', `scenery-tree tree-${i % 3}`); tree.style.left = `${x}px`; tree.style.top = `${y}px`; tree.style.zIndex = String(y);
      tree.setAttribute('aria-hidden', 'true'); this.scene.append(tree);
    }
    const town = this.session.town;
    const project = (x: number, y: number) => ({ x: 740 + (x-y) * 33, y: 300 + (x+y) * 18 });
    for (const p of town.grid.all()) {
      const r = town.grid.rectFor(p); if (!r) continue;
      const def = town.definition(p.buildingId); const point = project(r.x + r.width / 2, r.y + r.height / 2);
      const b = button('', () => { this.open('build'); this.town.inspect(p.instanceId); }, `map-building category-${def?.category ?? 'management'} ${p.damaged ? 'damaged' : ''}`);
      const name = def?.tiers.find(t => t.tier === p.tier)?.name ?? def?.name ?? p.buildingId;
      b.setAttribute('aria-label', `${name}, tier ${p.tier}${p.damaged ? ', damaged' : ''}. Manage building`);
      b.style.left = `${point.x}px`; b.style.top = `${point.y}px`; b.style.zIndex = String(Math.round(point.y));
      b.style.setProperty('--building-width', `${38 + r.width * 20}px`);
      b.append(el('span', 'building-shadow'), el('span', 'building-wall'), el('span', 'building-roof'), el('span', 'building-door'), el('span', 'building-windows'), el('span', 'building-label', name), el('span', 'building-level', `T${p.tier}`));
      this.scene.append(b);
    }
    const sign = button('The Verdant Reach ↗', () => this.open('frontier'), 'frontier-sign'); this.scene.append(sign);
    const townLabel = el('div', 'map-town-label', town.stage().name.toUpperCase()); this.scene.append(townLabel);
    this.transform();
  }

  private renderRoster(): void {
    this.roster.replaceChildren(el('span', 'dock-label', `${this.session.roster.size} HUNTERS`));
    for (const h of this.session.roster.all()) {
      const job = this.session.townJobs.all().find(a => a.hunterId === h.id);
      const activity = job ? this.session.content.townJobsById.get(job.jobId)?.name ?? job.jobId : describeAvailability(h.availability);
      const b = button('', () => { this.selected = h.id; this.renderInspector(); }, `dock-hunter role-${this.session.buildIdentity.profileOf(h).primaryRole}`);
      b.setAttribute('aria-label', `${h.name}, level ${h.level}, ${activity}. Inspect hunter`);
      b.append(el('span', 'hunter-avatar', h.name[0]), el('span', 'dock-name', h.name.split(' ')[0]), el('span', 'dock-activity', activity)); this.roster.append(b);
    }
  }

  private renderInspector(): void {
    const h = this.selected ? this.session.roster.get(this.selected) : undefined;
    this.inspector.hidden = !h; this.inspector.replaceChildren(); if (!h) return;
    const job = this.session.townJobs.all().find(a => a.hunterId === h.id);
    const head = el('div', 'drawer-heading');
    head.append(el('h2', '', h.name), button('×', () => { this.selected = undefined; this.renderInspector(); }));
    head.lastElementChild?.setAttribute('aria-label', 'Close hunter inspector');
    this.inspector.append(head, el('p', 'inspector-subtitle', `Level ${h.level} · ${this.session.buildIdentity.profileOf(h).primaryRole}`));
    this.inspector.append(el('p', 'current-activity', job ? this.session.content.townJobsById.get(job.jobId)?.name ?? job.jobId : describeAvailability(h.availability)));
    for (const [label, value] of [['Rested', 1-h.condition.fatigue], ['Fed', 1-h.condition.hunger], ['Morale', h.condition.morale]] as const) {
      const row = el('label', 'condition-meter', label); const meter = document.createElement('meter'); meter.min = 0; meter.max = 1; meter.value = value; row.append(meter, el('span', '', `${Math.round(value*100)}%`)); this.inspector.append(row);
    }
    const profile = button('Equipment & full profile →', () => { this.open('guild'); this.guild.select(h.id); }, 'profile-action');
    this.inspector.append(profile);
  }
}
