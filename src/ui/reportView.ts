/**
 * The Guild Report on screen (REQ-UX-006).
 *
 * Shown once, on return, above whatever screen the player lands on, and dismissed by them.
 * Ordered as the design lists it; empty sections are left out rather than printed as
 * "none", because a report full of nothing hides the one line that mattered.
 */

import type { GuildReport } from '../app/GuildReport.js';

const el = (tag: string, className?: string, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function duration(steps: number, secondsPerStep: number): string {
  const minutes = Math.round((steps * secondsPerStep) / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} hour${hours === 1 ? '' : 's'}${rest > 0 ? ` ${rest} min` : ''}`;
}

/**
 * One line per region rather than one per expedition: a standing order that ran twenty-four
 * times is one fact, and twenty-four identical lines bury the one that went wrong. A run
 * that broke the party keeps its own line.
 */
function groupExpeditions(expeditions: GuildReport['expeditions']): string[] {
  const byRegion = new Map<string, { total: number; completed: number; broken: string[] }>();
  for (const e of expeditions) {
    const entry = byRegion.get(e.regionName) ?? { total: 0, completed: 0, broken: [] };
    entry.total += 1;
    if (e.completed) entry.completed += 1;
    if (e.wiped) entry.broken.push(e.summary);
    byRegion.set(e.regionName, entry);
  }
  const lines: string[] = [];
  for (const [region, entry] of byRegion) {
    const turnedBack = entry.total - entry.completed - entry.broken.length;
    lines.push(
      `${region}: ${entry.total} expedition${entry.total === 1 ? '' : 's'} — ${entry.completed} completed` +
        (turnedBack > 0 ? `, ${turnedBack} turned back` : '') +
        (entry.broken.length > 0 ? `, ${entry.broken.length} broken` : ''),
    );
    for (const summary of entry.broken) lines.push(`  ${summary}`);
  }
  return lines;
}

export function renderGuildReport(
  report: GuildReport,
  secondsPerStep: number,
  resourceName: (id: string) => string,
  onDismiss: () => void,
): HTMLElement {
  const card = el('section', 'card guild-report');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Guild Report');
  card.append(el('h3', undefined, report.offline ? 'Guild Report — while you were away' : 'Guild Report'));
  card.append(el('p', 'headline', report.headline));
  card.append(el('p', 'subhead', `${duration(report.steps, secondsPerStep)} of guild time (${report.steps} steps).`));

  const section = (title: string, lines: readonly string[], className = 'subhead'): void => {
    if (lines.length === 0) return;
    card.append(el('p', 'name', title));
    const list = el('ul', 'report-list');
    for (const line of lines) list.append(el('li', className, line));
    card.append(list);
  };

  section('Expeditions', groupExpeditions(report.expeditions));
  section('Did not come home', report.deaths, 'err');
  section('Injured', report.injuries);
  section('Rare finds', report.rareLoot, 'points');
  section('Discoveries', report.discoveries);
  section('Contracts', report.contracts);
  if (report.defenses.length > 0) {
    const held = report.defenses.filter((d) => d.held).length;
    section('Attacks on the town', [
      `${report.defenses.length} attack${report.defenses.length === 1 ? '' : 's'}: ${held} held, ${report.breaches} breached`,
      ...report.defenses.filter((d) => !d.held).map((d) => `  ${d.summary}`),
    ]);
  }
  if (report.hunts.outings > 0) section('Town hunting', [`${report.hunts.won} of ${report.hunts.outings} outings came back with something.`]);
  section('Chronicle', report.chronicle);
  const reputation = report.reputation.to - report.reputation.from;
  if (Math.abs(reputation) >= 0.1) section('Reputation', [`${reputation > 0 ? '+' : ''}${reputation.toFixed(1)} (now ${report.reputation.to.toFixed(1)})`]);
  section('Research', report.research.map((name) => `${name} completed`));
  section('The town', [
    ...report.stagesReached.map((stage) => `became a ${stage}`),
    ...(report.population.to !== report.population.from ? [`${report.population.from} → ${report.population.to} residents`] : []),
    ...(report.recovered > 0 ? [`${report.recovered} recover${report.recovered === 1 ? 'y' : 'ies'} completed`] : []),
    ...report.crafted.map((name) => `${name} came off the bench`),
  ]);
  section(
    'Economy',
    Object.entries(report.economy).map(([id, delta]) => `${delta > 0 ? '+' : ''}${delta} ${resourceName(id)}`),
  );
  section('Repairs', report.repairs);
  section('Standing orders not carried out', report.skippedOrders, 'err');

  const close = el('button', undefined, 'Back to the guild') as HTMLButtonElement;
  close.onclick = onDismiss;
  card.append(close);
  return card;
}
