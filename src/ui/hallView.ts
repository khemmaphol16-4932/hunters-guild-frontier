/**
 * The Guild Hall — the institution rather than the individuals.
 *
 * Phase 7 and Phase 8 built contracts, crafting, capability, the Monument, Legacy, mentors
 * and New Game+, and put almost none of it on screen: everything but the market was
 * reachable only from the debug console. A system a player cannot reach does not exist for
 * them, however well it is tested, so this screen gives each one the smallest honest
 * surface — what it says, and the action it offers — ahead of Phase 9's real presentation.
 *
 * REQ-TEC-010: no game logic here. Every number and sentence comes from the system that
 * produced it, and every action goes out through `GuildCommands`.
 */

import type { Session } from '../app/Session.js';
import type { GuildCommands } from '../app/GuildCommands.js';
import type { HunterId } from '../core/ids.js';

const el = (tag: string, className?: string, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const button = (label: string, onClick: () => void, disabled = false): HTMLButtonElement => {
  const node = el('button', 'small', label) as HTMLButtonElement;
  node.disabled = disabled;
  node.onclick = onClick;
  return node;
};

const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  startingChoice: 'opening',
  archetype: 'archetype',
  convenience: 'convenience',
  system: 'system',
  worldVariant: 'world variant',
  prestige: 'prestige',
};

export class HallView {
  private message: string | undefined;
  private messageIsError = false;
  private crafterId: string | undefined;

  constructor(
    private readonly host: HTMLElement,
    private readonly session: Session,
    private readonly commands: GuildCommands,
  ) {}

  render(): void {
    this.host.replaceChildren();
    if (this.message) {
      this.host.append(el('p', this.messageIsError ? 'err' : 'points', this.message));
    }
    const grid = el('div', 'grid');
    grid.append(
      this.renderInstitution(),
      this.renderContracts(),
      this.renderCrafting(),
      this.renderChronicle(),
      this.renderMonument(),
    );
    // REQ-UX-001: the Legacy layer is disclosed when the guild has something to spend or
    // someone to remember — until then, one card says what it is and how it opens.
    const legacyStarted =
      this.session.legacy.lifetimePoints > 0 ||
      this.session.newGamePlus.cycle > 0 ||
      this.session.mentors.all().length > 0;
    if (legacyStarted) {
      grid.append(this.renderLegacy(), this.renderMentors(), this.renderNewGamePlus());
    } else {
      const teaser = el('div', 'card');
      teaser.append(el('h3', undefined, 'Legacy'));
      teaser.append(
        el(
          'p',
          'subhead',
          'Historic achievements — a first Red frontier, a new town stage, a world boss, a contract done for the first time — earn Legacy points. ' +
            'They open new options for this guild and the next: mentors, openings, world variants. Never raw power.',
        ),
      );
      grid.append(teaser);
    }
    this.host.append(grid);
  }

  // --- The guild's history, across every hunter (v1.0 §11) -----------------

  private renderChronicle(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'Guild Chronicle'));
    // A party shares its moments, so the same entry appears in each member's Chronicle.
    // The guild's history says it once, with everyone who was there.
    const grouped = new Map<string, { tick: number; text: string; level: string; names: string[] }>();
    for (const record of this.session.chronicle.all()) {
      const name = this.session.roster.get(record.hunterId)?.name ?? 'a hunter no longer with the guild';
      for (const entry of record.notable) {
        if (entry.level === 'minor') continue;
        const key = `${entry.tick}|${entry.text}`;
        const group = grouped.get(key) ?? { tick: entry.tick, text: entry.text, level: entry.level, names: [] };
        group.names.push(name);
        grouped.set(key, group);
      }
    }
    const entries = [...grouped.values()]
      .map((g) => ({ tick: g.tick, level: g.level, line: `${listNames(g.names)}: ${g.text}` }))
      .sort((a, b) => b.tick - a.tick);
    if (entries.length === 0) card.append(el('p', 'empty', 'Nothing remarkable has happened yet.'));
    for (const entry of entries.slice(0, 15)) {
      card.append(el('p', entry.level === 'historic' ? 'points' : 'subhead', entry.line));
    }
    return card;
  }

  private say(message: string, isError = false): void {
    this.message = message;
    this.messageIsError = isError;
    this.render();
  }

  // --- Guild Mastery and Capability (REQ-CAP-001: readings, never a score) ---

  private renderInstitution(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'The guild as an institution'));
    const mastery = this.session.guildMastery;
    card.append(el('p', 'headline', `Guild Mastery ${mastery.level()}`));
    card.append(el('p', 'subhead', `${Math.round(mastery.points)} points of institutional experience`));
    const vector = this.session.capability.read();
    for (const [axis, value] of Object.entries(vector)) {
      card.append(el('p', 'subhead', `${axis}: ${value.toFixed(1)}`));
    }
    card.append(el('p', 'subhead', 'Seven readings, deliberately never added together.'));
    return card;
  }

  // --- REQ-CON-001: analysed before acceptance; only the player accepts ------

  private renderContracts(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'Contracts'));

    const active = this.session.contracts.active();
    if (active) {
      card.append(el('p', 'name', `Active: ${active.name} for ${active.clientName}`));
      const regionName = this.session.content.worldRegionsById.get(active.regionId)?.name ?? active.regionId;
      card.append(el('p', 'subhead', `Send an expedition to ${regionName} with the "${active.objective}" objective.`));
      if (active.challenge) card.append(el('p', 'err', `Challenge: ${active.challenge.summary}`));
      card.append(
        button('Abandon', () => {
          const result = this.commands.abandonContract();
          this.say(result.ok ? `Walked away from ${result.value.name}. ${result.value.clientName} will remember.` : result.error, !result.ok);
        }),
      );
    }

    for (const analysis of this.commands.contractBoard()) {
      const block = el('div', 'dept-block');
      const offer = analysis.offer;
      const standing = this.session.factions.value(offer.factionId);
      block.append(el('p', 'name', `${offer.name} — ${offer.clientName} (standing ${standing})`));
      block.append(el('p', 'subhead', `${offer.reward.gold}g · ${offer.reward.food} provisions · ${offer.reward.materials} materials · reputation ${offer.reputation}`));
      block.append(el('p', analysis.recommendation === 'ready' ? 'points' : 'err', `Guild AI: ${analysis.recommendation}`));
      for (const reason of analysis.reasons) block.append(el('p', 'subhead', `· ${reason}`));
      block.append(
        button('Accept', () => {
          const result = this.commands.acceptContract(offer.offerId);
          this.say(result.ok ? `Accepted ${result.value.name}.` : result.error, !result.ok);
        }, active !== undefined),
      );
      card.append(block);
    }

    // REQ-UX-001's progressive disclosure: say what the next tier of work needs.
    const locked = this.commands.lockedContracts();
    if (locked.length > 0) {
      card.append(el('p', 'name', 'Not yet offered to the guild'));
      for (const entry of locked) {
        const label = entry.template.challenge ? `${entry.template.name} (challenge)` : entry.template.name;
        card.append(el('p', 'subhead', `${label} — ${entry.clientName} wants ${entry.missing.join('; ')}`));
      }
    }
    return card;
  }

  // --- REQ-ECO-004: craft is certainty, loot is the jackpot -----------------

  private renderCrafting(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'Crafting'));

    const available = this.session.roster.all().filter((hunter) => hunter.availability.state === 'available');
    if (available.length === 0) {
      card.append(el('p', 'empty', 'Nobody is free to craft.'));
    } else {
      if (!this.crafterId || !available.some((hunter) => hunter.id === this.crafterId)) {
        this.crafterId = available[0]?.id;
      }
      const select = el('select') as HTMLSelectElement;
      for (const hunter of available) {
        const option = el('option', undefined, `${hunter.name} (level ${hunter.level})`) as HTMLOptionElement;
        option.value = hunter.id;
        option.selected = hunter.id === this.crafterId;
        select.append(option);
      }
      select.onchange = () => {
        this.crafterId = select.value;
        this.render();
      };
      card.append(select);

      for (const recipe of this.session.crafting.recipes()) {
        const preview = this.commands.craftingPreview(recipe.id, this.crafterId as HunterId);
        if (!preview.ok) continue;
        const p = preview.value;
        const block = el('div', 'dept-block');
        block.append(el('p', 'name', `${recipe.name} — ${recipe.rarity} ${recipe.typeId}, item level ${recipe.itemLevel}`));
        const cost = Object.entries(recipe.cost).map(([id, amount]) => `${amount} ${this.session.content.resourcesById.get(id)?.name ?? id}`).join(', ');
        block.append(el('p', 'subhead', `${cost} · ${p.durationSteps} steps · quality at least ${Math.round(p.qualityFloor * 100)}%`));
        if (!p.workshopBuilt) block.append(el('p', 'err', `Needs a ${recipe.building.replace(/_/g, ' ')}.`));
        else if (!p.affordable) block.append(el('p', 'err', 'The guild cannot afford the inputs.'));
        block.append(
          button('Craft', () => {
            const result = this.commands.craftItem(recipe.id, this.crafterId as HunterId);
            this.say(result.ok ? `${result.value.item.name} is on the bench.` : result.error, !result.ok);
          }, !p.workshopBuilt || !p.affordable),
        );
        card.append(block);
      }
    }

    const orders = this.session.crafting.active();
    if (orders.length > 0) {
      card.append(el('p', 'name', 'On the bench'));
      const ticksPerStep = this.session.clock.coarseStepRatio;
      for (const order of orders) {
        const crafter = this.session.roster.get(order.crafterId as HunterId);
        const steps = Math.max(0, Math.ceil((order.readyAtTick - this.session.clock.tick) / ticksPerStep));
        card.append(el('p', 'subhead', `${order.item.name} — ${crafter?.name ?? 'someone'}, ${steps} steps left`));
      }
    }
    return card;
  }

  // --- REQ-MON-001 -----------------------------------------------------------

  private renderMonument(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'The Guild Monument'));
    const entries = this.session.monument.all();
    if (entries.length === 0) card.append(el('p', 'empty', 'Nothing is carved here yet.'));
    for (const entry of [...entries].reverse().slice(0, 12)) {
      card.append(el('p', 'name', entry.title));
      card.append(el('p', 'subhead', entry.detail));
    }
    return card;
  }

  // --- REQ-LEG-001: breadth, never raw power -------------------------------

  private renderLegacy(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'Legacy'));
    const legacy = this.session.legacy;
    card.append(el('p', 'headline', `${legacy.points} Legacy points`));
    card.append(el('p', 'subhead', `${legacy.lifetimePoints} earned across every cycle`));
    for (const unlock of legacy.catalogue()) {
      const owned = legacy.has(unlock.id);
      const row = el('div', 'build-row');
      row.append(
        button(owned ? `${unlock.name} ✓` : `${unlock.name} — ${unlock.cost}`, () => {
          const result = this.commands.purchaseLegacyUnlock(unlock.id);
          this.say(result.ok ? `${result.value.name} unlocked.` : result.error, !result.ok);
        }, owned || legacy.points < unlock.cost),
        el('span', 'meta', `${CATEGORY_LABEL[unlock.category] ?? unlock.category} · ${unlock.description}`),
      );
      card.append(row);
    }
    return card;
  }

  // --- REQ-LEG-004: the player retires; the AI never does -----------------

  private renderMentors(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'Mentors'));
    const mentors = this.session.mentors;
    const rules = this.session.content.progression.apprentices;
    for (const mentor of mentors.all()) {
      card.append(el('p', 'name', `${mentor.name} — ${mentor.speciality} mentor, retired at ${mentor.retiredAtLevel}`));
      const traits = mentor.legacyTraits
        .map((id) => this.session.content.traitsById.get(id))
        .filter((trait): trait is NonNullable<typeof trait> => trait?.origin === 'legacy');
      for (const trait of traits) card.append(el('p', 'subhead', `Legacy Trait — ${trait.name}: ${trait.description}`));

      // Generational play: an apprentice, who may inherit one Legacy Trait the player picks.
      const taken = mentors.apprenticesOf(mentor.hunterId);
      if (taken >= rules.perMentor) {
        card.append(el('p', 'subhead', `${mentor.name} has trained their apprentice.`));
        continue;
      }
      const row = el('div', 'build-row');
      const choices = traits.length > 0 ? traits.map((trait) => trait.id) : [undefined];
      for (const choice of choices) {
        const name = choice ? this.session.content.traitsById.get(choice)?.name : undefined;
        row.append(
          button(name ? `Take an apprentice — inherits ${name} (${rules.goldCost}g)` : `Take an apprentice (${rules.goldCost}g)`, () => {
            const result = this.commands.takeApprentice(mentor.hunterId, choice);
            this.say(result.ok ? `${result.value.name} is apprenticed to ${mentor.name}.` : result.error, !result.ok);
          }),
        );
      }
      card.append(row);
    }
    if (mentors.all().length > 0) {
      card.append(el('p', 'subhead', `EXP ×${mentors.experienceScale().toFixed(2)} · practice ×${mentors.practiceScale().toFixed(2)}`));
    }

    if (!this.session.legacy.has('mentor_hall')) {
      card.append(el('p', 'empty', 'Retirement needs the Mentor Hall Legacy unlock.'));
      return card;
    }
    const minLevel = this.session.content.progression.retirement.minLevel;
    const eligible = this.session.roster.all().filter((hunter) => hunter.level >= minLevel);
    if (eligible.length === 0) card.append(el('p', 'empty', `Hunters can retire from level ${minLevel}.`));
    for (const hunter of eligible) {
      card.append(
        button(`Retire ${hunter.name} (level ${hunter.level})`, () => {
          const result = this.commands.retireHunter(hunter.id);
          this.say(result.ok ? `${result.value.name} now teaches.` : result.error, !result.ok);
        }, hunter.availability.state !== 'available'),
      );
    }
    return card;
  }

  // --- REQ-LEG-002/003 -------------------------------------------------------

  private renderNewGamePlus(): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'New Game+'));
    const cycle = this.session.newGamePlus.cycle;
    card.append(el('p', 'subhead', cycle === 0 ? 'The first generation.' : `Cycle ${cycle}.`));
    const variant = this.session.worldVariant();
    if (variant) card.append(el('p', 'points', `${variant.name}: ${variant.description}`));
    card.append(
      el(
        'p',
        'subhead',
        'Begins a new world. The roster, town, economy, reputation, research and Monument reset; Legacy and ' +
          'the mentors you choose carry over. These carry-over rules are a default awaiting design approval.',
      ),
    );

    const owned = this.session.legacy.unlocks();
    const choose = (category: string, none: string): HTMLSelectElement => {
      const select = el('select') as HTMLSelectElement;
      select.append(Object.assign(el('option', undefined, none) as HTMLOptionElement, { value: '' }));
      for (const unlock of owned.filter((u) => u.category === category)) {
        select.append(Object.assign(el('option', undefined, unlock.name) as HTMLOptionElement, { value: unlock.id }));
      }
      card.append(select);
      return select;
    };
    const opening = choose('startingChoice', 'Standard opening');
    const archetype = choose('archetype', 'No extra archetype');
    const world = choose('worldVariant', 'Standard world');

    const mentorBoxes: [string, HTMLInputElement][] = [];
    for (const mentor of this.session.mentors.all()) {
      const label = el('label', 'subhead');
      const box = el('input') as HTMLInputElement;
      box.type = 'checkbox';
      box.checked = true;
      label.append(box, document.createTextNode(` Keep ${mentor.name} as a mentor`));
      card.append(label);
      mentorBoxes.push([mentor.hunterId, box]);
    }

    let armed = false;
    const begin = button('Begin a new cycle…', () => {
      if (!armed) {
        armed = true;
        begin.textContent = 'Confirm: this resets the world';
        return;
      }
      const result = this.commands.beginNewGamePlus({
        ...(opening.value ? { startingChoice: opening.value } : {}),
        ...(archetype.value ? { archetype: archetype.value } : {}),
        ...(world.value ? { worldVariant: world.value } : {}),
        mentorIds: mentorBoxes.filter(([, box]) => box.checked).map(([id]) => id),
      });
      this.say(result.ok ? `Cycle ${result.value} begins. A new guild is founded.` : result.error, !result.ok);
    });
    card.append(begin);
    return card;
  }
}

function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
