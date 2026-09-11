/**
 * The expedition view — where the player actually plays.
 *
 * v1.0 §1: the player is the invisible Guild Master. Everything on this screen is a
 * *strategic* choice — where to go, what for — and everything below the send button is the
 * guild's own account of what it did. There is deliberately no control that targets a
 * monster, fires an ability, or moves a hunter.
 *
 * The screen is laid out in the order the decision is actually made:
 *   1. pick a region, and read what it can do to you (REQ-ZON-001)
 *   2. pick an objective
 *   3. read the AI's party proposal *and its reasoning*, before committing
 *   4. send
 *   5. read the route back, decision by decision (v1.0 §14)
 *
 * REQ-TEC-010: no game logic here. Every number and every sentence comes from the systems
 * that produced it.
 */

import type { Session } from '../app/Session.js';
import type { ExpeditionOutcome, GuildCommands } from '../app/GuildCommands.js';
import { OBJECTIVES, type ObjectiveId, type PartyProposal } from '../systems/party/Party.js';
import { preferences } from './preferences.js';
import { activatable } from './a11y.js';
import { describeAvailability } from '../core/hunter/availability.js';
import { STANDING_ORDERS, contradictionsIn } from '../ai/policy/orders.js';

const el = (tag: string, className?: string, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const pct = (value: number): string => `${Math.round(value * 100)}%`;

/** Hazard and event ids are slugs in the data; the player should never see one. */
const prettify = (slug: string): string =>
  slug.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

interface ViewState {
  regionId: string;
  objective: ObjectiveId;
  outcome: ExpeditionOutcome | undefined;
  message: string | undefined;
  messageIsError: boolean;
  expandedNode: number | undefined;
  endlessObjective: string;
}

export class ExpeditionView {
  private readonly state: ViewState;

  constructor(
    private readonly host: HTMLElement,
    private readonly session: Session,
    private readonly commands: GuildCommands,
  ) {
    this.state = {
      regionId: session.content.world.regions[0]?.id ?? '',
      objective: 'clear',
      outcome: undefined,
      message: undefined,
      messageIsError: false,
      expandedNode: undefined,
      endlessObjective: session.content.endless.objectives[0]?.id ?? '',
    };
  }

  render(): void {
    this.host.replaceChildren();
    const grid = el('div', 'grid');
    grid.append(
      this.renderPlanner(),
      this.renderOrders(),
      this.renderProposal(),
      this.renderWorldBoss(),
      this.renderEndless(),
      this.renderStandingOrder(),
    );
    this.host.append(grid);

    if (this.state.message) {
      this.host.append(
        el('p', this.state.messageIsError ? 'err' : 'points', this.state.message),
      );
    }
    if (this.state.outcome) this.host.append(this.renderReport(this.state.outcome));
  }

  // --- 1 & 2: where, and what for ------------------------------------------

  private renderPlanner(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'Send an expedition'));

    // REQ-WLD-002: locked regions are *shown*, marked, and explained. §8 makes the map a
    // knowledge interface, so seeing that a place exists and what it will take to go there
    // is itself progression — hiding it would make the world feel smaller than it is.
    const availability = this.commands.regionAvailability();

    const regionSelect = el('select') as HTMLSelectElement;
    for (const entry of availability) {
      const option = el(
        'option',
        undefined,
        entry.unlocked ? entry.region.name : `${entry.region.name} — locked`,
      ) as HTMLOptionElement;
      option.value = entry.region.id;
      option.disabled = !entry.unlocked;
      option.selected = entry.region.id === this.state.regionId;
      regionSelect.append(option);
    }
    regionSelect.onchange = () => {
      this.state.regionId = regionSelect.value;
      this.render();
    };

    const objectiveSelect = el('select') as HTMLSelectElement;
    for (const objective of OBJECTIVES) {
      const option = el('option', undefined, objective.name) as HTMLOptionElement;
      option.value = objective.id;
      option.selected = objective.id === this.state.objective;
      objectiveSelect.append(option);
    }
    objectiveSelect.onchange = () => {
      this.state.objective = objectiveSelect.value as ObjectiveId;
      this.render();
    };

    card.append(this.field('Region', regionSelect), this.field('Objective', objectiveSelect));

    const region = this.session.content.worldRegionsById.get(this.state.regionId);
    if (region) {
      const tier = this.session.content.world.zoneTiers[region.zoneTier];
      card.append(el('p', 'subhead', region.description));

      // REQ-ZON-001 stated plainly rather than through a colour the player must decode.
      const danger = tier.canKill
        ? 'Hunters can die here. Losses are permanent.'
        : tier.canInjure
          ? 'Hunters can be badly hurt here, but not killed.'
          : 'Nobody dies here. The worst outcome is a wasted day.';
      const warning = el('p', tier.canKill ? 'err' : 'points', danger);
      card.append(warning);

      const known = this.session.worldKnowledge.of(region.id);
      const facts = el('table', 'kv');
      for (const [label, value] of [
        ['Danger', tier.name],
        ['Recommended level', String(region.recommendedLevel)],
        ['Route length', `${region.routeLength.min}–${region.routeLength.max} nodes`],
        ['Boss', region.boss ? (this.session.content.monstersById.get(region.boss)?.name ?? '—') : 'none'],
        ['Knowledge', known.tier],
        ['Expeditions', String(known.visits)],
        ...(region.hazards.length > 0
          ? [['Conditions', region.hazards.map(prettify).join(', ')] as const]
          : []),
      ]) {
        const row = el('tr');
        row.append(el('th', undefined, label), el('td', undefined, value));
        facts.append(row);
      }
      card.append(facts);

      // What the guild actually knows, at the level of detail its knowledge permits.
      for (const line of this.session.worldKnowledge.describe(region)) {
        card.append(el('p', 'subhead', line));
      }

      const locked = availability.find((a) => a.region.id === region.id);
      if (locked && !locked.unlocked) {
        card.append(el('p', 'err', `Not open to the guild yet: ${locked.blockedBy.join('; ')}.`));
      }
    }

    const objective = OBJECTIVES.find((o) => o.id === this.state.objective);
    if (objective) card.append(el('p', 'subhead', objective.description));

    return card;
  }

  // --- 2b: standing orders --------------------------------------------------

  /**
   * The player's standing orders (§29).
   *
   * This is the *policy* half of "a strategy or policy decision" in v1.0 §16, and the only
   * place the player can overrule their hunters' own judgement. Each order states plainly
   * what it costs, because an order whose consequence is a surprise is not a decision the
   * player made — it is one the game made for them.
   */
  private renderOrders(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'Standing orders'));
    card.append(
      el(
        'p',
        'subhead',
        'Absolute. Hunters obey these before their own judgement, and will die honouring one.',
      ),
    );

    for (const order of STANDING_ORDERS) {
      const row = el('label', 'order-row');
      const box = el('input') as HTMLInputElement;
      box.type = 'checkbox';
      box.checked = this.session.policy.has(order.constraint.id);
      box.onchange = () => {
        if (box.checked) this.session.policy.add(order.constraint);
        else this.session.policy.remove(order.constraint.id);
        this.render();
      };

      const text = el('span');
      text.append(el('span', 'order-label', order.label));
      text.append(el('span', 'subhead', order.detail));
      row.append(box, text);
      card.append(row);
    }

    // Contradictory orders permit nothing at all, and a hunter with no legal action does
    // nothing rather than improvising (REQ-POL-004). Saying so is better than quietly
    // picking which of the player's two orders they really meant.
    const clashes = contradictionsIn(
      this.session.policy.all().map((c) => c.id),
    );
    for (const [a, b] of clashes) {
      const first = STANDING_ORDERS.find((o) => o.constraint.id === a)?.label ?? a;
      const second = STANDING_ORDERS.find((o) => o.constraint.id === b)?.label ?? b;
      card.append(
        el(
          'p',
          'err',
          `"${first}" and "${second}" contradict each other. Together they permit nothing, ` +
            'and hunters under both will stand still.',
        ),
      );
    }

    if (this.session.policy.size === 0) {
      card.append(el('p', 'empty', 'No orders. Hunters use their own judgement.'));
    }

    return card;
  }

  // --- 3 & 4: the proposal, and the commit ---------------------------------

  private renderProposal(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'Proposed party'));

    let proposal: PartyProposal | undefined;
    try {
      proposal = this.session.partyPlanner.propose(this.session.roster.all(), this.state.objective);
    } catch (error) {
      card.append(el('p', 'err', String(error)));
      return card;
    }

    card.append(el('p', 'headline', proposal.summary));

    if (proposal.members.length === 0) {
      const recovering = this.session.roster
        .all()
        .map((h) => `${h.name} — ${describeAvailability(h.availability)}`);
      card.append(el('p', 'empty', 'Nobody can be deployed right now.'));
      for (const line of recovering) card.append(el('p', 'subhead', line));
      return card;
    }

    for (const member of proposal.members) {
      const row = el('div', 'slot-row');
      row.append(
        el('span', 'slot-name', member.role),
        el('span', 'slot-item', member.name),
        el('span', 'slot-quality', member.range),
      );
      card.append(row);
      // The rationale is the whole point of showing a proposal instead of a roster.
      card.append(el('p', 'subhead', member.rationale));
    }

    const send = el('button', undefined, 'Send them') as HTMLButtonElement;
    send.onclick = () => {
      const outcome = this.commands.sendExpedition(this.state.regionId, this.state.objective);
      if (!outcome.ok) {
        this.state.message = outcome.error;
        this.state.messageIsError = true;
      } else {
        this.state.outcome = outcome.value;
        this.state.message = outcome.value.result.summary;
        this.state.messageIsError = outcome.value.result.wiped;
        this.state.expandedNode = undefined;
      }
      this.render();
    };
    card.append(send);

    return card;
  }

  // --- REQ-OFF-001..004: what the guild does while you are away ------------

  private renderStandingOrder(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'While you are away'));
    const current = this.session.standingOrders.order;
    const region = (id: string) => this.session.content.worldRegionsById.get(id)?.name ?? id;
    card.append(
      el(
        'p',
        current ? 'points' : 'subhead',
        current
          ? `Every ${current.everySteps} steps: ${OBJECTIVES.find((o) => o.id === current.objective)?.name ?? current.objective} in ${region(current.regionId)}${current.allowLethal ? ' — lethal zones allowed' : ''}.`
          : 'No standing order. While you are away the town keeps working, but nobody is sent into the field.',
      ),
    );
    card.append(
      el('p', 'subhead', 'Uses the region and objective chosen above. Hunters can die in Red and Black zones; an order only goes there if you allow it.'),
    );

    const every = el('input') as HTMLInputElement;
    every.type = 'number';
    every.min = '1';
    every.value = String(current?.everySteps ?? 40);
    every.setAttribute('aria-label', 'Steps between expeditions');
    const lethalLabel = el('label', 'subhead');
    const lethal = el('input') as HTMLInputElement;
    lethal.type = 'checkbox';
    lethal.checked = current?.allowLethal ?? false;
    lethalLabel.append(lethal, document.createTextNode(' Allow zones where hunters can die'));
    const repairLabel = el('label', 'subhead');
    const repair = el('input') as HTMLInputElement;
    repair.type = 'checkbox';
    repair.checked = this.session.standingOrders.autoRepair;
    repair.onchange = () => {
      this.commands.setAutoRepair(repair.checked);
      this.render();
    };
    repairLabel.append(repair, document.createTextNode(' The Guild AI rebuilds damaged buildings when it can pay'));
    card.append(this.field('Every (steps)', every), lethalLabel, repairLabel);

    const row = el('div', 'build-row');
    const set = el('button', 'small', 'Set standing order') as HTMLButtonElement;
    set.onclick = () => {
      const result = this.commands.setStandingOrder({
        regionId: this.state.regionId,
        objective: this.state.objective,
        everySteps: Math.max(1, Math.floor(Number(every.value) || 1)),
        allowLethal: lethal.checked,
      });
      this.state.message = result.ok ? 'Standing order set.' : result.error;
      this.state.messageIsError = !result.ok;
      this.render();
    };
    const clear = el('button', 'small', 'Clear') as HTMLButtonElement;
    clear.disabled = !current;
    clear.onclick = () => {
      this.commands.setStandingOrder(undefined);
      this.state.message = 'Standing order cleared.';
      this.state.messageIsError = false;
      this.render();
    };
    row.append(set, clear);
    card.append(row);
    return card;
  }

  // --- REQ-END-002/003: endless runs and personal records ------------------

  private renderWorldBoss(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'World event'));
    const event = this.commands.worldBossEvent();
    if (!event) {
      card.append(el('p', 'empty', 'No world boss is currently active. Scouts are watching the frontier.'));
      return card;
    }
    const boss = this.session.content.monstersById.get(event.bossId);
    const region = this.session.content.worldRegionsById.get(event.regionId);
    card.append(
      el('p', 'headline', `${boss?.name ?? event.bossId} has appeared`),
      el('p', 'subhead', `${region?.name ?? event.regionId} is under a world event. The boss will remain until defeated.`),
    );
    const send = el('button', undefined, 'Challenge world boss') as HTMLButtonElement;
    send.onclick = () => {
      const outcome = this.commands.sendWorldBossExpedition();
      if (!outcome.ok) {
        this.state.message = outcome.error;
        this.state.messageIsError = true;
      } else {
        this.state.outcome = outcome.value;
        this.state.message = outcome.value.result.summary;
        this.state.messageIsError = outcome.value.result.wiped;
        this.state.expandedNode = undefined;
      }
      this.render();
    };
    card.append(send);
    return card;
  }

  private renderEndless(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'Endless expedition'));
    const availability = this.commands.endlessAvailability();
    if (!availability.open) {
      card.append(el('p', 'empty', availability.reason));
      return card;
    }
    card.append(
      el('p', 'subhead', 'The run continues into deeper, harder routes until the Guild AI turns back, the party breaks, or the light goes. Uses the region chosen above.'),
    );

    const select = el('select') as HTMLSelectElement;
    for (const objective of this.session.content.endless.objectives) {
      const option = el('option', undefined, objective.name) as HTMLOptionElement;
      option.value = objective.id;
      option.selected = objective.id === this.state.endlessObjective;
      select.append(option);
    }
    select.onchange = () => {
      this.state.endlessObjective = select.value;
      this.render();
    };
    card.append(this.field('Objective', select));

    const objective = this.session.content.endless.objectives.find((o) => o.id === this.state.endlessObjective);
    if (objective) card.append(el('p', 'subhead', objective.description));

    const record = this.session.endlessRecords.get(this.state.regionId, this.state.endlessObjective);
    card.append(
      el(
        'p',
        record ? 'points' : 'subhead',
        record
          ? `Record: depth ${record.depth} — ${record.party.join(', ')}${record.cycle > 0 ? ` (cycle ${record.cycle})` : ''}`
          : 'No record here yet.',
      ),
    );

    const go = el('button', undefined, 'Go endless') as HTMLButtonElement;
    go.onclick = () => {
      const outcome = this.commands.sendEndlessExpedition(this.state.regionId, this.state.endlessObjective);
      if (!outcome.ok) {
        this.state.message = outcome.error;
        this.state.messageIsError = true;
      } else {
        this.state.outcome = outcome.value;
        const recordLine = outcome.value.record?.improved
          ? ` New record: depth ${outcome.value.record.current.depth}.`
          : outcome.value.record
            ? ` The record stands at depth ${outcome.value.record.current.depth}.`
            : '';
        this.state.message = outcome.value.result.summary + recordLine;
        this.state.messageIsError = outcome.value.result.wiped;
        this.state.expandedNode = undefined;
      }
      this.render();
    };
    card.append(go);
    return card;
  }

  // --- 5: the account ------------------------------------------------------

  private renderReport(outcome: ExpeditionOutcome): HTMLElement {
    const wrap = el('div', 'grid');
    const { result } = outcome;

    const advanced = preferences().detail === 'advanced';
    const route = el('div', 'card');
    route.append(el('h3', undefined, `Route — ${result.reachedNode}/${result.routeLength}`));
    route.append(
      el(
        'p',
        'subhead',
        `${Math.floor(result.elapsedSeconds / 60)}m ${result.elapsedSeconds % 60}s in the field` +
          (result.outOfTime ? ' — the party ran out of daylight.' : '.'),
      ),
    );

    for (const [index, report] of result.nodes.entries()) {
      const decision = result.decisions[index];
      const row = el('div', 'node-row');
      row.append(
        el('span', 'slot-name', report.node.kind),
        el('span', 'slot-item', report.node.label),
        el('span', 'slot-quality', `${report.outcome} · ${pct(report.partyHealth)}`),
      );
      activatable(row, () => {
        this.state.expandedNode = this.state.expandedNode === index ? undefined : index;
        this.render();
      });
      row.setAttribute('aria-expanded', String(this.state.expandedNode === index));

      // The decision comes *before* the node it decided on, because that is when it was
      // made. Rendering it after made "the party sets out" appear beneath a fight that had
      // already happened, which reads as the log being one step out of order (v1.0 §14).
      if (decision) {
        route.append(el('p', 'subhead', decision.explanation));
        if (advanced && decision.reasonCodes.length > 0) {
          route.append(el('p', 'log-line', `reason codes: ${decision.reasonCodes.join(', ')}`));
        }
      }
      route.append(row);

      // REQ-UX-004: a fight that cost someone, or felled a boss, says why without a click.
      const story = report.story;
      if (story && story.why.length > 0 && this.state.expandedNode !== index) {
        route.append(el('p', 'story-why', story.why[0]!));
      }

      if (this.state.expandedNode === index) {
        if (story) {
          route.append(el('p', 'name', story.verdict));
          for (const line of story.why) route.append(el('p', 'story-why', line));
          if (story.keySkills.length > 0) route.append(el('p', 'subhead', `Key skills: ${story.keySkills.join(' · ')}`));
          for (const moment of story.moments) {
            route.append(el('p', `log-line moment-${moment.kind}`, `${moment.at.toFixed(1)}s — ${moment.text}`));
          }
        }
        // The raw combat log is implementation detail; REQ-UX-002 shows it only on request.
        if (advanced || !story) {
          for (const entry of report.highlights) {
            const codes = advanced && entry.reasonCodes.length > 0 ? `  [${entry.reasonCodes.join(', ')}]` : '';
            route.append(el('p', 'log-line', `${entry.atSeconds}s — ${entry.text}${codes}`));
          }
        }
        if (report.highlights.length === 0 && !story) {
          route.append(el('p', 'empty', 'Nothing worth recording happened here.'));
        }
      }
    }
    wrap.append(route);

    const aftermath = el('div', 'card');
    aftermath.append(el('h3', undefined, 'Aftermath'));
    for (const after of result.aftermath) {
      // A dead hunter is off the roster, so their name comes from the party, not the roster.
      const name =
        outcome.party.members.find((m) => m.hunterId === after.hunterId)?.name ?? 'A hunter';
      const line = after.died
        ? `${name} did not come back.`
        : after.injured
          ? `${name} came back injured — ${pct(after.healthFraction)} health, +${after.xp} xp.`
          : `${name} — ${pct(after.healthFraction)} health, +${after.xp} xp.`;
      aftermath.append(el('p', after.died ? 'err' : undefined, line));
    }

    if (outcome.levelledUp.length > 0) {
      aftermath.append(el('p', 'points', `${outcome.levelledUp.length} hunter(s) levelled up.`));
    }

    if (outcome.loot.length > 0) {
      aftermath.append(el('h3', undefined, `Haul — ${outcome.loot.length} items`));
      for (const item of outcome.loot) {
        aftermath.append(el('p', 'subhead', `${item.name} (i${item.itemLevel}, ${item.rarity})`));
      }
    }
    wrap.append(aftermath);

    return wrap;
  }

  private field(label: string, control: HTMLElement): HTMLElement {
    const row = el('label', 'field');
    row.append(el('span', 'slot-name', label), control);
    return row;
  }
}
