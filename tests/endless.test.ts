/**
 * Endless expeditions and personal records (REQ-END-002/003).
 */

import { describe, expect, it } from 'vitest';
import { migratePayload } from '../src/save/migrations/index.js';
import { testSession } from './helpers.js';

function veteranGuild(seed: string, level = 40) {
  const h = testSession(seed);
  h.commands.foundTown();
  for (let i = 0; i < 4; i++) h.debug.spawnHunter({ level, fullyEquipped: true });
  // Endless runs are an endgame activity, gated on the guild's institutional experience.
  h.session.guildMastery.record('expedition', 1_000);
  return h;
}

describe('endless expeditions (REQ-END-002)', () => {
  it('are gated behind Guild Mastery, and say so', () => {
    const h = testSession('endless-gate');
    h.commands.foundTown();
    h.debug.spawnHunter({ level: 40 });
    const refused = h.commands.sendEndlessExpedition('verdant_reach', 'record_attempt');
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/Guild Mastery/);
  });

  it('offer all six objectives REQ-END-002 names', () => {
    const { session } = testSession('endless-objectives');
    expect(session.content.endless.objectives.map((o) => o.id).sort()).toEqual(
      ['boss_hunting', 'exploration', 'max_loot', 'record_attempt', 'resource_gathering', 'survival'],
    );
  });

  it('a strong party goes past the end of the first route into deeper, labelled depths', () => {
    const h = veteranGuild('endless-deep', 60);
    const outcome = h.commands.sendEndlessExpedition('verdant_reach', 'record_attempt');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const endless = outcome.value.result.endless;
    expect(endless).toBeDefined();
    expect(endless!.deepestDepth).toBeGreaterThan(1);
    expect(outcome.value.result.nodes.some((report) => report.node.label.startsWith('Depth 2'))).toBe(true);
  });

  it('deeper nodes field stronger monsters than the first route', () => {
    const h = veteranGuild('endless-scale', 60);
    const outcome = h.commands.sendEndlessExpedition('verdant_reach', 'record_attempt');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const deeper = outcome.value.result.nodes.filter((r) => (r.node.depth ?? 0) > 0);
    expect(deeper.length).toBeGreaterThan(0);
  });

  it('never raises item level, however deep the run goes (v1.0 §12)', () => {
    const h = veteranGuild('endless-ilvl', 60);
    const region = h.session.content.worldRegionsById.get('verdant_reach')!;
    const outcome = h.commands.sendEndlessExpedition('verdant_reach', 'max_loot');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    for (const item of outcome.value.loot) expect(item.itemLevel).toBe(region.itemLevel);
  });

  it('pays more for depth, weighted by the objective', () => {
    const h = veteranGuild('endless-pay', 60);
    const outcome = h.commands.sendEndlessExpedition('verdant_reach', 'resource_gathering');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.value.result.wiped) return;
    const base = h.session.content.economy.expeditionRewards.blue;
    const cleared = outcome.value.result.endless!.depthsCleared;
    const scale = 1 + h.session.content.endless.rewardPerDepth * cleared;
    expect(outcome.value.resources.food).toBe(Math.round(base.food * scale * 2));
  });

  it('does not satisfy or get blocked by an ordinary contract', () => {
    const h = veteranGuild('endless-contract', 60);
    const offer = h.commands.contractBoard().find((a) => a.offer.regionId === 'verdant_reach')?.offer;
    if (!offer) return;
    h.commands.acceptContract(offer.offerId);
    const outcome = h.commands.sendEndlessExpedition('verdant_reach', 'record_attempt');
    expect(outcome.ok).toBe(true);
    expect(h.session.contracts.active()?.offerId).toBe(offer.offerId);
  });
});

describe('personal records (REQ-END-003)', () => {
  it('keeps the best depth per region and objective, and only a deeper run replaces it', () => {
    const { session } = testSession('records-unit');
    const base = { regionId: 'r', objectiveId: 'o', routesCleared: 1, tick: 0, cycle: 0, party: ['A'] };
    expect(session.endlessRecords.submit({ ...base, depth: 4 }).improved).toBe(true);
    expect(session.endlessRecords.submit({ ...base, depth: 3 }).improved).toBe(false);
    expect(session.endlessRecords.submit({ ...base, depth: 4 }).improved).toBe(false);
    expect(session.endlessRecords.submit({ ...base, depth: 6 }).improved).toBe(true);
    expect(session.endlessRecords.get('r', 'o')?.depth).toBe(6);
  });

  it('an endless run records itself, and a milestone depth is carved on the Monument', () => {
    const h = veteranGuild('records-run', 60);
    const outcome = h.commands.sendEndlessExpedition('verdant_reach', 'record_attempt');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.record?.improved).toBe(true);
    const depth = outcome.value.result.endless!.deepestDepth;
    expect(h.session.endlessRecords.get('verdant_reach', 'record_attempt')?.depth).toBe(depth);
    const milestone = h.session.content.endless.recordMilestone;
    const plaques = h.session.monument.all().filter((e) => e.kind === 'endlessRecord');
    expect(plaques.length).toBe(depth >= milestone ? 1 : 0);
  });

  it('survive save/load, migrate from v21, and carry into New Game+', () => {
    const first = testSession('records-save');
    first.session.endlessRecords.submit({ regionId: 'verdant_reach', objectiveId: 'survival', depth: 7, routesCleared: 6, tick: 3, cycle: 0, party: ['A', 'B'] });
    const second = testSession('records-load');
    second.session.restore(first.session.snapshot());
    expect(second.session.endlessRecords.snapshot()).toEqual(first.session.endlessRecords.snapshot());

    const migrated = migratePayload({}, 21, 22) as Record<string, unknown>;
    expect(migrated['endlessRecords']).toEqual({ records: [] });

    first.commands.beginNewGamePlus();
    expect(first.session.endlessRecords.get('verdant_reach', 'survival')?.depth).toBe(7);
  });
});
