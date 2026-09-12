/**
 * Hunter Build Identity Dashboard.
 *
 * REQ-UX-003 (§108): the player should be able to answer "what kind of Hunter is this?"
 * at a glance — class, attributes, skills, mastery, personality, potential, AI tendencies,
 * synergies, weaknesses, role, chronicle.
 *
 * REQ-TEC-010: the UI holds no game logic. Every rule — what may be allocated, what may be
 * equipped, what a build *means* — is asked of the systems layer. This file decides layout
 * and nothing else. The comparison view exists to make REQ-BLD-003 visible: two hunters of
 * the same class, built differently, must read as different hunters.
 *
 * Presentation is deliberately plain; isometric pixel art (REQ-UX-007) is Phase 9.
 */

import type { Session } from '../app/Session.js';
import type { GuildCommands } from '../app/GuildCommands.js';
import { ATTRIBUTE_KEYS, ROLES, RANGE_BANDS } from '../data/schema.js';
import type { AttributeKey, Role } from '../data/schema.js';
import { DERIVED_STAT_DISPLAY_ORDER, computeDerivedStats } from '../core/hunter/attributes.js';
import { unspentAttributePoints, type Hunter } from '../core/hunter/Hunter.js';
import { describeBuild, profileDistance } from '../systems/hunter/describeBuild.js';
import { describePotential } from '../core/hunter/potential.js';
import type { HunterId } from '../core/ids.js';
import { EQUIPMENT_SLOTS } from '../data/itemSchema.js';
import { isPerfect, itemQuality, type Item } from '../core/items/Item.js';
import { Equipment } from '../systems/items/Equipment.js';
import type { RefineResult } from '../systems/items/Refinement.js';
import { composeTagPhrase, generateBuildTags } from '../systems/hunter/buildTags.js';
import { describeAvailability } from '../core/hunter/availability.js';
import { asSkillId } from '../core/ids.js';
import { preferences } from './preferences.js';
import { activatable } from './a11y.js';

interface DashboardState {
  selected: HunterId | undefined;
  compareWith: HunterId | undefined;
  message: string | undefined;
  messageIsError: boolean;
}

const el = (tag: string, className?: string, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const pct = (value: number): string => `${Math.round(value * 100)}%`;

export class BuildDashboard {
  private readonly state: DashboardState = {
    selected: undefined,
    compareWith: undefined,
    message: undefined,
    messageIsError: false,
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly session: Session,
    private readonly commands: GuildCommands,
  ) {}

  mount(): void {
    this.render();
  }

  select(hunterId: HunterId): void {
    this.state.selected = hunterId;
    this.state.compareWith = undefined;
    this.render();
  }

  private notify(message: string, isError = false): void {
    this.state.message = message;
    this.state.messageIsError = isError;
    this.render();
  }

  // --- Layout ---------------------------------------------------------------

  private render(): void {
    this.root.replaceChildren();

    const app = el('div');
    app.id = 'app';
    app.append(this.renderHeader(), this.renderMain());
    this.root.append(app);
  }

  private renderHeader(): HTMLElement {
    const header = el('header');
    header.append(el('h1', undefined, "Hunter's Guild: Frontier"));
    header.append(el('span', 'seed', `seed ${this.session.worldSeed}`));
    header.append(el('span', 'spacer'));

    if (this.state.message) {
      header.append(
        el('span', this.state.messageIsError ? 'err' : 'points', this.state.message),
      );
    }

    const recruit = el('button', undefined, 'Recruit hunter') as HTMLButtonElement;
    recruit.onclick = () => {
      const hunter = this.commands.recruit();
      this.state.selected = hunter.id;
      this.notify(`${hunter.name} joined the guild.`);
    };

    const save = el('button', undefined, 'Save') as HTMLButtonElement;
    save.onclick = () => {
      const result = this.session.save.autoSave(this.session.snapshot());
      this.notify(
        result.ok ? 'Guild saved.' : `Save failed: ${result.error}`,
        !result.ok,
      );
    };

    const load = el('button', undefined, 'Load') as HTMLButtonElement;
    load.onclick = () => {
      const result = this.session.save.load('autosave');
      if (!result.ok) {
        this.notify(`Load failed: ${result.error}`, true);
        return;
      }
      this.session.restore(result.value);
      this.state.selected = this.session.roster.all()[0]?.id;
      this.state.compareWith = undefined;
      this.notify(`Loaded ${result.value.hunters.length} hunters.`);
    };

    header.append(recruit, save, load);
    return header;
  }

  private renderMain(): HTMLElement {
    const main = el('main');
    main.append(this.renderRoster(), this.renderDetail());
    return main;
  }

  private renderRoster(): HTMLElement {
    const panel = el('div');
    panel.id = 'roster';
    panel.append(el('h2', undefined, `Roster (${this.session.roster.size})`));

    const hunters = this.session.roster.all();
    if (hunters.length === 0) {
      panel.append(el('p', 'empty', 'No hunters yet. Recruit one.'));
      return panel;
    }

    for (const hunter of hunters) {
      const profile = this.session.buildIdentity.profileOf(hunter);
      const row = el('div', 'hunter-row');
      if (hunter.id === this.state.selected) row.classList.add('selected');
      if (hunter.id === this.state.compareWith) row.classList.add('compare');

      row.append(el('div', 'name', hunter.name));
      row.append(
        el(
          'div',
          'meta',
          `Lv ${hunter.level} · ${this.session.constellation.describeIdentity(hunter)} · ${profile.primaryRole}`,
        ),
      );

      activatable(row, (event) => {
        // Shift-click (or Shift+Enter) picks the comparison hunter — how REQ-BLD-003 is inspected.
        if (event.shiftKey && hunter.id !== this.state.selected) {
          this.state.compareWith =
            this.state.compareWith === hunter.id ? undefined : hunter.id;
        } else {
          this.state.selected = hunter.id;
        }
        this.render();
      }, `${hunter.name}, level ${hunter.level}`);
      if (hunter.id === this.state.selected) row.setAttribute('aria-current', 'true');

      panel.append(row);
    }

    panel.append(el('p', 'empty', 'Shift-click (or Shift+Enter) a second hunter to compare builds.'));
    return panel;
  }

  private renderDetail(): HTMLElement {
    const detail = el('div');
    detail.id = 'detail';

    const hunter = this.state.selected
      ? this.session.roster.get(this.state.selected)
      : undefined;

    if (!hunter) {
      detail.append(el('p', 'empty', 'Select a hunter.'));
      return detail;
    }

    detail.append(this.renderIdentityCard(hunter));

    const grid = el('div', 'grid');
    grid.append(
      this.renderBuildProfileCard(hunter),
      this.renderAttributesCard(hunter),
      this.renderDerivedCard(hunter),
      this.renderEquipmentCard(hunter),
      this.renderSkillsCard(hunter),
      this.renderPotentialCard(hunter),
      this.renderTraitsCard(hunter),
      this.renderChronicleCard(hunter),
      this.renderArmouryCard(hunter),
    );
    detail.append(grid);

    const comparison = this.renderComparisonCard(hunter);
    if (comparison) detail.append(comparison);

    return detail;
  }

  // --- Cards ----------------------------------------------------------------

  private renderIdentityCard(hunter: Hunter): HTMLElement {
    const card = el('div', 'card');
    const profile = this.session.buildIdentity.profileOf(hunter);
    const description = describeBuild(profile);

    card.append(el('div', 'headline', hunter.name));
    card.append(
      el(
        'p',
        'subhead',
        `Level ${hunter.level} · ${this.session.constellation.describeIdentity(hunter)} · ` +
          `${this.session.personality.definition(hunter.personalityId)?.name ?? 'unknown'} · ` +
          `${hunter.potential.tier} potential`,
      ),
    );
    card.append(el('p', undefined, description.summary));

    // v1.0 §5 — generated build tags. Derived on every render from the current build, never
    // stored, so they cannot drift from what the hunter actually is.
    const tags = generateBuildTags(profile);
    if (tags.length > 0) {
      const tagRow = el('div');
      tagRow.append(el('span', 'tag-phrase', composeTagPhrase(tags)));
      for (const tag of tags) {
        const chip = el('span', `tag tag-${tag.kind}`, tag.label);
        chip.title = `${tag.because} (${Math.round(tag.confidence * 100)}% confidence)`;
        tagRow.append(chip);
      }
      card.append(tagRow);
    }

    card.append(
      el('p', 'subhead', `Status: ${describeAvailability(hunter.availability)}`),
    );
    const rebirths = hunter.rebirths ?? 0;
    const rebirthRules = this.session.content.progression.rebirth;
    card.append(el('p', 'subhead', `Rebirth ${rebirths}/${rebirthRules.maxRebirths} · ${hunter.constellationBypasses ?? 0} constellation bypass${(hunter.constellationBypasses ?? 0) === 1 ? '' : 'es'} available`));
    if (hunter.level >= this.session.content.balance.attributes.maxLevel && rebirths < rebirthRules.maxRebirths) {
      const nextRank = rebirths + 1;
      const choices = nextRank === rebirthRules.awakenedAt ? rebirthRules.awakenedTraitIds : [undefined];
      for (const traitId of choices) {
        const trait = traitId ? this.session.content.traitsById.get(traitId) : undefined;
        const button = el('button', 'small', trait ? `Rebirth with ${trait.name}` : `Rebirth to rank ${nextRank}`) as HTMLButtonElement;
        button.title = `${rebirthRules.goldCost} gold and ${rebirthRules.insightCrystalCost} Insight Crystals`;
        button.onclick = () => {
          const result = this.commands.rebirth(hunter.id, traitId);
          this.notify(result.ok ? `${hunter.name} completed rebirth ${nextRank}.` : result.error, !result.ok);
        };
        card.append(button);
      }
    }

    // v1.0 §5: the constellation replaces class advancement. Available nodes are offered;
    // the frontier is shown with its unmet requirements so the tree explains itself.
    const constellation = el('div');

    for (const node of this.session.constellation.availableNodes(hunter)) {
      const skillName = this.session.registry.get(node.skill)?.name ?? node.skill;
      const regionName = this.session.constellation.region(node.region)?.name ?? node.region;

      const button = el('button', 'small', `Learn: ${skillName}`) as HTMLButtonElement;
      button.style.marginRight = '6px';
      button.title = `${regionName} region`;
      button.onclick = () => {
        const result = this.commands.takeNode(hunter.id, node.id);
        this.notify(result.ok ? `${hunter.name} learned ${skillName}.` : result.error, !result.ok);
      };
      constellation.append(button);
    }

    // The frontier: reachable but not yet takeable, with every unmet requirement on hover.
    // v1.0 §5 wants skill books visible as requirements in the tree; this is where they show.
    for (const blocked of this.session.constellation.frontierNodes(hunter).slice(0, 5)) {
      const node = this.session.constellation.node(blocked.nodeId);
      const label = this.session.registry.get(node?.skill ?? '')?.name ?? blocked.nodeId;

      const bypassed = this.session.constellation.eligibility(hunter, blocked.nodeId, true);
      if ((hunter.constellationBypasses ?? 0) > 0 && bypassed.eligible) {
        const button = el('button', 'small', `Bypass level: ${label}`) as HTMLButtonElement;
        button.title = 'Spend one rebirth constellation bypass; other requirements still apply.';
        button.onclick = () => {
          const result = this.commands.takeNode(hunter.id, blocked.nodeId, true);
          this.notify(result.ok ? `${hunter.name} learned ${label} early.` : result.error, !result.ok);
        };
        constellation.append(button);
      } else {
        const chip = el('span', 'tag', label);
        chip.title = blocked.unmet.join('\n');
        chip.style.opacity = '0.55';
        constellation.append(chip);
      }
    }

    card.append(constellation);

    return card;
  }

  private renderBuildProfileCard(hunter: Hunter): HTMLElement {
    const card = el('div', 'card');
    const profile = this.session.buildIdentity.profileOf(hunter);
    const description = describeBuild(profile);

    card.append(el('h3', undefined, 'Build Identity'));

    for (const role of ROLES) {
      card.append(this.bar(role, profile.roleLean[role] ?? 0, role));
    }

    card.append(el('h3', undefined, 'Range'));
    for (const band of RANGE_BANDS) {
      card.append(this.bar(band, profile.rangeBand[band] ?? 0, 'neutral'));
    }

    card.append(el('h3', undefined, 'Disposition'));
    card.append(this.bar('risk', profile.riskPosture, 'neutral'));
    card.append(this.bar('sustain', profile.resourceProfile, 'neutral'));
    card.append(this.bar('versatility', profile.versatility, 'neutral'));
    card.append(this.bar('focus', profile.focus, 'neutral'));

    card.append(el('h3', undefined, `Tendencies (${profile.shape})`));
    const tendencies = el('ul', 'notes');
    for (const line of description.tendencies) tendencies.append(el('li', undefined, line));
    card.append(tendencies);

    if (description.weaknesses.length > 0) {
      card.append(el('h3', undefined, 'Weaknesses'));
      const weaknesses = el('ul', 'notes weak');
      for (const line of description.weaknesses) weaknesses.append(el('li', undefined, line));
      card.append(weaknesses);
    }

    // REQ-UX-002 Advanced: the numbers the AI actually reads, hidden unless asked for.
    if (preferences().detail === 'advanced') {
      card.append(el('h3', undefined, 'What the AI reads'));
      const table = el('table', 'kv');
      const rows: [string, string][] = [
        ['primary role', `${profile.primaryRole}${profile.secondaryRole ? ` / ${profile.secondaryRole}` : ''}`],
        ['risk posture', profile.riskPosture.toFixed(3)],
        ['resource profile', profile.resourceProfile.toFixed(3)],
        ['versatility', profile.versatility.toFixed(3)],
        ['focus', profile.focus.toFixed(3)],
        ['ally safety', (profile.allySafety ?? 0).toFixed(3)],
        ...Object.entries(profile.skillAffinity)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([tag, weight]): [string, string] => [`affinity: ${tag}`, weight.toFixed(3)]),
      ];
      for (const [label, value] of rows) {
        const row = el('tr');
        row.append(el('td', undefined, label), el('td', 'num', value));
        table.append(row);
      }
      card.append(table);
    }

    return card;
  }

  /** Traits (innate and inherited), condition, and the people this hunter is close to. */
  private renderTraitsCard(hunter: Hunter): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'Traits & bonds'));
    const traits = hunter.traitIds
      .map((id) => this.session.content.traitsById.get(id))
      .filter((trait): trait is NonNullable<typeof trait> => trait !== undefined);
    if (traits.length === 0) card.append(el('p', 'empty', 'No notable traits.'));
    for (const trait of traits) {
      card.append(el('p', 'name', `${trait.name}${trait.origin === 'legacy' ? ' (Legacy)' : trait.origin === 'awakened' ? ' (Awakened)' : ''}`));
      card.append(el('p', 'subhead', trait.description));
      if (preferences().detail === 'advanced') {
        card.append(el('p', 'log-line', Object.entries(trait.effects).map(([k, v]) => `${k} ${v}`).join(', ')));
      }
    }

    const condition = hunter.condition;
    card.append(el('h3', undefined, 'Condition'));
    card.append(this.bar('fatigue', condition.fatigue, 'neutral'));
    card.append(this.bar('hunger', condition.hunger, 'neutral'));
    card.append(this.bar('morale', condition.morale, 'neutral'));

    card.append(el('h3', undefined, 'Friends'));
    const bonds = this.session.friendship.bondsOf(hunter.id).slice(0, 5);
    if (bonds.length === 0) card.append(el('p', 'empty', 'Nobody close yet. Bonds grow on shared expeditions and rescues.'));
    for (const bond of bonds) {
      const other = this.session.roster.get(bond.with)?.name ?? 'someone who has left';
      card.append(el('p', bond.friends ? 'points' : 'subhead', `${other} — ${bond.friends ? 'friends' : 'getting to know each other'} (${Math.round(bond.strength * 100)}%)`));
    }
    return card;
  }

  private renderAttributesCard(hunter: Hunter): HTMLElement {
    const card = el('div', 'card');
    const balance = this.session.content.balance.attributes;
    const remaining = unspentAttributePoints(hunter, balance);

    card.append(el('h3', undefined, 'Attributes'));
    card.append(el('div', 'points', `${remaining} unspent point${remaining === 1 ? '' : 's'}`));

    for (const key of ATTRIBUTE_KEYS) {
      const row = el('div', 'attr-row');
      row.append(el('span', 'key', key));
      row.append(el('span'));
      row.append(el('span', 'val', String(hunter.attributes[key])));

      const buttons = el('span');
      buttons.append(this.allocButton(hunter.id, key, -1, '−'));
      buttons.append(this.allocButton(hunter.id, key, 1, '+', remaining <= 0));
      row.append(buttons);

      card.append(row);
    }

    const maxOut = el('div');
    maxOut.style.marginTop = '8px';
    for (const key of ATTRIBUTE_KEYS) {
      const button = el('button', 'small', `all ${key}`) as HTMLButtonElement;
      button.style.marginRight = '4px';
      button.disabled = remaining <= 0;
      button.onclick = () => {
        const result = this.commands.spendAllOn(hunter.id, key);
        this.notify(result.ok ? `Spent every point on ${key}.` : result.error, !result.ok);
      };
      maxOut.append(button);
    }
    card.append(maxOut);

    const price = this.commands.respecPrice(hunter.id);
    const priceName = this.session.content.resourcesById.get(price.resourceId)?.name ?? price.resourceId;
    const respec = el('button', 'small', `Respec to base — ${price.amount} ${priceName}`) as HTMLButtonElement;
    respec.style.marginTop = '8px';
    respec.onclick = () => {
      const result = this.commands.respec(hunter.id);
      this.notify(result.ok ? `${hunter.name} reallocated everything.` : result.error, !result.ok);
    };
    card.append(respec);

    return card;
  }

  private renderDerivedCard(hunter: Hunter): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'Derived Stats'));

    const multiplier = this.session.condition.statMultiplier(hunter);
    const balance = this.session.content.balance.attributes;
    const gear = this.session.equipment.aggregateStats(hunter);

    const bare = computeDerivedStats(hunter.attributes, hunter.level, balance, {
      globalMultiplier: multiplier,
    });
    const withGear = computeDerivedStats(hunter.attributes, hunter.level, balance, {
      globalMultiplier: multiplier,
      flat: gear,
    });

    const table = el('table', 'kv');
    for (const name of DERIVED_STAT_DISPLAY_ORDER) {
      const total = Math.round((withGear[name] ?? 0) * 10) / 10;
      const fromGear = Math.round(((withGear[name] ?? 0) - (bare[name] ?? 0)) * 10) / 10;

      const row = el('tr');
      row.append(el('td', undefined, name));
      row.append(el('td', 'num', String(total)));
      // Showing the gear share separately answers "is this stat coming from my build or my
      // loot?", which is the question a player actually has when comparing two hunters.
      row.append(el('td', 'num', fromGear !== 0 ? `+${fromGear}` : ''));
      table.append(row);
    }
    card.append(table);

    card.append(el('h3', undefined, 'Condition'));
    const condition = el('ul', 'notes');
    for (const line of this.session.condition.describe(hunter)) {
      condition.append(el('li', undefined, line));
    }
    card.append(condition);

    return card;
  }

  private renderSkillsCard(hunter: Hunter): HTMLElement {
    const card = el('div', 'card');
    card.append(
      el('h3', undefined, `Skills — ${hunter.loadout.length} equipped / ${hunter.knownSkills.length} known`),
    );

    if (hunter.knownSkills.length === 0) {
      card.append(el('p', 'empty', 'Knows nothing yet.'));
    }

    for (const skillId of hunter.knownSkills) {
      const def = this.session.registry.get(skillId);
      if (!def) continue;
      const equipped = hunter.loadout.includes(skillId);
      const mastery = this.session.mastery.points(hunter, skillId);

      const tag = el(
        'button',
        `tag${equipped ? ' equipped' : ''}`,
        `${def.name}${mastery > 0 ? ` · ${Math.round(mastery)}` : ''}`,
      ) as HTMLButtonElement;
      tag.title = `${def.category} · ${def.description}`;
      tag.onclick = () => {
        const result = equipped
          ? this.commands.unequipSkill(hunter.id, String(skillId))
          : this.commands.equipSkill(hunter.id, String(skillId));
        this.notify(
          result.ok ? `${def.name} ${equipped ? 'unequipped' : 'equipped'}.` : result.error,
          !result.ok,
        );
      };
      card.append(tag);
    }

    card.append(el('h3', undefined, 'Train a skill'));
    for (const skillId of hunter.loadout) {
      const def = this.session.registry.get(skillId);
      if (!def) continue;
      const train = el('button', 'small', `use ${def.name} ×50`) as HTMLButtonElement;
      train.style.margin = '0 4px 4px 0';
      train.onclick = () => {
        this.commands.practiseSkill(hunter.id, String(skillId), 50, 'difficult');
        this.notify(`${hunter.name} practised ${def.name}.`);
      };
      card.append(train);
    }

    const learnable = this.session.constellation
      .availableNodes(hunter)
      .map((node) => this.session.registry.get(node.skill))
      .filter((def): def is NonNullable<typeof def> => def !== undefined)
      .filter((def) => !hunter.knownSkills.includes(asSkillId(def.id)));

    if (learnable.length > 0) {
      card.append(el('h3', undefined, 'Can learn'));
      for (const def of learnable) {
        const button = el('button', 'small', def.name) as HTMLButtonElement;
        button.style.margin = '0 4px 4px 0';
        button.onclick = () => {
          const result = this.commands.learnFromBook(hunter.id, def.id);
          this.notify(
            result.ok ? `${hunter.name} learned ${def.name}.` : result.error,
            !result.ok,
          );
        };
        card.append(button);
      }
    }

    return card;
  }

  /**
   * Equipment, slot by slot.
   *
   * Shows roll quality and refinement alongside the item name, because REQ-EQP-021 makes
   * two copies of the same item genuinely different and a dashboard that hid that would be
   * hiding the main reason to care about a drop.
   */
  private renderEquipmentCard(hunter: Hunter): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, 'Equipment'));

    const allHunters = this.session.roster.all();

    for (const slot of EQUIPMENT_SLOTS) {
      const row = el('div', 'slot-row');
      row.append(el('span', 'slot-name', slot));

      const itemId = hunter.equipment[slot];
      const item = itemId !== null ? this.session.armoury.get(itemId) : undefined;

      if (item) {
        const rarity = this.session.content.raritiesById.get(item.rarity);
        const label = el(
          'span',
          'slot-item',
          `${item.name}${item.refinement > 0 ? ` +${item.refinement}` : ''}`,
        );
        if (rarity) label.style.color = rarity.colour;
        label.title = this.describeItem(item);
        row.append(label);

        row.append(
          el('span', 'slot-quality', `${Math.round(itemQuality(item) * 100)}%`),
        );

        const actions = el('span');
        const off = el('button', 'small', 'off') as HTMLButtonElement;
        off.onclick = () => {
          const result = this.commands.unequipSlot(hunter.id, slot);
          this.notify(result.ok ? `Unequipped ${item.name}.` : result.error, !result.ok);
        };
        actions.append(off);

        if (!this.session.refinement.isAtMax(item)) {
          const refine = el('button', 'small', '+1') as HTMLButtonElement;
          refine.title = this.session.refinement.describeNextAttempt(item);
          refine.onclick = () => {
            const result = this.commands.refineItem(String(item.id));
            if (!result.ok) return this.notify(result.error, true);
            return this.notify(this.describeRefineOutcome(item.name, result.value));
          };
          actions.append(refine);
        }
        row.append(actions);
      } else {
        row.append(el('span', 'slot-item empty', '—'));
        row.append(el('span', 'slot-quality'));

        const available = this.session.equipment.availableFor(hunter, slot, allHunters);
        const equipBest = el('button', 'small', `equip (${available.length})`) as HTMLButtonElement;
        equipBest.disabled = available.length === 0;
        equipBest.onclick = () => {
          // Best by roll quality, then rarity — the choice a player would make by hand.
          const best = [...available].sort(
            (a, b) => this.itemScore(b) - this.itemScore(a),
          )[0];
          if (!best) return this.notify('nothing available for that slot', true);
          const result = this.commands.equipItem(hunter.id, String(best.id));
          return this.notify(result.ok ? `Equipped ${best.name}.` : result.error, !result.ok);
        };
        row.append(equipBest);
      }

      card.append(row);
    }

    const setLines = this.session.sets.describe(
      this.session.equipment.equippedItems(hunter),
    );
    if (setLines.length > 0) {
      card.append(el('h3', undefined, 'Set bonuses'));
      const list = el('ul', 'notes');
      for (const line of setLines) list.append(el('li', undefined, line));
      card.append(list);
    }

    const effects = Equipment.mergeEffects(this.session.equipment.aggregateEffects(hunter));
    if (effects.length > 0) {
      card.append(el('h3', undefined, 'Gear effects'));
      const list = el('ul', 'notes');
      for (const effect of effects) {
        const qualifier = effect.tag ?? effect.key ?? effect.status ?? '';
        const sign = effect.value >= 0 ? '+' : '';
        list.append(
          el(
            'li',
            undefined,
            `${effect.type}${qualifier ? ` (${qualifier})` : ''}: ${sign}${Math.round(effect.value * 100)}%`,
          ),
        );
      }
      card.append(list);
    }

    return card;
  }

  /** The guild's loose items and cards, plus the actions that dispose of them. */
  private renderArmouryCard(hunter: Hunter): HTMLElement {
    const card = el('div', 'card');
    const equipped = Equipment.equippedIdsAcross(this.session.roster.all());
    const loose = this.session.armoury.all().filter((item) => !equipped.has(item.id));

    card.append(el('h3', undefined, `Armoury — ${loose.length} loose, ${equipped.size} in use`));

    const generate = el('button', 'small', 'Find loot ×10') as HTMLButtonElement;
    generate.style.marginRight = '4px';
    generate.onclick = () => {
      const items = this.debugLoot(hunter.level);
      this.notify(`Recovered ${items} items.`);
    };
    card.append(generate);

    const sellJunk = el('button', 'small', 'Sell below rare') as HTMLButtonElement;
    sellJunk.onclick = () => {
      const result = this.commands.sellJunk('rare');
      this.notify(`Sold ${result.sold} items for ${result.gold} gold.`);
    };
    card.append(sellJunk);

    const cardCounts = this.session.armoury.loseCards();
    if (cardCounts.size > 0) {
      card.append(el('h3', undefined, 'Cards held'));
      for (const [cardId, count] of cardCounts) {
        const def = this.session.cards.get(cardId);
        if (!def) continue;
        const tag = el('span', 'tag', `${def.name} ×${count}`);
        tag.title = `${def.description}\nFits: ${def.compatibleSlots.join(', ')}`;
        card.append(tag);
      }

      card.append(el('h3', undefined, 'Socket into equipped gear'));
      const socket = el('button', 'small', 'Socket what fits') as HTMLButtonElement;
      socket.onclick = () => {
        const socketed = this.socketAvailable(hunter.id);
        this.notify(
          socketed > 0 ? `Socketed ${socketed} card(s).` : 'Nothing fits the current gear.',
          socketed === 0,
        );
      };
      card.append(socket);
    }

    if (loose.length > 0) {
      card.append(el('h3', undefined, 'Best unused, by slot'));
      const bySlot = new Map<string, (typeof loose)[number]>();
      for (const item of loose) {
        const current = bySlot.get(item.slot);
        if (!current || this.itemScore(item) > this.itemScore(current)) {
          bySlot.set(item.slot, item);
        }
      }
      const table = el('table', 'kv');
      for (const [slot, item] of bySlot) {
        const row = el('tr');
        row.append(el('td', undefined, slot));
        const nameCell = el('td', undefined, item.name);
        const rarity = this.session.content.raritiesById.get(item.rarity);
        if (rarity) nameCell.style.color = rarity.colour;
        nameCell.title = this.describeItem(item);
        row.append(nameCell);
        row.append(el('td', 'num', `${Math.round(itemQuality(item) * 100)}%`));
        table.append(row);
      }
      card.append(table);
    }

    return card;
  }

  private renderPotentialCard(hunter: Hunter): HTMLElement {
    const card = el('div', 'card');
    card.append(el('h3', undefined, `Potential — ${hunter.potential.tier}`));

    const table = el('table', 'kv');
    for (const [name, value] of Object.entries(hunter.potential.facets)) {
      const row = el('tr');
      row.append(el('td', undefined, name));
      row.append(el('td', 'num', `×${(Math.round(value * 100) / 100).toFixed(2)}`));
      table.append(row);
    }
    card.append(table);

    const notes = el('ul', 'notes');
    for (const line of describePotential(hunter.potential)) notes.append(el('li', undefined, line));
    card.append(notes);

    if (hunter.traitIds.length > 0) {
      card.append(el('h3', undefined, 'Traits'));
      for (const traitId of hunter.traitIds) {
        const trait = this.session.content.traitsById.get(traitId);
        if (!trait) continue;
        const tag = el('span', 'tag', trait.name);
        tag.title = trait.description;
        card.append(tag);
      }
    }

    return card;
  }

  private renderChronicleCard(hunter: Hunter): HTMLElement {
    const card = el('div', 'card');
    const chronicle = this.session.chronicle.of(hunter.id);

    card.append(el('h3', undefined, 'Chronicle'));

    const table = el('table', 'kv');
    for (const [name, value] of Object.entries(chronicle.counters)) {
      if (value === 0) continue;
      const row = el('tr');
      row.append(el('td', undefined, name));
      row.append(el('td', 'num', String(value)));
      table.append(row);
    }
    if (table.childElementCount === 0) {
      card.append(el('p', 'empty', 'No history yet — this hunter has not been anywhere.'));
    } else {
      card.append(table);
    }

    const favourite = this.session.mastery.favouriteSkill(hunter);
    if (favourite) {
      const def = this.session.registry.get(favourite.skillId);
      card.append(
        el(
          'p',
          undefined,
          `Favourite skill: ${def?.name ?? favourite.skillId} (${Math.round(favourite.points)} mastery)`,
        ),
      );
    }

    if (chronicle.notable.length > 0) {
      const list = el('ul', 'notes');
      for (const entry of [...chronicle.notable].reverse().slice(0, 10)) {
        list.append(el('li', undefined, entry.text));
      }
      card.append(list);
    }

    return card;
  }

  /**
   * Side-by-side build comparison — the visible form of the REQ-BLD-003 acceptance test.
   * Two hunters of the same class built differently should be obviously different here.
   */
  private renderComparisonCard(hunter: Hunter): HTMLElement | undefined {
    if (!this.state.compareWith) return undefined;
    const other = this.session.roster.get(this.state.compareWith);
    if (!other) return undefined;

    const a = this.session.buildIdentity.profileOf(hunter);
    const b = this.session.buildIdentity.profileOf(other);
    const distance = profileDistance(a, b);

    const card = el('div', 'card');
    card.append(
      el('h3', undefined, `Build comparison — distance ${Math.round(distance * 1000) / 1000}`),
    );

    const table = el('table', 'kv');
    const addRow = (label: string, left: string, right: string): void => {
      const row = el('tr');
      row.append(el('td', undefined, label));
      row.append(el('td', 'num', left));
      row.append(el('td', 'num', right));
      table.append(row);
    };

    const head = el('tr');
    head.append(el('td', undefined, ''));
    head.append(el('td', 'num', hunter.name));
    head.append(el('td', 'num', other.name));
    table.append(head);

    addRow('class', this.session.constellation.describeIdentity(hunter), this.session.constellation.describeIdentity(other));
    addRow('primary role', a.primaryRole, b.primaryRole);
    addRow('shape', a.shape, b.shape);
    addRow('range', a.primaryRange, b.primaryRange);
    addRow('risk posture', pct(a.riskPosture), pct(b.riskPosture));
    addRow('sustain', pct(a.resourceProfile), pct(b.resourceProfile));
    addRow('versatility', pct(a.versatility), pct(b.versatility));
    for (const role of ROLES) {
      addRow(role, pct(a.roleLean[role] ?? 0), pct(b.roleLean[role] ?? 0));
    }
    card.append(table);

    card.append(el('p', undefined, `${hunter.name}: ${describeBuild(a).summary}`));
    card.append(el('p', undefined, `${other.name}: ${describeBuild(b).summary}`));

    return card;
  }

  // --- Item helpers ---------------------------------------------------------

  private debugLoot(itemLevel: number): number {
    return this.commands.findLoot(10, itemLevel).length;
  }

  private socketAvailable(hunterId: HunterId): number {
    return this.commands.socketWhatFits(hunterId);
  }

  /** Ranking used by the "equip best" and "best unused" affordances. */
  private itemScore(item: Item): number {
    const rarityRank = this.session.content.rarities.order.indexOf(item.rarity);
    return rarityRank * 10 + itemQuality(item) * 5 + item.refinement;
  }

  /** Tooltip text: main stats, substats with roll quality, sockets, set and unique effect. */
  private describeItem(item: Item): string {
    const lines: string[] = [`${item.name} — item level ${item.itemLevel}`];

    for (const [stat, value] of Object.entries(this.session.equipment.mainStats(item))) {
      lines.push(`  ${stat}: ${Math.round(value * 10) / 10}`);
    }
    for (const roll of item.substats) {
      lines.push(
        `  ${roll.stat}: ${Math.round(roll.value * 10) / 10} (${Math.round(roll.quality * 100)}% roll)`,
      );
    }
    if (isPerfect(item, this.session.content.substats.perfectThreshold)) {
      lines.push('  PERFECT — every substat rolled at maximum');
    }
    if (item.socketed.length > 0) {
      const names = item.socketed.map(
        (cardId) => (cardId === null ? 'empty' : this.session.cards.get(cardId)?.name ?? cardId),
      );
      lines.push(`  sockets: ${names.join(', ')}`);
    }
    if (item.setId) {
      lines.push(`  set: ${this.session.sets.get(item.setId)?.name ?? item.setId}`);
    }
    if (item.uniqueEffectId) {
      const unique = this.session.content.uniqueEffectsById.get(item.uniqueEffectId);
      if (unique) lines.push(`  ${unique.name}: ${unique.description}`);
    }

    return lines.join('\n');
  }

  private describeRefineOutcome(name: string, outcome: RefineResult): string {
    switch (outcome.kind) {
      case 'success':
        return `${name} refined to +${outcome.level}.`;
      case 'nothing':
        return `${name} resisted the attempt — nothing changed.`;
      case 'downgrade':
        return `${name} slipped from +${outcome.from} to +${outcome.to}.`;
      case 'destroyed':
        return `${name} was destroyed.`;
    }
  }

  // --- Small helpers --------------------------------------------------------

  private bar(label: string, value: number, tone: Role | 'neutral'): HTMLElement {
    const row = el('div', 'bar-row');
    row.append(el('span', 'label', label));

    const bar = el('div', `bar ${tone}`);
    const fill = el('span');
    fill.style.width = pct(Math.max(0, Math.min(1, value)));
    bar.append(fill);
    row.append(bar);

    row.append(el('span', 'value', pct(value)));
    return row;
  }

  private allocButton(
    hunterId: HunterId,
    attribute: AttributeKey,
    amount: number,
    label: string,
    disabled = false,
  ): HTMLButtonElement {
    const button = el('button', 'small', label) as HTMLButtonElement;
    button.disabled = disabled;
    button.onclick = () => {
      const result = this.commands.allocateAttribute(hunterId, attribute, amount);
      if (result.ok) this.render();
      else this.notify(result.error, true);
    };
    return button;
  }
}
