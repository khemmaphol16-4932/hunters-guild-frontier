import { describe, expect, it } from 'vitest';
import { CURRENT_SAVE_VERSION } from '../src/save/envelope.js';
import { migratePayload } from '../src/save/migrations/index.js';
import { loadContent } from '../src/data/loader.js';
import { WorldEvents } from '../src/systems/world/WorldEvents.js';
import { testSession } from './helpers.js';

const content = loadContent();
const TICKS_PER_STEP = 20;
const events = () => new WorldEvents({ boss: content.worldBoss, ticksPerStep: () => TICKS_PER_STEP });

function veterans(seed: string) {
  const h = testSession(seed);
  h.commands.foundTown();
  for (let i = 0; i < 4; i++) h.debug.spawnHunter({ level: 70, fullyEquipped: true });
  return h;
}

/** Challenge the world boss until it falls (a strong party needs a try or two). */
function killWorldBoss(h: ReturnType<typeof veterans>) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const outcome = h.commands.sendWorldBossExpedition();
    if (outcome.ok && outcome.value.result.bossDefeated) return outcome.value;
    h.commands.advanceTown(100);
  }
  throw new Error('the world boss was never defeated');
}

describe('world-boss events (REQ-BOS-003)', () => {
  it('places the Drowned Choir in a real region with its own card pool', () => {
    const { session, commands } = testSession('world-boss-placement');
    expect(commands.worldBossEvent()).toMatchObject({ bossId: 'the_drowned_choir', regionId: 'ashfall_barrows' });
    expect(session.content.monstersById.get('the_drowned_choir')?.cardPool).toEqual(['hollow_choir_card']);
  });

  it('respawns after the authored number of COARSE steps, not ticks (DL-056)', () => {
    const world = events();
    const first = world.currentWorldBoss(0)!;
    expect(world.defeat(first.id, 10)).toBe(true);
    const respawnTick = 10 + content.worldBoss.respawnSteps * TICKS_PER_STEP;
    expect(world.currentWorldBoss(respawnTick - 1)).toBeUndefined();
    expect(world.currentWorldBoss(respawnTick)).toMatchObject({ id: `${content.worldBoss.id}:2`, appearedAtTick: respawnTick });
  });

  it('in play, the Choir stays gone for the authored number of steps', () => {
    const h = veterans('world-boss-respawn');
    killWorldBoss(h);
    const stepsUntil = (h.session.worldEvents.snapshot().nextWorldBossAtTick - h.session.clock.tick) / h.session.clock.coarseStepRatio;
    expect(stepsUntil).toBe(content.worldBoss.respawnSteps);
  });

  it('one kill counts once in each hunter’s history (it counted twice)', () => {
    const h = veterans('world-boss-count');
    const outcome = killWorldBoss(h);
    for (const member of outcome.party.members) {
      const after = outcome.result.aftermath.find((a) => a.hunterId === member.hunterId);
      if (after?.died) continue;
      expect(h.session.chronicle.counter(member.hunterId, 'bossesDefeated')).toBe(1);
    }
    expect(h.session.monument.all().filter((e) => e.kind === 'worldBossVictory')).toHaveLength(1);
  });

  it('duplicate protection guarantees the card, and a duplicate converts to essence', () => {
    const world = events();
    const guarantee = content.balance.loot.bossCards.duplicateProtection.guaranteeAfterKills;
    for (let i = 0; i < guarantee - 1; i++) world.recordCardRoll(false);
    expect(world.killsSinceCard).toBe(guarantee - 1);

    const h = veterans('world-boss-card');
    h.session.worldEvents.restore({ ...h.session.worldEvents.snapshot(), killsSinceCard: guarantee - 1 });
    h.session.armoury.addCard('hollow_choir_card');
    const essence = h.session.resources.amount('essence');
    killWorldBoss(h);
    expect(h.session.armoury.cardCount('hollow_choir_card')).toBe(2);
    expect(h.session.resources.amount('essence')).toBeGreaterThan(essence);
    expect(h.session.worldEvents.killsSinceCard).toBe(0);
  });

  it('persists active/respawn state and migrates older saves', () => {
    const first = events();
    const active = first.currentWorldBoss(12)!;
    const second = events();
    second.restore(first.snapshot());
    expect(second.currentWorldBoss(12)).toEqual(active);

    const migrated = migratePayload({}, 22, CURRENT_SAVE_VERSION) as Record<string, unknown>;
    expect(migrated['worldEvents']).toEqual({ nextWorldBossAtTick: 0, worldBossDefeats: 0 });
  });
});
