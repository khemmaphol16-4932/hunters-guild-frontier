/**
 * Composition root.
 *
 * The one place that knows how every system is wired together. Systems themselves take
 * their dependencies through constructors and know nothing about how the game is assembled,
 * which is what keeps them independently testable (REQ-TEC-001) and stops this file from
 * becoming the giant GameManager §126 forbids — it constructs and holds, it does not decide.
 *
 * Everything hangs off one world seed, so an entire guild is reproducible (REQ-TEC-005).
 */

import { loadContent, type GameContent } from '../data/loader.js';
import type { Role } from '../data/schema.js';
import { EventBus } from '../core/events.js';
import { SimulationClock } from '../core/clock.js';
import { createStreams, type RngStreams } from '../core/rng.js';
import { mintHunterId } from '../core/ids.js';
import type { ArchetypeId, HunterId, PersonalityId } from '../core/ids.js';
import { asArchetypeId, asPersonalityId } from '../core/ids.js';
import {
  createHunter,
  DEPARTMENTS,
  type DepartmentId,
  type Hunter,
} from '../core/hunter/Hunter.js';
import { rollPotential } from '../core/hunter/potential.js';
import { ClassSystem } from '../systems/class/ClassSystem.js';
import { SkillRegistry } from '../systems/skills/SkillRegistry.js';
import { SkillKnowledge } from '../systems/skills/SkillKnowledge.js';
import { SkillBooks } from '../systems/skills/SkillBooks.js';
import { SkillMastery } from '../systems/skills/SkillMastery.js';
import { Personality } from '../systems/hunter/Personality.js';
import { Condition } from '../systems/hunter/Condition.js';
import { BuildIdentity } from '../systems/hunter/BuildIdentity.js';
import { Chronicle } from '../systems/hunter/Chronicle.js';
import { Armoury } from '../systems/items/Armoury.js';
import { Cards } from '../systems/items/Cards.js';
import { Sets } from '../systems/items/Sets.js';
import { Equipment } from '../systems/items/Equipment.js';
import { Refinement } from '../systems/items/Refinement.js';
import { ItemGenerator } from '../systems/items/ItemGenerator.js';
import { CardIdentity, EquipmentIdentity } from '../systems/items/identityContributions.js';
import { SaveGame, type SaveStorage } from '../save/SaveGame.js';
import type { CurrentSavePayload } from '../save/envelope.js';

export interface SessionOptions {
  readonly worldSeed: string;
  readonly storage: SaveStorage;
  readonly now: () => number;
  readonly content?: GameContent;
}

/**
 * The guild's mutable roster.
 * Hunters are immutable records, so "updating" a hunter means replacing the entry —
 * which is what makes save, replay and test comparison straightforward.
 */
export class Roster {
  private readonly hunters = new Map<HunterId, Hunter>();

  add(hunter: Hunter): void {
    this.hunters.set(hunter.id, hunter);
  }

  update(hunter: Hunter): void {
    if (!this.hunters.has(hunter.id)) {
      throw new Error(`Roster: no hunter with id ${hunter.id} to update`);
    }
    this.hunters.set(hunter.id, hunter);
  }

  get(id: HunterId): Hunter | undefined {
    return this.hunters.get(id);
  }

  require(id: HunterId): Hunter {
    const hunter = this.get(id);
    if (!hunter) throw new Error(`Roster: unknown hunter ${id}`);
    return hunter;
  }

  all(): readonly Hunter[] {
    return [...this.hunters.values()];
  }

  get size(): number {
    return this.hunters.size;
  }

  clear(): void {
    this.hunters.clear();
  }
}

export interface GenerateHunterOptions {
  readonly archetype?: string;
  readonly personality?: string;
  readonly preferredRole?: Role;
  readonly preferredDepartment?: DepartmentId;
  readonly level?: number;
  readonly name?: string;
}

export class Session {
  readonly content: GameContent;
  readonly events: EventBus;
  readonly clock: SimulationClock;
  readonly streams: RngStreams;
  readonly roster: Roster;

  readonly classSystem: ClassSystem;
  readonly registry: SkillRegistry;
  readonly knowledge: SkillKnowledge;
  readonly books: SkillBooks;
  readonly mastery: SkillMastery;
  readonly personality: Personality;
  readonly condition: Condition;
  readonly buildIdentity: BuildIdentity;
  readonly chronicle: Chronicle;

  readonly armoury: Armoury;
  readonly cards: Cards;
  readonly sets: Sets;
  readonly equipment: Equipment;
  readonly refinement: Refinement;
  readonly itemGenerator: ItemGenerator;

  readonly save: SaveGame;

  readonly worldSeed: string;

  constructor(options: SessionOptions) {
    this.worldSeed = options.worldSeed;
    this.content = options.content ?? loadContent();
    this.events = new EventBus();
    this.clock = new SimulationClock();
    this.streams = createStreams(options.worldSeed);
    this.roster = new Roster();

    this.classSystem = new ClassSystem({ content: this.content });
    this.registry = new SkillRegistry(this.content);
    this.knowledge = new SkillKnowledge({ registry: this.registry, events: this.events });
    this.books = new SkillBooks({
      registry: this.registry,
      knowledge: this.knowledge,
      events: this.events,
    });
    this.mastery = new SkillMastery({
      balance: this.content.balance.mastery,
      registry: this.registry,
      events: this.events,
    });
    this.personality = new Personality(this.content);
    this.condition = new Condition({
      balance: this.content.balance.personality,
      events: this.events,
    });
    this.armoury = new Armoury(this.content);
    this.cards = new Cards(this.content);
    this.sets = new Sets(this.content);
    this.equipment = new Equipment({
      content: this.content,
      armoury: this.armoury,
      cards: this.cards,
      sets: this.sets,
    });
    this.refinement = new Refinement(this.content.balance.refinement);
    this.itemGenerator = new ItemGenerator(this.content);

    const itemIdentityDeps = {
      content: this.content,
      equipment: this.equipment,
      cards: this.cards,
      sets: this.sets,
    };

    // Phase 2 swaps the Phase 1 null objects for real contributions. BuildIdentity itself
    // is unchanged — see systems/items/identityContributions.ts and DL-009.
    this.buildIdentity = new BuildIdentity({
      balance: this.content.balance.buildIdentity,
      classSystem: this.classSystem,
      registry: this.registry,
      mastery: this.mastery,
      personality: this.personality,
      condition: this.condition,
      equipment: new EquipmentIdentity(itemIdentityDeps),
      cards: new CardIdentity(itemIdentityDeps),
    });
    this.chronicle = new Chronicle({
      balance: this.content.balance.chronicle,
      events: this.events,
      currentTick: () => this.clock.tick,
    });
    this.save = new SaveGame({
      storage: options.storage,
      now: options.now,
      worldSeed: options.worldSeed,
    });
  }

  /**
   * Generate a hunter from the recruit RNG stream.
   *
   * Phase 3 replaces this with the full Recruitment system (pools, regional identity, paid
   * refresh). It lives here for now because the prototype needs hunters to exist before
   * recruitment does, and because everything it produces — potential, personality, name —
   * is already drawn from data and from a seeded stream, so Phase 3 changes where recruits
   * come from, not what they are.
   */
  generateHunter(options: GenerateHunterOptions = {}): Hunter {
    const rng = this.streams.recruit;
    const balance = this.content.balance;

    const archetypeId: ArchetypeId = asArchetypeId(
      options.archetype ?? rng.pick(this.content.archetypes)?.id ?? 'vanguard',
    );
    const personalityId: PersonalityId = asPersonalityId(
      options.personality ?? rng.pick(this.content.personalities)?.id ?? 'stoic',
    );

    const pool = this.content.namePools[0];
    const given = pool ? (rng.pick(pool.given) ?? 'Hunter') : 'Hunter';
    const family = pool ? (rng.pick(pool.family) ?? 'of the Frontier') : 'of the Frontier';
    const name = options.name ?? `${given} ${family}`;

    const potential = rollPotential(rng, balance.potential, this.content.traits);

    const archetype = this.content.classNodes.get(archetypeId);
    const preferredRole =
      options.preferredRole ??
      (Object.entries(archetype?.roleLean ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] as
        | Role
        | undefined) ??
      'damage';

    const preferredDepartment =
      options.preferredDepartment ?? rng.pick(DEPARTMENTS) ?? 'hunter';

    const hunter = createHunter(
      {
        id: mintHunterId(rng),
        name,
        archetype: archetypeId,
        personalityId,
        potential,
        preferredRole,
        preferredDepartment,
        ...(options.level !== undefined ? { level: options.level } : {}),
      },
      balance.attributes,
    );

    this.roster.add(hunter);
    this.events.emit('hunter.created', { hunterId: hunter.id, name: hunter.name });
    return hunter;
  }

  /** Snapshot everything the save format persists. */
  snapshot(): CurrentSavePayload {
    const rngStreams: Record<string, ReturnType<RngStreams[keyof RngStreams]['state']>> = {};
    for (const [name, stream] of Object.entries(this.streams)) {
      rngStreams[name] = stream.state();
    }
    return {
      hunters: this.roster.all(),
      chronicles: this.chronicle.all(),
      clock: this.clock.snapshot(),
      rngStreams,
      armoury: this.armoury.snapshot(),
      lootPity: this.itemGenerator.pity,
    };
  }

  /** Restore a snapshot in place. RNG stream state is restored by the caller if needed. */
  restore(payload: CurrentSavePayload): void {
    this.roster.clear();
    for (const hunter of payload.hunters) this.roster.add(hunter);
    this.chronicle.restore(payload.chronicles);
    this.clock.restore(payload.clock);
    this.armoury.restore(payload.armoury);
    this.itemGenerator.restorePity(payload.lootPity);
  }

  dispose(): void {
    this.chronicle.dispose();
    this.events.clear();
  }
}
