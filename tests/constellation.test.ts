/**
 * The skill constellation (v1.0 §5).
 *
 * Replaces the class-chain suite. The decisions these protect are the ones that make a
 * constellation different from three parallel trees: multiple routes to a node, starting
 * positions that bias rather than silo, and class identity *derived* from where a hunter
 * actually went rather than declared at an advancement step.
 */

import { describe, expect, it } from 'vitest';
import { testSession } from './helpers.js';
import { loadContent } from '../src/data/loader.js';

const content = loadContent();

describe('graph shape', () => {
  it('gives every archetype a free starting position', () => {
    for (const archetype of content.archetypes) {
      const entryId = content.constellation.entryNodes[archetype.id];
      expect(entryId, `${archetype.id} has no entry node`).toBeDefined();

      const node = content.constellationNodesById.get(entryId ?? '');
      expect(node?.prerequisiteGroups).toEqual([]);
      expect(node?.requiredLevel).toBe(1);
    }
  });

  it('teaches every skill through exactly one node', () => {
    const skills = content.skills.map((s) => s.id).sort();
    const taught = content.constellation.nodes.map((n) => n.skill).sort();
    expect(taught).toEqual(skills);
  });

  it('offers more than one route into at least one node', () => {
    // A single route everywhere would make this three trees wearing a constellation's name.
    const multiRoute = content.constellation.nodes.filter((n) => n.prerequisiteGroups.length > 1);
    expect(multiRoute.length).toBeGreaterThan(0);
  });

  it('declares an affinity for every archetype on every node', () => {
    for (const node of content.constellation.nodes) {
      for (const archetype of content.archetypes) {
        expect(
          node.archetypeAffinity[archetype.id],
          `${node.id} has no affinity for ${archetype.id}`,
        ).toBeDefined();
      }
    }
  });

  it('keeps most nodes reachable from more than one starting position', () => {
    // v1.0 §5: "flexible starting identities, not rigid content silos". If most nodes were
    // reachable from exactly one archetype, the constellation would be silos with extra steps.
    const shared = content.constellation.nodes.filter(
      (n) => Object.values(n.archetypeAffinity).filter((a) => a > 0).length > 1,
    );
    expect(shared.length / content.constellation.nodes.length).toBeGreaterThan(0.75);
  });

  it('uses zero affinity sparingly', () => {
    const totalPairs = content.constellation.nodes.length * content.archetypes.length;
    const blocked = content.constellation.nodes.reduce(
      (sum, n) => sum + Object.values(n.archetypeAffinity).filter((a) => a === 0).length,
      0,
    );
    expect(blocked / totalPairs).toBeLessThan(0.2);
  });

  it('assigns every node to a real region', () => {
    for (const node of content.constellation.nodes) {
      expect(content.regionsById.has(node.region), `${node.id} region`).toBe(true);
    }
  });

  it('gives tier-2 regions a tier-1 parent', () => {
    for (const region of content.regions) {
      if (region.tier !== 2) continue;
      const parent = content.regionsById.get(region.parent ?? '');
      expect(parent?.tier).toBe(1);
    }
  });
});

describe('eligibility (v1.0 §5 — level, class, weapon, build, prerequisites, books)', () => {
  it('lets a fresh hunter take their starting position and nothing gated', () => {
    const { session, debug } = testSession('entry');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });

    expect(session.constellation.eligibility(hunter, 'shield_bash').eligible).toBe(true);
    // Level-gated.
    expect(session.constellation.eligibility(hunter, 'guard_stance').eligible).toBe(false);
  });

  it('blocks on level and says so', () => {
    const { session, debug } = testSession('level');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 5 });
    const verdict = session.constellation.eligibility(hunter, 'guard_stance');

    expect(verdict.eligible).toBe(false);
    expect(verdict.unmet.join(' ')).toMatch(/level 10/);
  });

  it('blocks on prerequisites and names every route', () => {
    const { session, debug } = testSession('prereq');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 60 });
    const verdict = session.constellation.eligibility(hunter, 'last_stand');

    expect(verdict.eligible).toBe(false);
    // last_stand has two routes: guard_stance + taunt, or riposte.
    expect(verdict.unmet.join(' ')).toMatch(/or/);
  });

  it('blocks on archetype reach, and says whose territory it is', () => {
    const { session, debug } = testSession('reach');
    const adept = debug.spawnHunter({ archetype: 'adept', level: 60 });
    const verdict = session.constellation.eligibility(adept, 'taunt');

    expect(verdict.reachable).toBe(false);
    expect(verdict.affinity).toBe(0);
    expect(verdict.unmet.join(' ')).toMatch(/unreachable/);
  });

  it('blocks on a missing skill book, separately flagged for the tree', () => {
    const { session, debug } = testSession('book-gate');
    const hunter = debug.spawnHunter({ archetype: 'adept', level: 60 });
    debug.refreshLoadout(hunter.id);

    const verdict = session.constellation.eligibility(
      session.roster.require(hunter.id),
      'ember_lance',
    );
    expect(verdict.needsSkillBook).toBe(true);
    expect(verdict.unmet.join(' ')).toMatch(/skill book/);
  });

  it('unblocks once the guild holds the book', () => {
    const { session, debug } = testSession('book-held');
    const hunter = debug.spawnHunter({ archetype: 'adept', level: 60 });
    debug.maxOut(hunter.id, 'int');
    debug.refreshLoadout(hunter.id);
    debug.giveSkillBook('ember_lance');

    const verdict = session.constellation.eligibility(
      session.roster.require(hunter.id),
      'ember_lance',
    );
    expect(verdict.needsSkillBook).toBe(false);
    expect(verdict.eligible).toBe(true);
  });

  it('blocks on an attribute requirement', () => {
    const { session, debug } = testSession('attr-gate');
    const hunter = debug.spawnHunter({ archetype: 'adept', level: 60 });
    debug.refreshLoadout(hunter.id);
    debug.giveSkillBook('ember_lance');

    // Base INT is 5; ember_lance wants 12.
    const verdict = session.constellation.eligibility(
      session.roster.require(hunter.id),
      'ember_lance',
    );
    expect(verdict.unmet.join(' ')).toMatch(/INT 12/);
  });

  it('blocks on weapon type and clears when the right weapon is equipped', () => {
    const { session, commands, debug } = testSession('weapon-gate');
    const hunter = debug.spawnHunter({ archetype: 'ranger', level: 40 });
    debug.refreshLoadout(hunter.id);

    // riposte wants a blade, maul or gauntlets.
    const blocked = session.constellation.eligibility(
      session.roster.require(hunter.id),
      'riposte',
    );
    expect(blocked.unmet.join(' ')).toMatch(/blade|maul|gauntlets/);

    const blade = debug.spawnItem({ itemLevel: 40, typeId: 'blade', rarity: 'rare' });
    expect(commands.equipItem(hunter.id, String(blade.id)).ok).toBe(true);

    const cleared = session.constellation.eligibility(
      session.roster.require(hunter.id),
      'riposte',
    );
    expect(cleared.eligible).toBe(true);
  });

  it('reports every unmet requirement at once, not just the first', () => {
    const { session, debug } = testSession('all-unmet');
    const hunter = debug.spawnHunter({ archetype: 'adept', level: 1 });
    const verdict = session.constellation.eligibility(hunter, 'ember_lance');

    // Level, prerequisite, attribute and book are all unmet simultaneously.
    expect(verdict.unmet.length).toBeGreaterThanOrEqual(3);
  });
});

describe('taking nodes', () => {
  it('learns the skill and records the node as taken — they are the same act', () => {
    const { session, commands, debug } = testSession('take');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 20 });

    expect(commands.takeNode(hunter.id, 'shield_bash').ok).toBe(true);

    const updated = session.roster.require(hunter.id);
    expect(updated.knownSkills).toContain('shield_bash');
    expect(session.constellation.hasNode(updated, 'shield_bash')).toBe(true);
  });

  it('refuses to take the same node twice', () => {
    const { commands, debug } = testSession('take-twice');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 20 });

    expect(commands.takeNode(hunter.id, 'shield_bash').ok).toBe(true);
    const again = commands.takeNode(hunter.id, 'shield_bash');
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/already taken/);
  });

  it('refuses an ineligible node with the reasons', () => {
    const { commands, debug } = testSession('take-blocked');
    const hunter = debug.spawnHunter({ archetype: 'adept', level: 60 });
    const result = commands.takeNode(hunter.id, 'taunt');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unreachable/);
  });

  it('opens successors once a prerequisite is taken', () => {
    const { session, commands, debug } = testSession('unlock');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 20 });

    expect(session.constellation.eligibility(hunter, 'guard_stance').eligible).toBe(false);
    commands.takeNode(hunter.id, 'shield_bash');

    expect(
      session.constellation.eligibility(session.roster.require(hunter.id), 'guard_stance').eligible,
    ).toBe(true);
  });

  it('allows either route into a multi-route node', () => {
    // riposte is reachable via guard_stance (Vanguard route) or piercing_shot (Ranger route).
    const { session, commands, debug } = testSession('routes');

    const viaDefence = debug.spawnHunter({ archetype: 'vanguard', level: 40 });
    commands.takeNode(viaDefence.id, 'shield_bash');
    commands.takeNode(viaDefence.id, 'guard_stance');

    const viaPrecision = debug.spawnHunter({ archetype: 'ranger', level: 40 });
    commands.takeNode(viaPrecision.id, 'piercing_shot');

    const blade1 = debug.spawnItem({ itemLevel: 40, typeId: 'blade', rarity: 'rare' });
    const blade2 = debug.spawnItem({ itemLevel: 40, typeId: 'blade', rarity: 'rare' });
    commands.equipItem(viaDefence.id, String(blade1.id));
    commands.equipItem(viaPrecision.id, String(blade2.id));

    expect(
      session.constellation.eligibility(session.roster.require(viaDefence.id), 'riposte').eligible,
    ).toBe(true);
    expect(
      session.constellation.eligibility(session.roster.require(viaPrecision.id), 'riposte').eligible,
    ).toBe(true);
  });

  it('emits a node-taken event carrying the region', () => {
    const { session, commands, debug } = testSession('event');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 20 });

    const seen: { nodeId: string; regionId: string }[] = [];
    session.events.on('constellation.nodeTaken', (payload) =>
      seen.push({ nodeId: payload.nodeId, regionId: payload.regionId }),
    );

    commands.takeNode(hunter.id, 'shield_bash');
    expect(seen).toEqual([{ nodeId: 'shield_bash', regionId: 'sentinel' }]);
  });
});

describe('derived class identity (v1.0 §5)', () => {
  it('describes a fresh hunter by their starting position alone', () => {
    const { session, debug } = testSession('identity-fresh');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });
    expect(session.constellation.describeIdentity(hunter)).toBe('Vanguard');
  });

  it('names the regions a hunter has actually invested in', () => {
    const { session, commands, debug } = testSession('identity-derived');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 40 });

    commands.takeNode(hunter.id, 'shield_bash');
    commands.takeNode(hunter.id, 'taunt');

    const identity = session.constellation.describeIdentity(session.roster.require(hunter.id));
    expect(identity).toMatch(/^Vanguard · /);
    expect(identity).toMatch(/Sentinel/);
  });

  it('changes as the hunter travels — identity is derived, never declared', () => {
    const { session, commands, debug } = testSession('identity-moves');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 40 });

    commands.takeNode(hunter.id, 'shield_bash');
    const early = session.constellation.describeIdentity(session.roster.require(hunter.id));

    commands.takeNode(hunter.id, 'drag_to_safety');
    commands.takeNode(hunter.id, 'guard_stance');
    const later = session.constellation.describeIdentity(session.roster.require(hunter.id));

    expect(later).not.toBe(early);
  });

  it('weights region investment by depth', () => {
    const { session, commands, debug } = testSession('investment');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 40 });

    commands.takeNode(hunter.id, 'shield_bash');
    commands.takeNode(hunter.id, 'guard_stance');

    const investment = session.constellation.regionInvestment(session.roster.require(hunter.id));
    expect(investment.length).toBeGreaterThan(0);

    const shares = investment.reduce((sum, i) => sum + i.share, 0);
    expect(shares).toBeCloseTo(1, 6);

    // Bulwark is tier 2, Sentinel tier 1 — equal node counts, unequal weight.
    const bulwark = investment.find((i) => i.region.id === 'bulwark');
    const sentinel = investment.find((i) => i.region.id === 'sentinel');
    if (bulwark && sentinel && bulwark.nodes === sentinel.nodes) {
      expect(bulwark.weight).toBeGreaterThan(sentinel.weight);
    }
  });

  it('still counts the starting position in the blended profile', () => {
    // A Vanguard who wandered into Adept territory is still a Vanguard who did that.
    const { session, debug } = testSession('blend-archetype');
    const hunter = debug.spawnHunter({ archetype: 'vanguard' });

    const profile = session.constellation.blendedClassProfile(hunter);
    expect(profile.roleLean.tank ?? 0).toBeGreaterThan(0);
    expect(profile.skillTags.length).toBeGreaterThan(0);
  });

  it('produces different profiles for hunters who travelled differently', () => {
    const { session, commands, debug } = testSession('blend-diverge');

    const holder = debug.spawnHunter({ archetype: 'vanguard', level: 40 });
    const rescuer = debug.spawnHunter({ archetype: 'vanguard', level: 40 });

    commands.takeNode(holder.id, 'shield_bash');
    commands.takeNode(holder.id, 'taunt');

    commands.takeNode(rescuer.id, 'shield_bash');
    commands.takeNode(rescuer.id, 'drag_to_safety');

    const a = session.constellation.blendedClassProfile(session.roster.require(holder.id));
    const b = session.constellation.blendedClassProfile(session.roster.require(rescuer.id));

    expect(a.roleLean).not.toEqual(b.roleLean);
  });
});

describe('frontier and availability', () => {
  it('separates takeable-now from reachable-later', () => {
    const { session, debug } = testSession('frontier');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 40 });

    const available = session.constellation.availableNodes(hunter).map((n) => n.id);
    const frontier = session.constellation.frontierNodes(hunter).map((e) => e.nodeId);

    expect(available).toContain('shield_bash');
    expect(frontier).toContain('guard_stance');
    // Nothing appears in both.
    expect(available.filter((id) => frontier.includes(id))).toEqual([]);
  });

  it('excludes unreachable nodes from the frontier entirely', () => {
    const { session, debug } = testSession('frontier-reach');
    const adept = debug.spawnHunter({ archetype: 'adept', level: 60 });
    const frontier = session.constellation.frontierNodes(adept).map((e) => e.nodeId);
    expect(frontier).not.toContain('taunt');
  });

  it('lists what taking a node opens up', () => {
    const { session } = testSession('successors');
    const successors = session.constellation.successorsOf('shield_bash').map((n) => n.id);
    expect(successors).toContain('guard_stance');
    expect(successors).toContain('taunt');
  });
});
