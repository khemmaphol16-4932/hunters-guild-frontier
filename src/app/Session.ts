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
import { AuditLog } from '../core/audit.js';
import { EmergencyPolicy } from '../ai/policy/emergency.js';
import { PolicyBook } from '../ai/policy/PolicyBook.js';
import { routeOrders } from '../ai/policy/orders.js';
import { mintHunterId } from '../core/ids.js';
import type { ArchetypeId, HunterId, PersonalityId } from '../core/ids.js';
import { asArchetypeId, asPersonalityId, asSkillId } from '../core/ids.js';
import {
  createHunter,
  DEPARTMENTS,
  type DepartmentId,
  type Hunter,
} from '../core/hunter/Hunter.js';
import { rollPotential } from '../core/hunter/potential.js';
import { Constellation } from '../systems/constellation/Constellation.js';
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
import { PartyPlanner } from '../systems/party/Party.js';
import { hunterCombatant, monsterCombatant } from '../systems/combat/combatants.js';
import { HunterAI } from '../ai/hunter/hunterAI.js';
import { Expedition } from '../sim/expedition/Expedition.js';
import { WorldKnowledge } from '../systems/world/WorldKnowledge.js';
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

  /**
   * Remove a hunter permanently.
   *
   * Only death does this. Their Chronicle is deliberately left behind — a hunter who died in
   * a BLACK zone stops being deployable, but the guild remembers them (v1.0 §19).
   */
  remove(id: HunterId): Hunter | undefined {
    const hunter = this.hunters.get(id);
    this.hunters.delete(id);
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

  readonly constellation: Constellation;
  readonly registry: SkillRegistry;
  readonly knowledge: SkillKnowledge;
  readonly books: SkillBooks;
  readonly mastery: SkillMastery;
  readonly personality: Personality;
  readonly condition: Condition;
  readonly buildIdentity: BuildIdentity;
  readonly chronicle: Chronicle;

  readonly audit: AuditLog;
  readonly emergency: EmergencyPolicy;
  /** The player's standing orders, in force for every expedition (§29). */
  readonly policy: PolicyBook;

  readonly armoury: Armoury;
  readonly cards: Cards;
  readonly sets: Sets;
  readonly equipment: Equipment;
  readonly refinement: Refinement;
  readonly itemGenerator: ItemGenerator;

  /** What the guild knows about the world. Permanent (REQ-WLD-001). */
  readonly worldKnowledge: WorldKnowledge;
  readonly partyPlanner: PartyPlanner;
  readonly hunterAI: HunterAI;
  readonly expedition: Expedition;

  readonly save: SaveGame;

  readonly worldSeed: string;

  /**
   * Version of the policy rule set in force, stamped onto every audit record (v1.0 §14).
   * Sourced from `data/policy/precedence.json` so an old decision can be read against the
   * rules of its time rather than against today's.
   */
  readonly policyVersion: string;

  constructor(options: SessionOptions) {
    // Needed by the object literals below, which read policy lazily through a getter.
    const session = this;
    this.worldSeed = options.worldSeed;
    this.content = options.content ?? loadContent();
    this.events = new EventBus();
    this.clock = new SimulationClock();
    this.streams = createStreams(options.worldSeed);
    this.roster = new Roster();
    this.policyVersion = this.content.policyPrecedence.version;

    // v1.0 §14/§18: consequential changes must be explainable from an audit record.
    this.audit = new AuditLog({
      currentTick: () => this.clock.tick,
      policyVersion: () => this.policyVersion,
    });
    // Empty by default, so hard constraints stay absolute until the player says otherwise.
    this.emergency = new EmergencyPolicy();
    this.policy = new PolicyBook();

    this.registry = new SkillRegistry(this.content);

    // Items are built before the constellation because node eligibility reads the equipped
    // weapon and the guild's skill books (v1.0 §5's weapon and skill-book axes).
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

    this.constellation = new Constellation({
      content: this.content,
      weaponTypesOf: (hunter) =>
        this.equipment
          .equippedItems(hunter)
          .filter((item) => item.slot === 'weapon')
          .map((item) => item.typeId),
      hasSkillBook: (_hunter, nodeId) => this.armoury.hasSkillBook(nodeId),
    });

    this.knowledge = new SkillKnowledge({
      registry: this.registry,
      constellation: this.constellation,
      events: this.events,
    });
    this.books = new SkillBooks({
      registry: this.registry,
      knowledge: this.knowledge,
      constellation: this.constellation,
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
      constellation: this.constellation,
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
    this.worldKnowledge = new WorldKnowledge({
      regions: this.content.world.regions,
      // §19: the first time the guild sets foot somewhere is worth remembering, and it is
      // the guild that remembers it — every hunter on the trip gets the entry.
      onFirstEntry: (region) => {
        for (const hunter of this.roster.all()) {
          this.events.emit('zone.firstEntered', {
            hunterId: hunter.id,
            zoneId: region.id,
            tier: region.zoneTier,
          });
        }
      },
    });

    // Party planning is pre-combat strategy — the last point the player has direct
    // influence (v1.0 §7). Four is the MVP party size.
    this.partyPlanner = new PartyPlanner({
      profileOf: (hunter) => this.buildIdentity.profileOf(hunter),
      maxSize: 4,
    });

    this.hunterAI = new HunterAI({
      balance: this.content.balance.combat,
      skillOf: (id) => this.content.skillsById.get(asSkillId(id)),
      masteryOf: (hunterId, skillId) => {
        const hunter = this.roster.get(hunterId as HunterId);
        return hunter ? this.mastery.points(hunter, asSkillId(skillId)) : 0;
      },
      rangeDistance: (band) => this.content.balance.combat.movement.rangeBands[band],
      // Needed by the ultimate-timing and rescue-viability stages: without it every enemy
      // looks like trash, and `ultimateTiming` runs inverted — an ultimate is withheld
      // against a boss and spent on a wounded party fighting a rat.
      monsterOf: (id) => this.content.monstersById.get(id),
    });

    this.expedition = new Expedition({
      world: this.content.world,
      balance: this.content.balance.combat,
      ai: this.hunterAI,
      skillOf: (id) => this.content.skillsById.get(asSkillId(id)),
      statusOf: (id) => this.content.statusesById.get(id),
      monsterOf: (id) => this.content.monstersById.get(id),
      // Read through a getter rather than captured, so an order the player gives between
      // expeditions is in force for the next one. Empty until they author something: hard
      // constraints are absolute when present, so shipping a default set would be the game
      // deciding strategy on the player's behalf.
      get constraints() { return session.policy.all(); },
      emergency: this.emergency,
      combatantFor: (hunterId) =>
        hunterCombatant(this.roster.require(hunterId), {
          attributeBalance: this.content.balance.attributes,
          combatBalance: this.content.balance.combat,
          profileOf: (hunter) => this.buildIdentity.profileOf(hunter),
          conditionMultiplier: (hunter) => this.condition.statMultiplier(hunter),
          equipmentStats: (hunter) => this.equipment.aggregateStats(hunter),
        }),
      monsterCombatant,
      chronicle: this.events,
      events: this.content.events,
      routeOrders: () => routeOrders(session.policy.all().map((c) => c.id)),
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

    const archetype = this.content.archetypesById.get(archetypeId);
    const preferredRole =
      options.preferredRole ??
      ((Object.entries(archetype?.roleLean ?? {}) as [Role, number][]).sort(
        (a, b) => b[1] - a[1],
      )[0]?.[0] as Role | undefined) ??
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
      audit: this.audit.snapshot(),
      emergencyAuthorisations: this.emergency.snapshot(),
      worldKnowledge: this.worldKnowledge.snapshot(),
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
    this.audit.restore(payload.audit ?? []);
    this.emergency.restore(payload.emergencyAuthorisations ?? []);
    this.worldKnowledge.restore(payload.worldKnowledge);
  }

  dispose(): void {
    this.chronicle.dispose();
    this.events.clear();
  }
}
