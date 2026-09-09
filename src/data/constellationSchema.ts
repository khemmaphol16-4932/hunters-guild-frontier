/**
 * Constellation content types and validators.
 *
 * v1.0 §5. Replaces the three-stage class chain and its per-skill class allowlist
 * (`skill-compatibility.json`) with one node graph. See SPEC_RECONCILIATION C5 and DL-022.
 */

import {
  ATTRIBUTE_KEYS,
  RANGE_BANDS,
  ROLES,
  ContentValidationError,
  assertUniqueIds,
  expectArray,
  expectBoolean,
  expectEnum,
  expectNumber,
  expectObject,
  expectString,
  expectStringArray,
  expectWeights,
  field,
  optionalField,
  type AttributeKey,
  type AttributeWeights,
  type RangeWeights,
  type RoleWeights,
} from './schema.js';

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

/**
 * A named area of the constellation.
 *
 * Regions are descriptive, never gates. A hunter who has invested in Sentinel-region nodes
 * *reads as* a Sentinel; nothing declares them one. `tier` records depth — tier 2 regions sit
 * further out and therefore say more about identity than tier 1 ones.
 */
export interface RegionDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** The archetype this region sits closest to. Not a restriction. */
  readonly archetype: string;
  readonly tier: number;
  /** Tier-2 regions name the tier-1 region they extend. */
  readonly parent: string | undefined;
  readonly roleLean: RoleWeights;
  readonly rangeBand: RangeWeights;
  readonly attributeAffinity: AttributeWeights;
  readonly riskPostureShift: number;
  readonly skillTags: readonly string[];
}

export function parseRegions(raw: unknown, path = 'regions.json'): readonly RegionDef[] {
  const o = expectObject(raw, path);
  const regions = expectArray(field(o, 'regions', path), `${path}.regions`).map((entry, i) => {
    const p = `${path}.regions[${i}]`;
    const e = expectObject(entry, p);
    const parentRaw = optionalField(e, 'parent');
    const tier = expectNumber(field(e, 'tier', p), `${p}.tier`);

    if (tier !== 1 && tier !== 2) {
      throw new ContentValidationError(`${p}.tier`, 'regions sit at tier 1 or tier 2');
    }

    const parent =
      parentRaw === null || parentRaw === undefined
        ? undefined
        : expectString(parentRaw, `${p}.parent`);

    if (tier === 2 && parent === undefined) {
      throw new ContentValidationError(`${p}.parent`, 'a tier-2 region must name its parent');
    }
    if (tier === 1 && parent !== undefined) {
      throw new ContentValidationError(`${p}.parent`, 'a tier-1 region has no parent');
    }

    return {
      id: expectString(field(e, 'id', p), `${p}.id`),
      name: expectString(field(e, 'name', p), `${p}.name`),
      description: expectString(field(e, 'description', p), `${p}.description`),
      archetype: expectString(field(e, 'archetype', p), `${p}.archetype`),
      tier,
      parent,
      roleLean: expectWeights(field(e, 'roleLean', p), `${p}.roleLean`, ROLES),
      rangeBand: expectWeights(field(e, 'rangeBand', p), `${p}.rangeBand`, RANGE_BANDS),
      attributeAffinity: expectWeights(
        field(e, 'attributeAffinity', p),
        `${p}.attributeAffinity`,
        ATTRIBUTE_KEYS,
      ),
      riskPostureShift: expectNumber(field(e, 'riskPostureShift', p), `${p}.riskPostureShift`),
      skillTags: expectStringArray(field(e, 'skillTags', p), `${p}.skillTags`),
    };
  });

  assertUniqueIds(regions.map((r) => r.id), `${path}.regions`);
  return regions;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export interface AttributeRequirement {
  readonly attribute: AttributeKey;
  readonly min: number;
}

export interface ConstellationNodeDef {
  readonly id: string;
  /** The skill this node teaches. */
  readonly skill: string;
  readonly region: string;
  readonly requiredLevel: number;
  /**
   * Alternative prerequisite sets — satisfying ANY group unlocks the node. An empty list
   * means no prerequisites. Multiple groups are what give the constellation more than one
   * route to the same node.
   */
  readonly prerequisiteGroups: readonly (readonly string[])[];
  /** Archetype -> reachability, 0..1. Zero means genuinely unreachable from that start. */
  readonly archetypeAffinity: Readonly<Record<string, number>>;
  readonly requiresWeaponTypes: readonly string[] | undefined;
  readonly attributeRequirements: readonly AttributeRequirement[];
  readonly requiresSkillBook: boolean;
}

export interface ConstellationData {
  /** Archetype -> its entry node. The "different class starting positions" of §5. */
  readonly entryNodes: Readonly<Record<string, string>>;
  readonly nodes: readonly ConstellationNodeDef[];
}

export function parseConstellation(raw: unknown, path = 'nodes.json'): ConstellationData {
  const o = expectObject(raw, path);

  const entryRaw = expectObject(field(o, 'entryNodes', path), `${path}.entryNodes`);
  const entryNodes: Record<string, string> = {};
  for (const [archetype, nodeId] of Object.entries(entryRaw)) {
    if (archetype.startsWith('$')) continue;
    entryNodes[archetype] = expectString(nodeId, `${path}.entryNodes.${archetype}`);
  }

  const nodes = expectArray(field(o, 'nodes', path), `${path}.nodes`).map((entry, i) => {
    const p = `${path}.nodes[${i}]`;
    const e = expectObject(entry, p);

    const groups = expectArray(
      field(e, 'prerequisiteGroups', p),
      `${p}.prerequisiteGroups`,
    ).map((group, gi) => expectStringArray(group, `${p}.prerequisiteGroups[${gi}]`));

    for (const [gi, group] of groups.entries()) {
      if (group.length === 0) {
        throw new ContentValidationError(
          `${p}.prerequisiteGroups[${gi}]`,
          'an empty group would make the node free; use an empty groups list instead',
        );
      }
    }

    const affinityRaw = expectObject(
      field(e, 'archetypeAffinity', p),
      `${p}.archetypeAffinity`,
    );
    const archetypeAffinity: Record<string, number> = {};
    for (const [archetype, value] of Object.entries(affinityRaw)) {
      if (archetype.startsWith('$')) continue;
      const affinity = expectNumber(value, `${p}.archetypeAffinity.${archetype}`);
      if (affinity < 0 || affinity > 1) {
        throw new ContentValidationError(
          `${p}.archetypeAffinity.${archetype}`,
          'affinity is a 0..1 reachability, not a multiplier',
        );
      }
      archetypeAffinity[archetype] = affinity;
    }

    const weaponRaw = optionalField(e, 'requiresWeaponTypes');
    const attributeRaw = optionalField(e, 'attributeRequirements');

    const attributeRequirements =
      attributeRaw === undefined
        ? []
        : expectArray(attributeRaw, `${p}.attributeRequirements`).map((req, ri) => {
            const rp = `${p}.attributeRequirements[${ri}]`;
            const r = expectObject(req, rp);
            return {
              attribute: expectEnum(field(r, 'attribute', rp), `${rp}.attribute`, ATTRIBUTE_KEYS),
              min: expectNumber(field(r, 'min', rp), `${rp}.min`),
            };
          });

    return {
      id: expectString(field(e, 'id', p), `${p}.id`),
      skill: expectString(field(e, 'skill', p), `${p}.skill`),
      region: expectString(field(e, 'region', p), `${p}.region`),
      requiredLevel: expectNumber(field(e, 'requiredLevel', p), `${p}.requiredLevel`),
      prerequisiteGroups: groups,
      archetypeAffinity,
      requiresWeaponTypes:
        weaponRaw === undefined
          ? undefined
          : expectStringArray(weaponRaw, `${p}.requiresWeaponTypes`),
      attributeRequirements,
      requiresSkillBook: expectBoolean(field(e, 'requiresSkillBook', p), `${p}.requiresSkillBook`),
    };
  });

  assertUniqueIds(nodes.map((n) => n.id), `${path}.nodes`);

  // A node may only teach one skill, and a skill may only be taught by one node — otherwise
  // "learn the skill" and "take the node" stop being the same act and the graph becomes
  // ambiguous about what a hunter has actually done.
  assertUniqueIds(nodes.map((n) => n.skill), `${path}.nodes (skill)`);

  return { entryNodes, nodes };
}

/**
 * Graph integrity: prerequisites must exist, entry nodes must be real and free, and the
 * graph must be acyclic and fully reachable.
 *
 * Reachability is the important one. An unreachable node is content nobody can ever have,
 * and it fails silently — the skill simply never appears in anyone's options.
 */
export function validateConstellationGraph(
  data: ConstellationData,
  regionIds: ReadonlySet<string>,
  archetypeIds: ReadonlySet<string>,
  path = 'nodes.json',
): void {
  const byId = new Map(data.nodes.map((n) => [n.id, n]));

  for (const node of data.nodes) {
    if (!regionIds.has(node.region)) {
      throw new ContentValidationError(`${path}:${node.id}`, `unknown region "${node.region}"`);
    }
    for (const archetype of Object.keys(node.archetypeAffinity)) {
      if (!archetypeIds.has(archetype)) {
        throw new ContentValidationError(
          `${path}:${node.id}`,
          `unknown archetype "${archetype}" in archetypeAffinity`,
        );
      }
    }
    // Every archetype needs a stated affinity, or reachability from that start is undefined.
    for (const archetype of archetypeIds) {
      if (!(archetype in node.archetypeAffinity)) {
        throw new ContentValidationError(
          `${path}:${node.id}`,
          `no archetypeAffinity declared for "${archetype}"`,
        );
      }
    }
    for (const group of node.prerequisiteGroups) {
      for (const prerequisite of group) {
        if (!byId.has(prerequisite)) {
          throw new ContentValidationError(
            `${path}:${node.id}`,
            `prerequisite "${prerequisite}" is not a node`,
          );
        }
      }
    }
  }

  for (const [archetype, nodeId] of Object.entries(data.entryNodes)) {
    if (!archetypeIds.has(archetype)) {
      throw new ContentValidationError(
        `${path}.entryNodes`,
        `unknown archetype "${archetype}"`,
      );
    }
    const node = byId.get(nodeId);
    if (!node) {
      throw new ContentValidationError(
        `${path}.entryNodes.${archetype}`,
        `"${nodeId}" is not a node`,
      );
    }
    if (node.prerequisiteGroups.length > 0) {
      throw new ContentValidationError(
        `${path}.entryNodes.${archetype}`,
        'a starting position cannot have prerequisites',
      );
    }
    if ((node.archetypeAffinity[archetype] ?? 0) <= 0) {
      throw new ContentValidationError(
        `${path}.entryNodes.${archetype}`,
        `"${nodeId}" is unreachable for the archetype that starts there`,
      );
    }
  }
  for (const archetype of archetypeIds) {
    if (!(archetype in data.entryNodes)) {
      throw new ContentValidationError(
        `${path}.entryNodes`,
        `archetype "${archetype}" has no starting position`,
      );
    }
  }

  // Acyclicity, via depth-first search over prerequisite edges.
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (nodeId: string, trail: readonly string[]): void => {
    const status = state.get(nodeId);
    if (status === 'done') return;
    if (status === 'visiting') {
      throw new ContentValidationError(
        `${path}:${nodeId}`,
        `prerequisite cycle: ${[...trail, nodeId].join(' -> ')}`,
      );
    }

    state.set(nodeId, 'visiting');
    for (const group of byId.get(nodeId)?.prerequisiteGroups ?? []) {
      for (const prerequisite of group) visit(prerequisite, [...trail, nodeId]);
    }
    state.set(nodeId, 'done');
  };
  for (const node of data.nodes) visit(node.id, []);

  // Reachability: a node is reachable from an archetype when that archetype has non-zero
  // affinity for it AND at least one prerequisite group is itself wholly reachable from
  // there. Grown to a fixed point per archetype, then unioned.
  const reachableByAnyone = new Set<string>();

  for (const archetype of archetypeIds) {
    const reachable = new Set<string>();
    let grew = true;

    while (grew) {
      grew = false;
      for (const node of data.nodes) {
        if (reachable.has(node.id)) continue;
        if ((node.archetypeAffinity[archetype] ?? 0) <= 0) continue;

        const satisfied =
          node.prerequisiteGroups.length === 0 ||
          node.prerequisiteGroups.some((group) => group.every((id) => reachable.has(id)));

        if (satisfied) {
          reachable.add(node.id);
          grew = true;
        }
      }
    }

    for (const id of reachable) reachableByAnyone.add(id);
  }

  for (const node of data.nodes) {
    if (!reachableByAnyone.has(node.id)) {
      throw new ContentValidationError(
        `${path}:${node.id}`,
        'no archetype can reach this node, so the skill could never be learned',
      );
    }
  }
}
