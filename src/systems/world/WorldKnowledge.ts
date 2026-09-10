/**
 * What the guild knows about the world.
 *
 * REQ-WLD-001: the world map is persistent and exploration information is *permanent* —
 * once the guild has learned something about a region it never unlearns it, even if every
 * hunter who went there is dead. §8 goes further and calls the map a knowledge interface
 * rather than a level select: what you can see about a region is itself progression.
 *
 * That is why knowledge lives on the *guild* and not on hunters. A roster wipe costs you
 * the hunters, not the map. Tying discovery to hunters would mean a guild could forget a
 * region it had mastered, which is both wrong and cruel in a way REQ-WLD-001 forbids.
 *
 * Knowledge only ever advances (`raise`), and the tiers are ordered. There is deliberately
 * no way to lower one: a "you have forgotten this region" mechanic is exactly what
 * permanence rules out, so the type does not offer it.
 */

import type { KnowledgeTier, RegionDef } from '../../data/combatSchema.js';
import { KNOWLEDGE_TIERS } from '../../data/combatSchema.js';

/** Everything the guild has learned about one region. */
export interface RegionKnowledge {
  readonly regionId: string;
  readonly tier: KnowledgeTier;
  /** Completed expeditions, successful or not. */
  readonly visits: number;
  /** Route node kinds the guild has actually seen here, so the map can show them. */
  readonly seenNodeKinds: readonly string[];
  /** Monsters encountered here. Feeds the bestiary and pre-deployment fit analysis. */
  readonly seenMonsters: readonly string[];
  readonly bossDefeated: boolean;
  /** Deepest route index reached, so "you have never seen past node 3" is expressible. */
  readonly deepestNode: number;
}

export interface WorldKnowledgeSnapshot {
  readonly regions: readonly RegionKnowledge[];
}

const TIER_RANK = new Map<KnowledgeTier, number>(KNOWLEDGE_TIERS.map((t, i) => [t, i]));

/** How many visits it takes to reach each tier, once the region has been entered at all. */
const VISITS_FOR_TIER: readonly { readonly tier: KnowledgeTier; readonly visits: number }[] = [
  { tier: 'discovered', visits: 1 },
  { tier: 'experienced', visits: 3 },
  { tier: 'mastered', visits: 8 },
];

export interface WorldKnowledgeDeps {
  readonly regions: readonly RegionDef[];
  /** Emitted the first time the guild sets foot in a region (§19 Chronicle). */
  readonly onFirstEntry?: (region: RegionDef) => void;
}

export class WorldKnowledge {
  private readonly state = new Map<string, RegionKnowledge>();

  constructor(private readonly deps: WorldKnowledgeDeps) {
    this.reset();
  }

  /** Start from each region's authored starting knowledge. */
  reset(): void {
    this.state.clear();
    for (const region of this.deps.regions) {
      this.state.set(region.id, {
        regionId: region.id,
        tier: region.knowledgeTier,
        visits: 0,
        seenNodeKinds: [],
        seenMonsters: [],
        bossDefeated: false,
        deepestNode: 0,
      });
    }
  }

  of(regionId: string): RegionKnowledge {
    const known = this.state.get(regionId);
    if (known) return known;
    // A region the guild has no record of is unknown, not missing — content added by an
    // update should appear as rumour rather than throwing.
    return {
      regionId,
      tier: 'unknown',
      visits: 0,
      seenNodeKinds: [],
      seenMonsters: [],
      bossDefeated: false,
      deepestNode: 0,
    };
  }

  all(): readonly RegionKnowledge[] {
    return [...this.state.values()];
  }

  /** Whether the guild knows enough about a region to send anyone there at all. */
  isKnown(regionId: string): boolean {
    return rank(this.of(regionId).tier) > rank('unknown');
  }

  /**
   * Record what an expedition learned.
   *
   * Called once per completed run, whatever its outcome — a party that was wiped at the
   * first node still learned that the first node is there, and REQ-WLD-001 makes that
   * permanent. Learning from failure is the whole point of a knowledge interface.
   */
  record(
    regionId: string,
    learned: {
      readonly nodeKinds: readonly string[];
      readonly monsters: readonly string[];
      readonly deepestNode: number;
      readonly bossDefeated: boolean;
    },
  ): RegionKnowledge {
    const before = this.of(regionId);
    const firstEntry = before.visits === 0;

    const visits = before.visits + 1;
    const merged: RegionKnowledge = {
      regionId,
      tier: this.tierFor(before.tier, visits, learned.bossDefeated || before.bossDefeated),
      visits,
      seenNodeKinds: union(before.seenNodeKinds, learned.nodeKinds),
      seenMonsters: union(before.seenMonsters, learned.monsters),
      bossDefeated: before.bossDefeated || learned.bossDefeated,
      deepestNode: Math.max(before.deepestNode, learned.deepestNode),
    };

    this.state.set(regionId, merged);

    if (firstEntry) {
      const region = this.deps.regions.find((r) => r.id === regionId);
      if (region) this.deps.onFirstEntry?.(region);
    }

    return merged;
  }

  /**
   * Raise a region's knowledge directly — from a rumour bought in town, a story beat, or a
   * scouting report. Never lowers it (REQ-WLD-001).
   */
  raise(regionId: string, tier: KnowledgeTier): RegionKnowledge {
    const before = this.of(regionId);
    if (rank(tier) <= rank(before.tier)) return before;

    const raised = { ...before, tier };
    this.state.set(regionId, raised);
    return raised;
  }

  /**
   * What the player is allowed to see about a region at its current tier (§8).
   *
   * The tiers are a disclosure ladder, not a difficulty rating: a rumoured region shows its
   * name and its danger and nothing else, and the detail arrives by going there.
   */
  describe(region: RegionDef): readonly string[] {
    const known = this.of(region.id);
    const lines: string[] = [];

    // A region's *tier* and its *recorded visits* are different things: content can start
    // the guild out already knowing somewhere it has never mounted an expedition to. Saying
    // "well travelled — 0 expeditions" conflated the two and read as a bug.
    const beenThere = known.visits > 0;
    const trips = `${known.visits} expedition${known.visits === 1 ? '' : 's'}`;

    switch (known.tier) {
      case 'unknown':
        return ['Nothing is known of this place.'];
      case 'rumor':
        lines.push('Only rumours. The guild knows roughly where it is and that it is dangerous.');
        break;
      case 'discovered':
        lines.push(
          beenThere
            ? `Walked once or twice — ${trips}.`
            : 'Charted, but no expedition has been mounted from here yet.',
        );
        break;
      case 'experienced':
        lines.push(
          beenThere
            ? `Well travelled — ${trips}. The guild knows what lives here.`
            : 'Long familiar to the guild, though not from any expedition on record.',
        );
        break;
      case 'mastered':
        lines.push(
          beenThere
            ? `Mastered over ${trips}. Nothing here is a surprise.`
            : 'Known inside out, by reputation rather than by record.',
        );
        break;
    }

    if (beenThere) {
      lines.push(`Deepest point reached: node ${known.deepestNode}.`);
      if (known.seenMonsters.length > 0) {
        lines.push(
          `${known.seenMonsters.length} kind${known.seenMonsters.length === 1 ? '' : 's'} of ` +
            'inhabitant recorded.',
        );
      }
    }
    if (known.bossDefeated) lines.push('Its warden has been killed at least once.');

    return lines;
  }

  snapshot(): WorldKnowledgeSnapshot {
    return { regions: this.all() };
  }

  restore(snapshot: WorldKnowledgeSnapshot | undefined): void {
    this.reset();
    for (const entry of snapshot?.regions ?? []) {
      // Merged rather than replaced, so a save written before a region existed still
      // yields that region's authored starting knowledge instead of nothing.
      this.state.set(entry.regionId, { ...this.of(entry.regionId), ...entry });
    }
  }

  /** Visits earn tiers, and killing the warden proves mastery outright. */
  private tierFor(current: KnowledgeTier, visits: number, bossDefeated: boolean): KnowledgeTier {
    let best = current;
    for (const step of VISITS_FOR_TIER) {
      if (visits >= step.visits && rank(step.tier) > rank(best)) best = step.tier;
    }
    if (bossDefeated && rank('experienced') > rank(best)) best = 'experienced';
    return best;
  }
}

function rank(tier: KnowledgeTier): number {
  return TIER_RANK.get(tier) ?? 0;
}

function union(a: readonly string[], b: readonly string[]): readonly string[] {
  // Sorted so a snapshot is stable and two saves of the same state compare equal.
  return [...new Set([...a, ...b])].sort();
}
