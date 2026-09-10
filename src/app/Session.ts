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
import { Town } from '../systems/town/Town.js';
import { Population } from '../systems/town/Population.js';
import { Departments } from '../systems/town/Departments.js';
import { TownJobs } from '../systems/town/TownJobs.js';
import { Reputation } from '../systems/town/Reputation.js';
import { Recovery } from '../systems/town/Recovery.js';
import { Research } from '../systems/town/Research.js';
import { Recruitment } from '../systems/town/Recruitment.js';
import { Defense } from '../systems/town/Defense.js';
import { TownCombat } from '../sim/town/TownCombat.js';
import { assignJobs } from '../ai/town/jobAssignment.js';
import type { TownDepartmentId } from '../data/townSchema.js';
import { SaveGame, type SaveStorage } from '../save/SaveGame.js';
import type { CurrentSavePayload } from '../save/envelope.js';
import { Resources } from '../systems/economy/Resources.js';
import { Food } from '../systems/economy/Food.js';

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
  /**
   * Which name pool to draw from (REQ-RCT-002). Defaults to the first, which is `frontier`.
   */
  readonly namePool?: string;
  /**
   * Multiplier on the rolled potential's composite, from a recruit's origin.
   * Some places genuinely do produce better hunters (REQ-RCT-002).
   */
  readonly potentialBias?: number;
  /**
   * Whether to add the hunter to the roster.
   *
   * Recruitment needs fully-formed hunters that are *not* in the guild yet — a candidate at
   * the hall is a real person the player has not hired. Defaults to true so every existing
   * caller is unchanged.
   */
  readonly enlist?: boolean;
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

  /** The town, and everything that follows from having one (REQ-TWN-*, REQ-DEP-*). */
  readonly town: Town;
  readonly population: Population;
  readonly departments: Departments;
  readonly townJobs: TownJobs;
  readonly reputation: Reputation;
  readonly recovery: Recovery;
  readonly research: Research;
  readonly recruitment: Recruitment;
  readonly defense: Defense;
  /** Town hunting and town defense, fought with the same combat system (REQ-TWN-007/008). */
  readonly townCombat: TownCombat;
  readonly resources: Resources;
  readonly food: Food;

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
    this.resources = new Resources(this.content.economy.resources);
    this.food = new Food(this.resources, this.content.economy.foodConsumptionPerResidentPerStep);

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

    // --- The town ----------------------------------------------------------
    //
    // These five reference each other, so every dependency is a closure read lazily rather
    // than a value passed in: population needs the town's capacity, the town needs the
    // population and the food its staffed jobs produce, departments need the town's job
    // slots and the rota's staff, and the rota needs the departments' priorities. Nothing
    // is *called* during construction, so declaration order below is arbitrary — what
    // matters is that no system holds a stale copy of another's state.
    // Research is built first: every other town system asks it something, and it asks
    // nothing of them. The one genuinely acyclic corner of this cluster.
    this.research = new Research({
      content: this.content.research,
      onCompleted: (node) => {
        this.events.emit('research.completed', { nodeId: node.id, name: node.name });
      },
    });

    this.reputation = new Reputation({
      balance: this.content.balance.town,
      researchScale: () => session.research.reputationScale(),
    });

    this.population = new Population({
      balance: this.content.balance.town,
      capacityOf: () => session.town.capacity(),
      reputationOf: () => session.reputation.current,
      foodSupplyFraction: () => session.food.fedFraction,
    });

    this.town = new Town({
      balance: this.content.balance.town,
      buildings: this.content.town.buildings,
      populationOf: () => session.population.size,
      reputationOf: () => session.reputation.current,
      jobFoodOf: () => session.departments.foodOutput(),
      foodSupplyFraction: () => session.food.fedFraction,
      researchCapacity: (axis) => session.research.capacityBonus(axis),
      researchQuality: (axis) => session.research.qualityScale(axis),
      researchUnlockedBuilding: (id) => session.research.unlocksBuilding(id),
      onStageReached: (stage) => {
        this.events.emit('town.stageReached', { stageId: stage.id, name: stage.name });
      },
    });

    this.departments = new Departments({
      balance: this.content.balance.town,
      attributes: this.content.balance.attributes,
      content: this.content.departments,
      jobs: this.content.townJobs.jobs,
      hunterOf: (id) => this.roster.get(id),
      staffOf: () => session.townJobs.all(),
      slotsOf: () => session.town.jobSlots(),
      // REQ-DEP-001: departments unlock through Research. Phase 6a stood this in with a
      // town-stage predicate because Research did not exist; this is the real one, and it
      // is the whole reason the dependency was injected rather than decided inside
      // `Departments` — the class did not change when the stand-in was replaced.
      researchUnlocked: (department: TownDepartmentId) =>
        session.research.unlocksDepartment(department),
    });

    this.townJobs = new TownJobs({
      jobs: this.content.townJobs.jobs,
      rosterOf: () => this.roster.all(),
      slotsOf: () => session.town.jobSlots(),
      // The scorer lives in `ai/`, above `systems/`, so the rota receives it here rather
      // than importing it — the same inversion `Expedition` uses for the hunter AI.
      assign: (request) =>
        assignJobs({
          ...request,
          deps: {
            balance: this.content.balance.town,
            attributes: this.content.balance.attributes,
            profileOf: (hunter) => this.buildIdentity.profileOf(hunter),
          },
          priorityOf: (department) => session.departments.priority(department as TownDepartmentId),
          policyModifiersOf: (department) =>
            session.departments.policyModifiers(department as TownDepartmentId),
          isUnlocked: (department) =>
            session.departments.isUnlocked(department as TownDepartmentId),
        }),
    });

    // v1.0 §4 wants recovery to vary with food, housing and services. It reads the town
    // through closures for the same reason: the answer has to be current at the moment a
    // hunter comes home, not at the moment the session was built.
    this.recovery = new Recovery({
      balance: this.content.balance.town,
      traitsById: this.content.traitsById,
      housingQuality: () => session.town.housingQuality(),
      serviceQuality: () => session.town.serviceQuality(),
      foodAvailable: () => session.town.foodAvailable(),
      researchScale: () => session.research.recoveryScale(),
      ticksPerStep: () => session.clock.coarseStepRatio,
    });

    // REQ-RCT-001: the Recruitment Hall is load-bearing — no building, no pool. Generation
    // is injected because building a hunter needs the name pools, the potential roller and
    // the constellation, none of which Recruitment should know about: it decides who shows
    // up, the composition root decides how a hunter is made.
    this.recruitment = new Recruitment({
      content: this.content.recruitment,
      reputationOf: () => session.reputation.current,
      hallStanding: () => session.town.grid.countOf('recruitment_hall') > 0,
      currentTick: () => session.clock.tick,
      ticksPerStep: () => session.clock.coarseStepRatio,
      generate: (origin) => {
        const archetype = weightedPick(
          session.content.archetypes.map((a) => a.id),
          origin.archetypeBias,
          session.streams.recruit,
        );
        const personality = weightedPick(
          session.content.personalities.map((p) => p.id),
          origin.personalityBias,
          session.streams.recruit,
        );

        const hunter = session.generateHunter({
          enlist: false,
          namePool: origin.namePool,
          potentialBias: origin.potentialBias,
          // Spread conditionally so an absent pick falls through to `generateHunter`'s own
          // default rather than being passed as an explicit `undefined`.
          ...(archetype !== undefined ? { archetype } : {}),
          ...(personality !== undefined ? { personality } : {}),
        });
        return { hunter, potential: hunter.potential.composite };
      },
    });

    // The same combat system an expedition uses, pointed at the town (REQ-TWN-007/008).
    // A hunter walking out to the orchard is built exactly as they would be for a black
    // zone — that identity of construction is the whole content of "town hunting is real".
    this.townCombat = new TownCombat({
      balance: this.content.balance.combat,
      // Read through a getter because the hunter AI is constructed below — the same lazy
      // read the expedition uses for the policy book, and for the same reason: the town
      // cluster has to be built before the things that consume its readings.
      get ai() {
        return session.hunterAI;
      },
      skillOf: (id) => this.content.skillsById.get(asSkillId(id)),
      statusOf: (id) => this.content.statusesById.get(id),
      monsterOf: (id) => this.content.monstersById.get(id),
      combatantFor: (hunterId) =>
        hunterCombatant(this.roster.require(hunterId), {
          attributeBalance: this.content.balance.attributes,
          combatBalance: this.content.balance.combat,
          profileOf: (hunter) => this.buildIdentity.profileOf(hunter),
          conditionMultiplier: (hunter) => this.condition.statMultiplier(hunter),
          equipmentStats: (hunter) => this.equipment.aggregateStats(hunter),
        }),
      monsterCombatant,
    });

    this.defense = new Defense({
      config: this.content.threats.defense,
      reputationOf: () => session.reputation.current,
      currentTick: () => session.clock.tick,
      ticksPerStep: () => session.clock.coarseStepRatio,
      rosterOf: () => this.roster.all(),
      // The posted watch is whoever the ordinary work rota put on a defense-department job.
      // Defense does not run an assignment pass of its own: a second way of deciding who
      // does what would drift out of step with the first one within a phase.
      postedGuardsOf: () =>
        session.townJobs
          .all()
          .filter(
            (assignment) =>
              this.content.townJobsById.get(assignment.jobId)?.department === 'defense',
          )
          .map((assignment) => assignment.hunterId as HunterId),
      defenceCapacityOf: () => session.town.capacity().defence,
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

    // REQ-RCT-002: a recruit's origin decides which names they could have. Falls back to the
    // first pool — the frontier default — so every pre-recruitment caller is unaffected.
    const pool =
      (options.namePool !== undefined
        ? this.content.namePools.find((p) => p.id === options.namePool)
        : undefined) ?? this.content.namePools[0];
    const given = pool ? (rng.pick(pool.given) ?? 'Hunter') : 'Hunter';
    const family = pool ? (rng.pick(pool.family) ?? 'of the Frontier') : 'of the Frontier';
    const name = options.name ?? `${given} ${family}`;

    // An origin's bias is applied to the composite *after* the roll rather than to the roll
    // itself, so the facets and traits a hunter actually carries stay exactly what the
    // potential system produced. An origin makes better hunters more likely; it does not
    // reach in and rewrite what a particular hunter is.
    const rolled = rollPotential(rng, balance.potential, this.content.traits);
    const bias = options.potentialBias ?? 1;
    const potential =
      bias === 1
        ? rolled
        : { ...rolled, composite: Math.min(1, Math.max(0, rolled.composite * bias)) };

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

    // A candidate at the Recruitment Hall is a fully-formed hunter who is *not* in the
    // guild yet, so enlisting is opt-out rather than unconditional.
    if (options.enlist !== false) {
      this.roster.add(hunter);
      this.events.emit('hunter.created', { hunterId: hunter.id, name: hunter.name });
    }
    return hunter;
  }

  /** Put a hunter the guild has decided to take onto the roster. */
  enlist(hunter: Hunter): Hunter {
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
      town: this.town.snapshot(),
      population: this.population.snapshot(),
      departments: this.departments.snapshot(),
      townJobs: this.townJobs.snapshot(),
      reputation: this.reputation.snapshot(),
      research: this.research.snapshot(),
      recruitment: this.recruitment.snapshot(),
      defense: this.defense.snapshot(),
      resources: this.resources.snapshot(),
      food: this.food.snapshot(),
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
    // Order matters here in one place only: the town's stage is stored rather than derived
    // (REQ-TWN-002), so restoring it after the population cannot lower it either way — but
    // restoring the rota last means it is read back against a town that is already whole.
    this.town.restore(payload.town);
    this.population.restore(payload.population);
    this.reputation.restore(payload.reputation);
    this.departments.restore(payload.departments);
    this.research.restore(payload.research);
    this.recruitment.restore(payload.recruitment);
    this.defense.restore(payload.defense);
    this.resources.restore(payload.resources);
    this.food.restore(payload.food);
    this.townJobs.restore(payload.townJobs);
  }

  dispose(): void {
    this.chronicle.dispose();
    this.events.clear();
  }
}

/**
 * Weighted pick over ids, where the weights are *biases* on an otherwise flat draw.
 *
 * Used by recruitment (REQ-RCT-002). An id with no entry keeps weight 1, which is what makes
 * a bias a bias rather than a filter: an origin that never mentions Adepts still produces
 * them, just at the base rate. Returning `undefined` when there is nothing to pick lets the
 * caller fall back to its own default rather than inventing one here.
 */
function weightedPick(
  ids: readonly string[],
  bias: Readonly<Record<string, number>>,
  rng: { next(): number },
): string | undefined {
  if (ids.length === 0) return undefined;

  const weights = ids.map((id) => Math.max(0, bias[id] ?? 1));
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return ids[0];

  let roll = rng.next() * total;
  for (let i = 0; i < ids.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return ids[i];
  }
  return ids[ids.length - 1];
}
