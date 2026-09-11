/**
 * The combat replay (REQ-UX-004): why a hunter died, why a boss fell, the key skills,
 * rescues, and the mistakes and turning points.
 */

import { describe, expect, it } from 'vitest';
import { tellStory } from '../src/sim/combat/combatStory.js';
import type { CombatFacts } from '../src/sim/combat/CombatEncounter.js';
import { testSession } from './helpers.js';

function facts(overrides: Partial<CombatFacts> = {}): CombatFacts {
  return {
    names: { a: 'Aila', b: 'Bren', c: 'Cato', 'brute#0': 'Hollow Brute', 'warden#1': 'The Warden' },
    bosses: [],
    damageBy: {},
    damageTo: {},
    healingBy: {},
    skillUses: {},
    kills: [],
    downs: [],
    deaths: [],
    rescues: [],
    declinedRescues: [],
    samples: [],
    ...overrides,
  };
}

describe('the combat replay (REQ-UX-004)', () => {
  it('explains a death: what brought them down, and who could have gone back', () => {
    const story = tellStory(
      facts({
        downs: [{ at: 12, targetId: 'b', sourceId: 'brute#0' }],
        declinedRescues: [{ at: 13.5, byId: 'a', targetId: 'b', chose: 'attack' }],
        deaths: [{ at: 20, id: 'b' }],
      }),
      'victory',
      40,
    );
    expect(story.verdict).toBe('Won in 40s, at the cost of 1 hunter.');
    expect(story.why[0]).toBe(
      'Bren died at 20.0s, brought down by Hollow Brute at 12.0s. Aila could have gone back for them at 13.5s but chose to keep attacking.',
    );
    expect(story.moments.map((m) => m.kind)).toEqual(['declined-rescue', 'death']);
  });

  it('says so when nobody could have reached them', () => {
    const story = tellStory(facts({ downs: [{ at: 5, targetId: 'c', sourceId: 'brute#0' }], deaths: [{ at: 13, id: 'c' }] }), 'defeat', 14);
    expect(story.why[0]).toMatch(/Nobody was in a position to reach them/);
    expect(story.verdict).toBe('The party was broken after 14s.');
  });

  it('explains a boss kill: the killing blow and the damage shares, first in the list', () => {
    const story = tellStory(
      facts({
        bosses: ['warden#1'],
        damageBy: { a: 600, b: 300, c: 100, 'warden#1': 900 },
        kills: [{ at: 51, targetId: 'warden#1', byId: 'a', label: 'Ember Lance' }],
        deaths: [{ at: 30, id: 'c' }],
      }),
      'victory',
      52,
    );
    expect(story.why[0]).toBe("The Warden fell at 51.0s to Aila's Ember Lance. Damage across the fight: Aila 60%, Bren 30%, Cato 10%.");
  });

  it('names the key skills and who leaned on them', () => {
    const story = tellStory(facts({ skillUses: { a: { 'Ember Lance': 5 }, b: { 'Ember Lance': 2, Rally: 1 } } }), 'victory', 20);
    expect(story.keySkills[0]).toBe('Ember Lance ×7 (mostly Aila)');
  });

  it('finds the turning points in the balance of the fight', () => {
    const samples = [
      { at: 1, guild: 1, enemy: 1 },
      { at: 2, guild: 0.95, enemy: 0.9 },
      { at: 3, guild: 0.5, enemy: 0.88 },
      { at: 8, guild: 0.45, enemy: 0.3 },
    ];
    const story = tellStory(facts({ samples }), 'victory', 9);
    const turns = story.moments.filter((m) => m.kind === 'turning-point').map((m) => m.text);
    expect(turns).toContain('The fight turned against the party.');
    expect(turns).toContain('The party took control of the fight.');
  });

  it('records rescues as moments', () => {
    const story = tellStory(
      facts({ downs: [{ at: 4, targetId: 'b', sourceId: 'brute#0' }], rescues: [{ at: 7, byId: 'c', targetId: 'b' }] }),
      'victory',
      10,
    );
    expect(story.moments.map((m) => m.text)).toContain('Cato pulled Bren back up.');
  });

  it('every fight in a real expedition carries a story built from real facts', () => {
    const h = testSession('story-real');
    h.commands.foundTown();
    for (let i = 0; i < 4; i++) h.debug.spawnHunter({ level: 20, fullyEquipped: true });
    const outcome = h.commands.sendExpedition('verdant_reach', 'slay');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const fights = outcome.value.result.nodes.filter((n) => n.node.kind === 'combat' || n.node.kind === 'boss');
    expect(fights.length).toBeGreaterThan(0);
    for (const fight of fights) expect(fight.story?.verdict.length).toBeGreaterThan(0);
    const boss = fights.find((f) => f.node.kind === 'boss' && f.outcome === 'cleared');
    if (boss) expect(boss.story?.why[0]).toMatch(/fell at/);
  });
});
