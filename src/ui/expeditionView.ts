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
import { describeAvailability } from '../core/hunter/availability.js';
import { STANDING_ORDERS, contradictionsIn } from '../ai/policy/orders.js';

const el = (tag: string, className?: string, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const pct = (value: number): string => `${Math.round(value * 100)}%`;

interface ViewState {
  regionId: string;
  objective: ObjectiveId;
  outcome: ExpeditionOutcome | undefined;
  message: string | undefined;
  messageIsError: boolean;
  expandedNode: number | undefined;
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
    };
  }

  render(): void {
    this.host.replaceChildren();
    const grid = el('div', 'grid');
    grid.append(this.renderPlanner(), this.renderOrders(), this.renderProposal());
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

    const regionSelect = el('select') as HTMLSelectElement;
    for (const region of this.session.content.world.regions) {
      const option = el('option', undefined, region.name) as HTMLOptionElement;
      option.value = region.id;
      option.selected = region.id === this.state.regionId;
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

      const facts = el('table', 'kv');
      for (const [label, value] of [
        ['Danger', tier.name],
        ['Recommended level', String(region.recommendedLevel)],
        ['Route length', `${region.routeLength.min}–${region.routeLength.max} nodes`],
        ['Boss', region.boss ? (this.session.content.monstersById.get(region.boss)?.name ?? '—') : 'none'],
        ['Knowledge', region.knowledgeTier],
      ]) {
        const row = el('tr');
        row.append(el('th', undefined, label), el('td', undefined, value));
        facts.append(row);
      }
      card.append(facts);
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

  // --- 5: the account ------------------------------------------------------

  private renderReport(outcome: ExpeditionOutcome): HTMLElement {
    const wrap = el('div', 'grid');
    const { result } = outcome;

    const route = el('div', 'card');
    route.append(el('h3', undefined, `Route — ${result.reachedNode}/${result.routeLength}`));

    for (const [index, report] of result.nodes.entries()) {
      const decision = result.decisions[index];
      const row = el('div', 'node-row');
      row.append(
        el('span', 'slot-name', report.node.kind),
        el('span', 'slot-item', report.node.label),
        el('span', 'slot-quality', `${report.outcome} · ${pct(report.partyHealth)}`),
      );
      row.onclick = () => {
        this.state.expandedNode = this.state.expandedNode === index ? undefined : index;
        this.render();
      };

      // The decision comes *before* the node it decided on, because that is when it was
      // made. Rendering it after made "the party sets out" appear beneath a fight that had
      // already happened, which reads as the log being one step out of order (v1.0 §14).
      if (decision) route.append(el('p', 'subhead', decision.explanation));
      route.append(row);

      if (this.state.expandedNode === index) {
        for (const entry of report.highlights) {
          route.append(el('p', 'log-line', `${entry.atSeconds}s — ${entry.text}`));
        }
        if (report.highlights.length === 0) {
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
