/**
 * The three-stage class chain: Archetype → Advanced Class → Specialization.
 *
 * REQ-CLS-001/002. Advancement is *limited* — a hunter advances forward through the chain
 * and cannot sidestep into an unrelated branch. The rules live here so that the UI, the
 * debug console and any future automation all ask the same question and get the same
 * answer, rather than each re-implementing "is this allowed?".
 */

import type { ClassNodeDef, Role, RangeBand, AttributeKey } from '../../data/schema.js';
import type { GameContent } from '../../data/loader.js';
import { asAdvancedClassId, asSpecializationId } from '../../core/ids.js';
import type { Hunter } from '../../core/hunter/Hunter.js';
import { classChainIds, currentClassId, withClassChain } from '../../core/hunter/Hunter.js';
import { err, ok, type Result } from '../../core/result.js';

export interface ClassSystemDeps {
  readonly content: GameContent;
}

export class ClassSystem {
  private readonly content: GameContent;

  constructor(deps: ClassSystemDeps) {
    this.content = deps.content;
  }

  node(id: string): ClassNodeDef | undefined {
    return this.content.classNodes.get(id);
  }

  /** Advanced classes a given archetype can advance into. */
  advancedOptions(archetypeId: string): readonly ClassNodeDef[] {
    return this.content.advancedClasses.filter((c) => c.parent === archetypeId);
  }

  /** Specializations a given advanced class can advance into. */
  specializationOptions(advancedClassId: string): readonly ClassNodeDef[] {
    return this.content.specializations.filter((s) => s.parent === advancedClassId);
  }

  /**
   * Options available to this hunter *right now*, with the reason any unavailable option
   * is blocked. The UI needs the blocked ones too — "Sentinel at level 20" is more useful
   * to a player than an empty list.
   */
  availableAdvancements(hunter: Hunter): readonly {
    node: ClassNodeDef;
    available: boolean;
    reason: string | undefined;
  }[] {
    const chain = hunter.classChain;

    const candidates = chain.advanced
      ? chain.specialization
        ? []
        : this.specializationOptions(chain.advanced)
      : this.advancedOptions(chain.archetype);

    return candidates.map((node) => {
      if (hunter.level < node.requiredLevel) {
        return {
          node,
          available: false,
          reason: `requires level ${node.requiredLevel}`,
        };
      }
      return { node, available: true, reason: undefined };
    });
  }

  /**
   * Advance a hunter to the next stage.
   * Rejects: skipping a stage, advancing twice, advancing into another archetype's branch,
   * and advancing under-level. Each rejection is a value, not an exception, because both
   * the AI and the UI ask this question speculatively.
   */
  advance(hunter: Hunter, targetClassId: string): Result<Hunter, string> {
    const target = this.node(targetClassId);
    if (!target) return err(`unknown class "${targetClassId}"`);

    if (target.stage === 'archetype') {
      return err('archetype is assigned at creation and cannot be advanced into');
    }

    if (hunter.classChain.specialization) {
      return err(`${hunter.name} has already reached a specialization`);
    }

    if (target.stage === 'advanced') {
      if (hunter.classChain.advanced) {
        return err(`${hunter.name} has already taken an advanced class`);
      }
      if (target.parent !== hunter.classChain.archetype) {
        return err(
          `${target.name} advances from ${target.parent ?? '<none>'}, not ${hunter.classChain.archetype}`,
        );
      }
      if (hunter.level < target.requiredLevel) {
        return err(`${target.name} requires level ${target.requiredLevel}`);
      }
      return ok(
        withClassChain(hunter, {
          ...hunter.classChain,
          advanced: asAdvancedClassId(target.id),
        }),
      );
    }

    // stage === 'specialization'
    if (!hunter.classChain.advanced) {
      return err('a specialization requires an advanced class first');
    }
    if (target.parent !== hunter.classChain.advanced) {
      return err(
        `${target.name} specialises from ${target.parent ?? '<none>'}, not ${hunter.classChain.advanced}`,
      );
    }
    if (hunter.level < target.requiredLevel) {
      return err(`${target.name} requires level ${target.requiredLevel}`);
    }
    return ok(
      withClassChain(hunter, {
        ...hunter.classChain,
        specialization: asSpecializationId(target.id),
      }),
    );
  }

  /** Every class node in the hunter's chain, resolved to definitions. */
  chainNodes(hunter: Hunter): readonly ClassNodeDef[] {
    const nodes: ClassNodeDef[] = [];
    for (const id of classChainIds(hunter)) {
      const node = this.node(id);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  /**
   * Blended class contribution across the chain, weighted toward the most specific stage.
   *
   * A Bulwark is still a Vanguard — the archetype has not stopped being true — but the
   * specialization is the sharper statement of identity, so it dominates. This is what
   * makes two Sentinels who specialised differently read as genuinely different hunters
   * rather than as the same class with a different label.
   */
  blendedClassProfile(hunter: Hunter): {
    roleLean: Readonly<Partial<Record<Role, number>>>;
    rangeBand: Readonly<Partial<Record<RangeBand, number>>>;
    attributeAffinity: Readonly<Partial<Record<AttributeKey, number>>>;
    riskPostureShift: number;
    skillTags: readonly string[];
  } {
    const nodes = this.chainNodes(hunter);
    // Later stages weigh more: archetype 1, advanced 2, specialization 3.
    const stageWeight: Record<string, number> = {
      archetype: 1,
      advanced: 2,
      specialization: 3,
    };

    const roleLean: Partial<Record<Role, number>> = {};
    const rangeBand: Partial<Record<RangeBand, number>> = {};
    const attributeAffinity: Partial<Record<AttributeKey, number>> = {};
    const tags = new Set<string>();
    let riskPostureShift = 0;
    let totalWeight = 0;

    for (const node of nodes) {
      const weight = stageWeight[node.stage] ?? 1;
      totalWeight += weight;

      for (const [role, value] of Object.entries(node.roleLean)) {
        const key = role as Role;
        roleLean[key] = (roleLean[key] ?? 0) + value * weight;
      }
      for (const [band, value] of Object.entries(node.rangeBand)) {
        const key = band as RangeBand;
        rangeBand[key] = (rangeBand[key] ?? 0) + value * weight;
      }
      for (const [attr, value] of Object.entries(node.attributeAffinity)) {
        const key = attr as AttributeKey;
        attributeAffinity[key] = (attributeAffinity[key] ?? 0) + value * weight;
      }
      riskPostureShift += node.riskPostureShift * weight;
      for (const tag of node.skillTags) tags.add(tag);
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

    return {
      roleLean,
      rangeBand,
      attributeAffinity,
      riskPostureShift,
      skillTags: [...tags],
    };
  }

  /** Human-readable chain, e.g. "Vanguard → Sentinel → Bulwark". */
  describeChain(hunter: Hunter): string {
    return this.chainNodes(hunter)
      .map((n) => n.name)
      .join(' → ');
  }

  currentNode(hunter: Hunter): ClassNodeDef | undefined {
    return this.node(currentClassId(hunter));
  }
}
