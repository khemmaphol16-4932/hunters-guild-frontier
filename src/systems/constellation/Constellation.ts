/**
 * The skill constellation.
 *
 * v1.0 §5: *"Classes are flexible starting identities, not rigid content silos. Skill
 * knowledge is one large node-based constellation with different class starting positions.
 * Eligibility can depend on level, class, weapon, build compatibility, prerequisites, and
 * required skill books."*
 *
 * This replaces the three-stage Archetype → Advanced → Specialization chain and its per-skill
 * class allowlist. The important difference is not the data shape — it is *when* capability
 * is decided. A chain gated capability at three discrete advancement moments; the
 * constellation gates it per node, continuously, against what the hunter actually is. There
 * is no "advance to Sentinel" step any more: a hunter who has taken Sentinel-region nodes
 * *reads as* a Sentinel, which is §5's build-tag principle applied to class identity.
 *
 * `archetypeAffinity` is what makes a starting position a *position* rather than a silo: a
 * value above zero means reachable, so a Ranger can walk into Vanguard territory. Zero is
 * used sparingly, for the handful of nodes a starting position genuinely cannot reach.
 */

import type {
  ConstellationData,
  ConstellationNodeDef,
  RegionDef,
} from '../../data/constellationSchema.js';
import type { GameContent } from '../../data/loader.js';
import type { AttributeKey, ClassNodeDef, RangeBand, Role } from '../../data/schema.js';
import type { Hunter } from '../../core/hunter/Hunter.js';
import { err, ok, type Result } from '../../core/result.js';

/** Why a node is or is not currently takeable. */
export interface NodeEligibility {
  readonly nodeId: string;
  readonly eligible: boolean;
  /** Reachable from this hunter's starting position at all, ignoring current progress. */
  readonly reachable: boolean;
  /** 0..1 affinity from the hunter's archetype. Zero means never reachable. */
  readonly affinity: number;
  /** Every unmet requirement, so the UI can show the whole picture rather than the first block. */
  readonly unmet: readonly string[];
  /** Skill book still required — surfaced separately so the tree can show it as §5 asks. */
  readonly needsSkillBook: boolean;
}

/** How much a hunter has invested in each region — the basis of derived class identity. */
export interface RegionInvestment {
  readonly region: RegionDef;
  readonly nodes: number;
  /** Share of the hunter's total constellation investment, 0..1. */
  readonly share: number;
  /** Weighted by region tier: deeper regions speak louder about identity. */
  readonly weight: number;
}

export interface ConstellationDeps {
  readonly content: GameContent;
  /** Equipped weapon type ids, for the weapon eligibility axis. Empty when unarmed. */
  readonly weaponTypesOf: (hunter: Hunter) => readonly string[];
  /** Whether the guild holds the skill book a node requires. */
  readonly hasSkillBook: (hunter: Hunter, nodeId: string) => boolean;
}

/** Tier-2 regions sit further out, so investment there is a sharper identity statement. */
const TIER_WEIGHT: Readonly<Record<number, number>> = { 1: 2, 2: 3 };

/**
 * Distance expressed as progression cost.
 *
 * v1.0 §5 wants "flexible starting identities, not rigid content silos" — but flexible is
 * not free. Without a cost, affinity above zero means every archetype can reach everything,
 * and the constellation collapses into one undifferentiated blob: an Adept who picks up
 * Shield Bash and Guard Stance out-tanks a Vanguard, which is exactly the outcome the
 * measured profiles showed before this existed.
 *
 * So a node costs its stated level divided by the hunter's affinity for it. A native hunter
 * pays the stated price; a distant one pays proportionally more, and deep nodes in foreign
 * territory become effectively unreachable rather than needing a hard block. That is
 * "further from where they started" made mechanical, and it keeps the door open — a
 * determined Ranger can still become a counter-fighter, they just arrive late.
 */
export function effectiveLevel(requiredLevel: number, affinity: number): number {
  if (affinity <= 0) return Infinity;
  return Math.ceil(requiredLevel / affinity);
}

export class Constellation {
  private readonly data: ConstellationData;
  private readonly nodesById: ReadonlyMap<string, ConstellationNodeDef>;
  private readonly nodesBySkill: ReadonlyMap<string, ConstellationNodeDef>;
  private readonly regionsById: ReadonlyMap<string, RegionDef>;
  private readonly archetypesById: ReadonlyMap<string, ClassNodeDef>;
  private readonly weaponTypesOf: (hunter: Hunter) => readonly string[];
  private readonly hasSkillBook: (hunter: Hunter, nodeId: string) => boolean;

  constructor(deps: ConstellationDeps) {
    this.data = deps.content.constellation;
    this.nodesById = new Map(this.data.nodes.map((n) => [n.id, n]));
    this.nodesBySkill = new Map(this.data.nodes.map((n) => [n.skill, n]));
    this.regionsById = new Map(deps.content.regions.map((r) => [r.id, r]));
    this.archetypesById = new Map(deps.content.archetypes.map((a) => [a.id, a]));
    this.weaponTypesOf = deps.weaponTypesOf;
    this.hasSkillBook = deps.hasSkillBook;
  }

  // --- Graph ----------------------------------------------------------------

  nodes(): readonly ConstellationNodeDef[] {
    return this.data.nodes;
  }

  node(nodeId: string): ConstellationNodeDef | undefined {
    return this.nodesById.get(nodeId);
  }

  nodeForSkill(skillId: string): ConstellationNodeDef | undefined {
    return this.nodesBySkill.get(skillId);
  }

  regions(): readonly RegionDef[] {
    return [...this.regionsById.values()];
  }

  region(regionId: string): RegionDef | undefined {
    return this.regionsById.get(regionId);
  }

  nodesInRegion(regionId: string): readonly ConstellationNodeDef[] {
    return this.data.nodes.filter((n) => n.region === regionId);
  }

  /** The node an archetype begins at (§5's "different class starting positions"). */
  entryNodeFor(archetype: string): ConstellationNodeDef | undefined {
    const nodeId = this.data.entryNodes[archetype];
    return nodeId === undefined ? undefined : this.nodesById.get(nodeId);
  }

  /** Nodes that list this one as a prerequisite — what taking it opens up. */
  successorsOf(nodeId: string): readonly ConstellationNodeDef[] {
    return this.data.nodes.filter((n) =>
      n.prerequisiteGroups.some((group) => group.includes(nodeId)),
    );
  }

  // --- Eligibility ----------------------------------------------------------

  /**
   * Can this hunter take this node right now, and if not, why not?
   *
   * Returns *every* unmet requirement rather than the first. A player looking at a locked
   * node wants to know the whole gap, not to discover it one attempt at a time.
   */
  eligibility(hunter: Hunter, nodeId: string, ignoreLevel = false): NodeEligibility {
    const node = this.nodesById.get(nodeId);
    if (!node) {
      return {
        nodeId,
        eligible: false,
        reachable: false,
        affinity: 0,
        unmet: [`unknown node "${nodeId}"`],
        needsSkillBook: false,
      };
    }

    const affinity = node.archetypeAffinity[hunter.archetype] ?? 0;
    const unmet: string[] = [];

    if (affinity <= 0) {
      const archetypeName =
        this.regionsById.get(node.region)?.archetype ?? hunter.archetype;
      unmet.push(
        `unreachable from a ${hunter.archetype} starting position (${archetypeName} territory)`,
      );
    }

    const effective = effectiveLevel(node.requiredLevel, affinity);
    if (!ignoreLevel && affinity > 0 && hunter.level < effective) {
      unmet.push(
        effective === node.requiredLevel
          ? `requires level ${effective}`
          : `requires level ${effective} — ${node.requiredLevel} for a ${this.regionsById.get(node.region)?.archetype ?? 'native'} hunter, further for you`,
      );
    }

    if (node.prerequisiteGroups.length > 0) {
      const satisfied = node.prerequisiteGroups.some((group) =>
        group.every((id) => this.hasNode(hunter, id)),
      );
      if (!satisfied) {
        const options = node.prerequisiteGroups
          .map((group) => group.map((id) => this.nodeLabel(id)).join(' + '))
          .join(' or ');
        unmet.push(`requires ${options}`);
      }
    }

    if (node.requiresWeaponTypes && node.requiresWeaponTypes.length > 0) {
      const equipped = this.weaponTypesOf(hunter);
      if (!node.requiresWeaponTypes.some((type) => equipped.includes(type))) {
        unmet.push(`requires ${node.requiresWeaponTypes.join(' or ')}`);
      }
    }

    for (const requirement of node.attributeRequirements) {
      const value = hunter.attributes[requirement.attribute as AttributeKey];
      if (value < requirement.min) {
        unmet.push(`requires ${requirement.attribute.toUpperCase()} ${requirement.min}`);
      }
    }

    const needsSkillBook = node.requiresSkillBook && !this.hasSkillBook(hunter, node.id);
    if (needsSkillBook) unmet.push(`requires the ${this.nodeLabel(node.id)} skill book`);

    return {
      nodeId,
      eligible: unmet.length === 0,
      reachable: affinity > 0,
      affinity,
      unmet,
      needsSkillBook,
    };
  }

  canTake(hunter: Hunter, nodeId: string, ignoreLevel = false): Result<ConstellationNodeDef, string> {
    if (this.hasNode(hunter, nodeId)) {
      return err(`${hunter.name} has already taken ${this.nodeLabel(nodeId)}`);
    }

    const verdict = this.eligibility(hunter, nodeId, ignoreLevel);
    if (!verdict.eligible) return err(verdict.unmet.join('; '));

    const node = this.nodesById.get(nodeId);
    return node ? ok(node) : err(`unknown node "${nodeId}"`);
  }

  /** A node is "taken" exactly when its skill is known — the two are the same act. */
  hasNode(hunter: Hunter, nodeId: string): boolean {
    const node = this.nodesById.get(nodeId);
    return node ? hunter.knownSkills.includes(node.skill as never) : false;
  }

  takenNodes(hunter: Hunter): readonly ConstellationNodeDef[] {
    return this.data.nodes.filter((n) => this.hasNode(hunter, n.id));
  }

  /** Everything takeable right now — the constellation's "available" ring. */
  availableNodes(hunter: Hunter): readonly ConstellationNodeDef[] {
    return this.data.nodes.filter(
      (n) => !this.hasNode(hunter, n.id) && this.eligibility(hunter, n.id).eligible,
    );
  }

  /** Reachable eventually, but not yet — what a player is working toward. */
  frontierNodes(hunter: Hunter): readonly NodeEligibility[] {
    return this.data.nodes
      .filter((n) => !this.hasNode(hunter, n.id))
      .map((n) => this.eligibility(hunter, n.id))
      .filter((e) => e.reachable && !e.eligible);
  }

  // --- Derived class identity -----------------------------------------------

  /**
   * How much of a hunter's constellation investment sits in each region.
   *
   * This is what replaces "what class are you?". Nothing is declared; identity is read off
   * where the hunter has actually spent their progression.
   */
  regionInvestment(hunter: Hunter): readonly RegionInvestment[] {
    const counts = new Map<string, number>();
    for (const node of this.takenNodes(hunter)) {
      counts.set(node.region, (counts.get(node.region) ?? 0) + 1);
    }

    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    if (total === 0) return [];

    const investments: RegionInvestment[] = [];
    for (const [regionId, nodes] of counts) {
      const region = this.regionsById.get(regionId);
      if (!region) continue;
      investments.push({
        region,
        nodes,
        share: nodes / total,
        weight: nodes * (TIER_WEIGHT[region.tier] ?? 1),
      });
    }

    return investments.sort((a, b) => b.weight - a.weight);
  }

  /**
   * Blended class contribution to build identity.
   *
   * Deliberately the same shape `ClassSystem.blendedClassProfile` returned, so `BuildIdentity`
   * consumes it unchanged — the class *contribution* to a build is still weight 2 of the §16
   * ratios, only its derivation changed. The archetype always contributes as the starting
   * position; regions contribute in proportion to actual investment.
   */
  blendedClassProfile(hunter: Hunter): {
    roleLean: Readonly<Partial<Record<Role, number>>>;
    rangeBand: Readonly<Partial<Record<RangeBand, number>>>;
    attributeAffinity: Readonly<Partial<Record<AttributeKey, number>>>;
    riskPostureShift: number;
    skillTags: readonly string[];
  } {
    const roleLean: Partial<Record<Role, number>> = {};
    const rangeBand: Partial<Record<RangeBand, number>> = {};
    const attributeAffinity: Partial<Record<AttributeKey, number>> = {};
    const tags = new Set<string>();
    let riskPostureShift = 0;
    let totalWeight = 0;

    const add = (
      source: {
        roleLean: Readonly<Partial<Record<Role, number>>>;
        rangeBand: Readonly<Partial<Record<RangeBand, number>>>;
        attributeAffinity: Readonly<Partial<Record<AttributeKey, number>>>;
        riskPostureShift: number;
        skillTags: readonly string[];
      },
      weight: number,
    ): void => {
      for (const [role, value] of Object.entries(source.roleLean) as [Role, number][]) {
        roleLean[role] = (roleLean[role] ?? 0) + value * weight;
      }
      for (const [band, value] of Object.entries(source.rangeBand) as [RangeBand, number][]) {
        rangeBand[band] = (rangeBand[band] ?? 0) + value * weight;
      }
      for (const [attr, value] of Object.entries(source.attributeAffinity) as [
        AttributeKey,
        number,
      ][]) {
        attributeAffinity[attr] = (attributeAffinity[attr] ?? 0) + value * weight;
      }
      riskPostureShift += source.riskPostureShift * weight;
      for (const tag of source.skillTags) tags.add(tag);
      totalWeight += weight;
    };

    // The starting position always counts — a Vanguard who wandered into Adept territory is
    // still a Vanguard who did that, and the archetype is what made the journey long.
    const archetype = this.archetypeOf(hunter);
    if (archetype) add(archetype, 1);

    for (const investment of this.regionInvestment(hunter)) {
      add(investment.region, investment.weight);
    }

    if (totalWeight > 0) {
      for (const key of Object.keys(roleLean) as Role[]) {
        roleLean[key] = (roleLean[key] ?? 0) / totalWeight;
      }
      for (const key of Object.keys(rangeBand) as RangeBand[]) {
        rangeBand[key] = (rangeBand[key] ?? 0) / totalWeight;
      }
      for (const key of Object.keys(attributeAffinity) as AttributeKey[]) {
        attributeAffinity[key] = (attributeAffinity[key] ?? 0) / totalWeight;
      }
      riskPostureShift /= totalWeight;
    }

    return { roleLean, rangeBand, attributeAffinity, riskPostureShift, skillTags: [...tags] };
  }

  /**
   * Player-facing identity, e.g. "Vanguard · Sentinel/Bulwark".
   *
   * Derived every time from region investment, never stored — so a hunter who retrains into
   * new territory is described as what they now are, not what they once declared.
   */
  describeIdentity(hunter: Hunter): string {
    const archetypeName = this.archetypeOf(hunter)?.name ?? hunter.archetype;
    const investment = this.regionInvestment(hunter);
    if (investment.length === 0) return archetypeName;

    // Only regions carrying real weight are named; a single stray node is not an identity.
    const totalWeight = investment.reduce((sum, i) => sum + i.weight, 0);
    const significant = investment.filter((i) => i.weight / totalWeight >= 0.2).slice(0, 2);
    if (significant.length === 0) return archetypeName;

    return `${archetypeName} · ${significant.map((i) => i.region.name).join('/')}`;
  }

  /** The dominant region, when one exists. */
  primaryRegion(hunter: Hunter): RegionDef | undefined {
    return this.regionInvestment(hunter)[0]?.region;
  }

  /** The hunter's starting position. */
  archetypeOf(hunter: Hunter): ClassNodeDef | undefined {
    return this.archetypesById.get(hunter.archetype);
  }

  private nodeLabel(nodeId: string): string {
    return this.nodesById.get(nodeId)?.skill ?? nodeId;
  }
}
