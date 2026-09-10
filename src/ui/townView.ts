/**
 * The town view.
 *
 * REQ-TWN-001's phrase is "the town is a physical place on a clear grid", and REQ-PRIME-006
 * asks that the town be *observable*. The finished game is an isometric 2.5D pixel-art scene
 * (v1.0 §9) and this is emphatically not that — Phase 9 owns presentation. What this screen
 * has to do now is make the town's physicality legible enough that a footprint bug, a
 * housing crisis or a badly-run department is visible rather than inferred.
 *
 * So it is a real grid of cells you can click, place onto and drag between, plus the four
 * readings the design insists must never be replaced by a single score: housing, food,
 * services, and the Town Stability that summarises them (REQ-TWN-003).
 *
 * REQ-TEC-010: no game logic here. Every number and every sentence comes from the system
 * that produced it, and every action goes out through `GuildCommands`.
 */

import type { Session } from '../app/Session.js';
import type { GuildCommands } from '../app/GuildCommands.js';
import type { Rotation, TownDepartmentId } from '../data/townSchema.js';
import { ROTATIONS, capacityThroughTier } from '../data/townSchema.js';
import type { Placement } from '../systems/town/TownGrid.js';

const el = (tag: string, className?: string, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const pct = (value: number): string => `${Math.round(value * 100)}%`;

interface ViewState {
  /** What the player is about to place, if they are in build mode (v1.0 §9). */
  placing: string | undefined;
  rotation: Rotation;
  selected: string | undefined;
  message: string | undefined;
  messageIsError: boolean;
}

export class TownView {
  private readonly state: ViewState = {
    placing: undefined,
    rotation: 0,
    selected: undefined,
    message: undefined,
    messageIsError: false,
  };

  constructor(
    private readonly host: HTMLElement,
    private readonly session: Session,
    private readonly commands: GuildCommands,
  ) {}

  render(): void {
    this.host.replaceChildren();

    this.host.append(this.renderHeadline());

    const layout = el('div', 'town-layout');
    layout.append(this.renderGrid(), this.renderSidePanel());
    this.host.append(layout);

    if (this.state.message) {
      this.host.append(
        el('p', this.state.messageIsError ? 'err' : 'points', this.state.message),
      );
    }

    const grid = el('div', 'grid');
    grid.append(
      this.renderPressure(),
      this.renderDepartments(),
      this.renderRota(),
      this.renderResearch(),
      this.renderRecruitment(),
      this.renderDefense(),
    );
    this.host.append(grid);
  }

  private say(message: string, isError = false): void {
    this.state.message = message;
    this.state.messageIsError = isError;
    this.render();
  }

  // --- The town's own state -------------------------------------------------

  private renderHeadline(): HTMLElement {
    const card = el('div', 'card');
    const stage = this.session.town.stage();
    const report = this.session.population.report();

    card.append(el('p', 'headline', stage.name));
    card.append(
      el(
        'p',
        'subhead',
        `${report.population} residents · ${this.session.town.grid.size} buildings · ` +
          `Guild Hall tier ${this.session.town.guildHallTier()} · ` +
          `Reputation ${this.session.reputation.current.toFixed(1)} · ` +
          `${Math.floor(this.session.resources.amount('gold'))}g · ` +
          `${Math.floor(this.session.resources.amount('food'))} provisions · ` +
          `${Math.floor(this.session.resources.amount('materials'))} materials`,
      ),
    );

    // REQ-TWN-002: progression never resets, so it is worth saying what is next rather than
    // only what has been reached.
    const next = this.session.town.nextStageRequirements();
    if (next) {
      card.append(
        el(
          'p',
          'points',
          next.shortfalls.length === 0
            ? `Ready to become a ${next.stage.name}.`
            : `To become a ${next.stage.name}: ${next.shortfalls.join(', ')}.`,
        ),
      );
    }

    const advance = el('button');
    advance.textContent = 'Let a season pass';
    advance.onclick = () => {
      const result = this.commands.advanceTown(20);
      const parts: string[] = [];
      if (result.populationChange !== 0) {
        parts.push(
          `${result.populationChange > 0 ? '+' : ''}${result.populationChange} residents`,
        );
      }
      if (result.recovered.length > 0) {
        parts.push(`${result.recovered.length} back on their feet`);
      }
      if (result.stageReached) parts.push(`the town is now a ${result.stageReached}`);
      if (result.economy.materialsProduced > 0) {
        parts.push(`+${result.economy.materialsProduced.toFixed(1)} materials`);
      }
      if (result.economy.food.shortfall > 0) {
        parts.push(`${result.economy.food.shortfall.toFixed(1)} provisions short`);
      }
      this.say(parts.length > 0 ? parts.join(' · ') : 'Twenty steps pass. Nothing changes.');
    };
    card.append(advance);

    return card;
  }

  // --- The grid -------------------------------------------------------------

  private renderGrid(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'The town'));

    const town = this.session.town;
    const grid = el('div', 'town-grid');
    grid.style.gridTemplateColumns = `repeat(${town.grid.width}, 22px)`;

    // Which placement covers each cell, so a click anywhere on a building selects it.
    const owner = new Map<string, Placement>();
    for (const placement of town.grid.all()) {
      const rect = town.grid.rectFor(placement);
      if (!rect) continue;
      for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) owner.set(`${x},${y}`, placement);
      }
    }

    for (let y = 0; y < town.grid.height; y++) {
      for (let x = 0; x < town.grid.width; x++) {
        const placement = owner.get(`${x},${y}`);
        const cell = el('button', 'town-cell');
        cell.title = placement
          ? `${this.nameOf(placement)} — click to select`
          : `${x},${y} — empty`;

        if (placement) {
          const def = town.definition(placement.buildingId);
          cell.classList.add('built', `cat-${def?.category ?? 'management'}`);
          cell.textContent = (def?.name[0] ?? '?').toUpperCase();
          if (placement.instanceId === this.state.selected) cell.classList.add('selected');
        }

        cell.onclick = () => this.onCellClick(x, y, placement);
        grid.append(cell);
      }
    }

    card.append(grid);

    if (this.state.placing) {
      const def = town.definition(this.state.placing);
      const hint = el(
        'p',
        'points',
        `Placing ${def?.name ?? this.state.placing} — click a free cell. ` +
          `Facing ${this.state.rotation}°.`,
      );
      card.append(hint);

      const rotate = el('button', 'small');
      rotate.textContent = 'Rotate';
      rotate.onclick = () => {
        const index = ROTATIONS.indexOf(this.state.rotation);
        this.state.rotation = ROTATIONS[(index + 1) % ROTATIONS.length]!;
        this.render();
      };
      const cancel = el('button', 'small');
      cancel.textContent = 'Cancel';
      cancel.onclick = () => {
        this.state.placing = undefined;
        this.render();
      };
      card.append(rotate, cancel);
    } else if (this.state.selected) {
      const hint = el('p', 'points', 'Click a free cell to move the selected building there.');
      card.append(hint);
    }

    return card;
  }

  private onCellClick(x: number, y: number, placement: Placement | undefined): void {
    // Placing wins over selecting: the player has already said what they are doing.
    if (this.state.placing) {
      const result = this.commands.placeBuilding(this.state.placing, x, y, this.state.rotation);
      if (result.ok) {
        this.state.placing = undefined;
        this.state.selected = result.value.instanceId;
        this.say(`Built the ${this.nameOf(result.value)}.`);
      } else {
        this.say(result.error, true);
      }
      return;
    }

    if (placement) {
      this.state.selected =
        this.state.selected === placement.instanceId ? undefined : placement.instanceId;
      this.render();
      return;
    }

    // An empty cell with something selected means "move it here" — free, per v1.0 §9.
    if (this.state.selected) {
      const moved = this.commands.moveBuilding(this.state.selected, x, y);
      this.say(moved.ok ? `Moved the ${this.nameOf(moved.value)}.` : moved.error, !moved.ok);
      return;
    }

    this.render();
  }

  private nameOf(placement: Placement): string {
    const def = this.session.town.definition(placement.buildingId);
    const tier = def?.tiers.find((t) => t.tier === placement.tier);
    return tier?.name ?? def?.name ?? placement.buildingId;
  }

  // --- The side panel: a selected building, or the build menu ----------------

  private renderSidePanel(): HTMLElement {
    // v1.0 §9: clicking a building opens a right-side detail panel. With nothing selected
    // the same space is the build menu, so the screen is never empty.
    return this.state.selected ? this.renderSelected() : this.renderBuildMenu();
  }

  private renderSelected(): HTMLElement {
    const card = el('div', 'card');
    const placement = this.state.selected
      ? this.session.town.grid.get(this.state.selected)
      : undefined;

    if (!placement) {
      this.state.selected = undefined;
      return this.renderBuildMenu();
    }

    const def = this.session.town.definition(placement.buildingId);
    card.append(el('p', 'headline', this.nameOf(placement)));
    card.append(el('p', 'subhead', def?.description ?? ''));

    const tier = def?.tiers.find((t) => t.tier === placement.tier);
    const table = el('table', 'kv');
    const row = (label: string, value: string): void => {
      const tr = el('tr');
      tr.append(el('td', undefined, label), el('td', 'num', value));
      table.append(tr);
    };
    row('Category', def?.category ?? '—');
    row('Tier', `${placement.tier} of ${def?.tiers.length ?? 1}`);
    row('Facing', `${placement.rotation}°`);
    row('At', `${placement.x}, ${placement.y}`);

    if (def) {
      const capacity = capacityThroughTier(def, placement.tier);
      for (const [key, value] of Object.entries(capacity)) {
        if (value !== 0) row(key === 'defence' ? 'Defence' : capitalise(key), String(value));
      }
    }
    card.append(table);

    if (tier?.note) card.append(el('p', 'subhead', tier.note));

    const jobs = Object.entries(tier?.jobs ?? {});
    if (jobs.length > 0) {
      card.append(el('h3', undefined, 'Work here'));
      for (const [jobId, slots] of jobs) {
        const job = this.session.content.townJobsById.get(jobId);
        card.append(el('p', 'subhead', `${job?.name ?? jobId} — ${slots} post(s)`));
      }
    }

    const upgrade = this.session.town.upgradeCost(placement.instanceId);
    const upgradeButton = el('button', 'small') as HTMLButtonElement;
    if (upgrade.ok) {
      upgradeButton.textContent = `Upgrade to tier ${upgrade.value.tier} — ${upgrade.value.gold}g, ${upgrade.value.materials} materials`;
      upgradeButton.onclick = () => {
        const raised = this.commands.upgradeBuilding(placement.instanceId);
        this.say(
          raised.ok
            ? `Raised the ${this.nameOf(raised.value)} to tier ${raised.value.tier}.`
            : raised.error,
          !raised.ok,
        );
      };
    } else {
      upgradeButton.textContent = upgrade.error;
      upgradeButton.disabled = true;
    }

    const demolish = el('button', 'small');
    demolish.textContent = 'Demolish';
    demolish.onclick = () => {
      const removed = this.commands.demolishBuilding(placement.instanceId);
      this.state.selected = undefined;
      this.say(removed.ok ? 'Pulled down.' : removed.error, !removed.ok);
    };

    const deselect = el('button', 'small');
    deselect.textContent = 'Close';
    deselect.onclick = () => {
      this.state.selected = undefined;
      this.render();
    };

    card.append(upgradeButton, demolish, deselect);
    return card;
  }

  private renderBuildMenu(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'Build'));

    // DL-033's rule, applied to buildings: a locked one is shown with the reason, because
    // knowing a Shrine exists and what it will take is itself progression.
    for (const entry of this.session.town.buildMenu()) {
      const row = el('div', 'build-row');
      const button = el('button', 'small') as HTMLButtonElement;
      button.textContent = entry.building.name;
      button.disabled = !entry.available;
      button.onclick = () => {
        this.state.placing = entry.building.id;
        this.state.selected = undefined;
        this.render();
      };

      const first = entry.building.tiers[0];
      const cost = first ? `${first.cost.gold}g · ${first.cost.materials} mat` : '';
      const footprint = `${entry.building.footprint.width}×${entry.building.footprint.height}`;

      row.append(button);
      row.append(
        el(
          'span',
          entry.available ? 'meta' : 'err',
          entry.available ? `${footprint} · ${cost}` : entry.blockedBy ?? 'locked',
        ),
      );
      card.append(row);
    }

    card.append(
      el(
        'p',
        'subhead',
        'Construction draws gold and materials from the guild ledger.',
      ),
    );
    return card;
  }

  // --- REQ-TWN-003: three indicators, and a summary that never replaces them --

  private renderPressure(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'The town under load'));

    const report = this.session.population.report();

    for (const reading of report.pressures) {
      const row = el('div', 'bar-row');
      const bar = el('div', 'bar neutral');
      const fill = el('span');
      // Shown as relief rather than pressure, so a full bar is good news.
      fill.style.width = pct(1 - reading.pressure);
      fill.style.background = reading.pressure > 0.5 ? 'var(--warn)' : 'var(--healer)';
      bar.append(fill);

      row.append(
        el('span', 'label', capitalise(reading.key)),
        bar,
        el('span', 'value', pct(1 - reading.pressure)),
      );
      card.append(row);
      card.append(el('p', 'subhead', reading.summary));
    }

    card.append(
      el(
        'p',
        report.stability < 0.5 ? 'err' : 'points',
        `Town Stability — ${report.stabilityBand} (${pct(report.stability)}). ` +
          `Population ${report.growthPerStep >= 0 ? 'growing' : 'falling'} by ` +
          `${Math.abs(report.growthPerStep).toFixed(3)} per step.`,
      ),
    );

    // The recovery reading, because it is the thing the player most often wants to explain.
    card.append(
      el(
        'p',
        'subhead',
        `Housing quality ${this.session.town.housingQuality().toFixed(2)} · ` +
          `services ${this.session.town.serviceQuality().toFixed(2)} · ` +
          `${this.session.town.foodAvailable() ? 'everyone is fed' : 'not everyone is fed'}.`,
      ),
    );

    return card;
  }

  // --- REQ-DEP-004: a multi-metric dashboard --------------------------------

  private renderDepartments(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'Departments'));

    for (const report of this.session.departments.reports()) {
      const block = el('div', 'dept-block');
      block.append(el('p', 'name', report.name));

      if (!report.unlocked) {
        block.append(el('p', 'subhead', 'Not yet opened — unlocked by research.'));
        card.append(block);
        continue;
      }

      // Four metrics side by side. Deliberately no combined score: one number would hide
      // the trade-off the player is making.
      block.append(
        el(
          'p',
          'subhead',
          `Staffing ${report.staffed}/${report.slots} (${pct(report.staffing)}) · ` +
            `output ${report.output.toFixed(1)} · fit ${pct(report.fit)} · ` +
            `run by ${report.leadershipName} (×${report.leadershipEffect.toFixed(2)})`,
        ),
      );

      const controls = el('div', 'build-row');

      const head = el('select');
      const none = el('option') as HTMLOptionElement;
      none.value = '';
      none.textContent = 'No head';
      head.append(none);
      for (const hunter of this.session.roster.all()) {
        const option = el('option') as HTMLOptionElement;
        option.value = hunter.id;
        option.textContent = hunter.name;
        option.selected = this.session.departments.of(report.id).headId === hunter.id;
        head.append(option);
      }
      head.onchange = () => {
        const value = (head as HTMLSelectElement).value;
        const result = this.commands.appointDepartmentHead(
          report.id as TownDepartmentId,
          value === '' ? undefined : (value as never),
        );
        this.say(result.ok ? `${report.name} reassigned.` : result.error, !result.ok);
      };

      const policy = el('select');
      for (const preset of this.session.departments.policies()) {
        const option = el('option') as HTMLOptionElement;
        option.value = preset.id;
        option.textContent = preset.name;
        option.selected = report.policy.id === preset.id;
        option.title = preset.description;
        policy.append(option);
      }
      policy.onchange = () => {
        const result = this.commands.setDepartmentPolicy(
          report.id as TownDepartmentId,
          (policy as HTMLSelectElement).value,
        );
        this.say(result.ok ? `${report.name} policy changed.` : result.error, !result.ok);
      };

      const priority = el('select');
      const { min, max } = this.session.content.balance.town.departments.priorities;
      for (let value = min; value <= max; value++) {
        const option = el('option') as HTMLOptionElement;
        option.value = String(value);
        option.textContent = `Priority ${value}`;
        option.selected = report.priority === value;
        priority.append(option);
      }
      priority.onchange = () => {
        const result = this.commands.setDepartmentPriority(
          report.id as TownDepartmentId,
          Number((priority as HTMLSelectElement).value),
        );
        this.say(result.ok ? `${report.name} priority changed.` : result.error, !result.ok);
      };

      controls.append(head, policy, priority);
      block.append(controls);

      // REQ-DEP-004: the AI recommends, the player decides. Advice only — nothing acts.
      if (report.recommendation) block.append(el('p', 'err', report.recommendation));

      card.append(block);
    }

    return card;
  }

  private renderRota(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'Who is working'));

    const rota = this.session.townJobs.describe();
    if (rota.length === 0) {
      card.append(
        el('p', 'empty', 'Nobody is on the work rota — no free hunters, or nowhere to work.'),
      );
    } else {
      // REQ-TWN-010's reasoning, shown rather than hidden: every line says why.
      for (const line of rota) card.append(el('p', 'subhead', line));
    }

    const refresh = el('button', 'small');
    refresh.textContent = 'Reassign';
    refresh.onclick = () => {
      const assigned = this.session.townJobs.refresh();
      this.say(`${assigned.length} post(s) filled.`);
    };
    card.append(refresh);

    return card;
  }

  // --- REQ-RES-001: costs, effects, locks and partial requirements -----------

  private renderResearch(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'Research'));

    const current = this.session.research.current;
    const output = this.session.departments.report('research').output;
    card.append(
      el(
        'p',
        'subhead',
        current
          ? `${current.node.name} — ${current.progress.toFixed(1)} of ${current.node.cost}, ` +
              `${output.toFixed(1)} points per step`
          : 'Nothing is being researched.',
      ),
    );
    if (output <= 0) {
      card.append(
        el('p', 'err', 'The Research Department produces nothing — nobody is doing archive work.'),
      );
    }

    for (const entry of this.session.research.tree()) {
      const row = el('div', 'build-row');
      const button = el('button', 'small') as HTMLButtonElement;
      button.textContent = `${entry.node.name} (${entry.node.cost})`;
      button.title = entry.node.description;

      // A locked node is shown with its reason, the same rule as regions and buildings —
      // knowing what a branch will cost you is itself information (DL-033).
      const state = entry.availability;
      const note = ((): { text: string; className: string } => {
        switch (state.state) {
          case 'completed':
            return { text: 'known', className: 'points' };
          case 'active':
            return { text: `${state.progress.toFixed(0)}/${state.cost}`, className: 'points' };
          case 'blocked':
            return { text: `needs ${state.missing.join(', ')}`, className: 'meta' };
          case 'foreclosed':
            return { text: `ruled out by ${state.by.join(' and ')}`, className: 'err' };
          default:
            return { text: entry.effects.join(' · '), className: 'meta' };
        }
      })();

      button.disabled = state.state !== 'available';
      button.onclick = () => {
        const begun = this.commands.beginResearch(entry.node.id);
        this.say(begun.ok ? `Work begins on ${begun.value.name}.` : begun.error, !begun.ok);
      };

      row.append(button, el('span', note.className, note.text));
      card.append(row);
    }

    const reset = el('button', 'small');
    reset.textContent = 'Reset the tree';
    reset.onclick = () => {
      const result = this.commands.resetResearch();
      this.say(
        result.ok
          ? `Unlearned ${result.value.cleared} advance(s). Paid ${result.value.cost}.`
          : result.error,
        !result.ok,
      );
    };
    card.append(reset);

    return card;
  }

  // --- REQ-RCT-001/002: the hall, the pool, and the recruiter's read ---------

  private renderRecruitment(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'Recruitment Hall'));

    if (this.session.town.grid.countOf('recruitment_hall') === 0) {
      card.append(el('p', 'empty', 'The guild has no Recruitment Hall.'));
      return card;
    }

    const board = this.commands.recruitmentBoard();
    card.append(el('p', 'subhead', board.advice.summary));

    const fitById = new Map(board.advice.ranked.map((f) => [f.hunterId, f]));
    const recommended = board.advice.recommended?.hunterId;
    const alternatives = new Set(board.advice.alternatives.map((a) => a.hunterId));

    for (const candidate of board.candidates) {
      const id = String(candidate.hunter.id);
      const block = el('div', 'dept-block');
      block.append(
        el(
          'p',
          candidate.exceptional ? 'points' : 'name',
          `${candidate.hunter.name} — ${candidate.originName}` +
            (candidate.exceptional ? ' · EXCEPTIONAL' : '') +
            (id === recommended ? ' · recommended' : '') +
            (alternatives.has(id) ? ' · worth a look' : ''),
        ),
      );
      block.append(el('p', 'subhead', candidate.originNote));

      // v1.0 §4 asks for reasons, what the guild gains, and notable alternatives — not a
      // bare ranking the player has to take on faith.
      const fit = fitById.get(id);
      for (const reason of fit?.reasons ?? []) block.append(el('p', 'subhead', `+ ${reason}`));
      for (const gain of fit?.gains ?? []) block.append(el('p', 'points', `→ ${gain}`));
      for (const concern of fit?.concerns ?? []) block.append(el('p', 'err', `− ${concern}`));

      const controls = el('div', 'build-row');
      const hire = el('button', 'small');
      hire.textContent = `Hire — ${candidate.cost}g`;
      hire.onclick = () => {
        const hired = this.commands.hireRecruit(candidate.hunter.id);
        this.say(hired.ok ? `${hired.value.name} joins the guild.` : hired.error, !hired.ok);
      };
      const pass = el('button', 'small');
      pass.textContent = 'Pass';
      pass.onclick = () => {
        const turned = this.commands.turnAwayRecruit(candidate.hunter.id);
        this.say(turned.ok ? `${turned.value.hunter.name} moves on.` : turned.error, !turned.ok);
      };
      controls.append(hire, pass);
      block.append(controls);
      card.append(block);
    }

    const refresh = el('button', 'small');
    refresh.textContent = `Refresh — ${board.paidRefreshGold}g`;
    refresh.onclick = () => {
      const drawn = this.commands.refreshRecruits();
      this.say(drawn.ok ? `${drawn.value.length} new faces at the hall.` : drawn.error, !drawn.ok);
    };
    card.append(refresh);

    return card;
  }

  // --- REQ-TWN-008: guard policy, the record, and what needs rebuilding ------

  private renderDefense(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'The walls'));

    const record = this.session.defense.record;
    card.append(
      el(
        'p',
        'subhead',
        `Defence ${this.session.town.capacity().defence} · ` +
          `${record.held} of ${record.faced} threats held`,
      ),
    );

    const policy = el('select');
    for (const option of this.session.defense.policies()) {
      const node = el('option') as HTMLOptionElement;
      node.value = option.id;
      node.textContent = option.name;
      node.title = option.description;
      node.selected = this.session.defense.policy === option.id;
      policy.append(node);
    }
    policy.onchange = () => {
      const result = this.commands.setGuardPolicy((policy as HTMLSelectElement).value);
      this.say(result.ok ? 'Guard orders changed.' : result.error, !result.ok);
    };
    card.append(policy);

    const damaged = this.session.town.grid.damaged();
    if (damaged.length === 0) {
      card.append(el('p', 'subhead', 'Nothing needs rebuilding.'));
    } else {
      for (const placement of damaged) {
        const row = el('div', 'build-row');
        const repair = el('button', 'small');
        repair.textContent = `Repair ${this.nameOf(placement)}`;
        repair.onclick = () => {
          const result = this.commands.repairBuilding(placement.instanceId);
          this.say(result.ok ? 'Rebuilt.' : result.error, !result.ok);
        };
        row.append(repair, el('span', 'err', 'out of service'));
        card.append(row);
      }
    }

    return card;
  }
}

function capitalise(text: string): string {
  return text.replace(/^./, (c) => c.toUpperCase());
}
