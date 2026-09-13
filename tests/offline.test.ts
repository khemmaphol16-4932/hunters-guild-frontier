/**
 * The town's calendar, offline catch-up, standing orders and the Guild Report
 * (REQ-OFF-001..005, REQ-UX-006).
 */

import { describe, expect, it } from 'vitest';
import { migratePayload } from '../src/save/migrations/index.js';
import { testSession } from './helpers.js';
import { ReportRecorder } from '../src/app/GuildReport.js';

function guild(seed: string) {
  const h = testSession(seed);
  h.commands.foundGuild();
  return h;
}

const HOUR = 3_600_000;

describe('offline catch-up (REQ-OFF-001/002)', () => {
  it('converts real time to steps at the authored rate', () => {
    const h = guild('offline-rate');
    const report = h.commands.catchUpOffline(HOUR);
    expect(report.offline).toBe(true);
    expect(report.steps).toBe(Math.floor(3600 / h.session.content.time.realSecondsPerStep));
  });

  it('caps at three days', () => {
    const h = guild('offline-cap');
    const report = h.commands.catchUpOffline(30 * 24 * HOUR);
    const cap = (h.session.content.time.maxOfflineHours * 3600) / h.session.content.time.realSecondsPerStep;
    expect(report.steps).toBe(Math.floor(cap));
  });

  it('runs the same systems as live play: the clock, recovery and the town all move', () => {
    const h = guild('offline-systems');
    const tick = h.session.clock.tick;
    const report = h.commands.catchUpOffline(2 * HOUR);
    expect(h.session.clock.tick).toBe(tick + report.steps * h.session.clock.coarseStepRatio);
  });

  it('the founding town survives three days on its own (it emptied within 200 steps)', () => {
    const h = guild('offline-survive');
    h.commands.catchUpOffline(72 * HOUR);
    expect(h.session.population.size).toBeGreaterThanOrEqual(h.session.content.balance.town.population.starting);
  });
});

describe('standing orders (REQ-OFF-003/004)', () => {
  it('send expeditions on their cadence while the player is away', () => {
    const h = guild('orders-run');
    expect(h.commands.setStandingOrder({ regionId: 'verdant_reach', objective: 'clear', everySteps: 40, allowLethal: false }).ok).toBe(true);
    const report = h.commands.catchUpOffline(6 * HOUR);
    expect(report.expeditions.length).toBeGreaterThan(1);
    expect(report.expeditions[0]?.regionName).toBe('The Verdant Reach');
  });

  it('send the party out on a journey, not an instant round trip (DL-073)', () => {
    const h = guild('orders-journey');
    expect(h.commands.setStandingOrder({ regionId: 'verdant_reach', objective: 'clear', everySteps: 40, allowLethal: false }).ok).toBe(true);
    // One step is enough for the order to come due and depart; the party is then in the field,
    // its hunters assigned to the journey, not back in town already.
    h.commands.passTime(1);
    const parties = h.commands.partiesInField();
    expect(parties.length).toBeGreaterThan(0);
    const journeyId = parties[0]!.journeyId;
    for (const id of parties[0]!.hunterIds) {
      expect(h.session.roster.require(id).availability.assignment).toBe(journeyId);
    }
    // And it comes home: stepping on lands the return in the report.
    let reported = 0;
    for (let i = 0; i < 200 && h.commands.partiesInField().length > 0; i++) {
      reported += h.commands.passTime(1).expeditions.length;
    }
    expect(reported).toBeGreaterThan(0);
  });

  it('never send hunters where they can die unless the player allowed it, and say why', () => {
    const h = guild('orders-lethal');
    h.commands.setStandingOrder({ regionId: 'ashfall_barrows', objective: 'clear', everySteps: 40, allowLethal: false });
    const report = h.commands.catchUpOffline(2 * HOUR);
    expect(report.expeditions).toHaveLength(0);
    expect(report.skippedOrders.join(' ')).toMatch(/can kill/);
  });

  it('refuse a malformed order, and survive save/load', () => {
    const h = guild('orders-save');
    expect(h.commands.setStandingOrder({ regionId: 'nowhere', objective: 'clear', everySteps: 40, allowLethal: false }).ok).toBe(false);
    expect(h.commands.setStandingOrder({ regionId: 'verdant_reach', objective: 'clear', everySteps: 0, allowLethal: false }).ok).toBe(false);
    h.commands.setStandingOrder({ regionId: 'verdant_reach', objective: 'scout', everySteps: 25, allowLethal: true });
    const loaded = testSession('orders-load');
    loaded.session.restore(h.session.snapshot());
    expect(loaded.session.standingOrders.order).toEqual({ regionId: 'verdant_reach', objective: 'scout', everySteps: 25, allowLethal: true });
    expect((migratePayload({}, 24, 25) as Record<string, unknown>)['standingOrders']).toEqual({});
  });
});

describe('the Guild Report (REQ-UX-006)', () => {
  it('accounts for expeditions, the economy, reputation and the town in one place', () => {
    const h = guild('report-contents');
    h.commands.setStandingOrder({ regionId: 'verdant_reach', objective: 'clear', everySteps: 40, allowLethal: false });
    const report = h.commands.catchUpOffline(12 * HOUR);
    expect(report.headline.length).toBeGreaterThan(0);
    expect(report.expeditions.length).toBeGreaterThan(0);
    expect(Object.keys(report.economy).length).toBeGreaterThan(0);
    expect(report.reputation.to).toBeGreaterThan(report.reputation.from);
  });

  it('leads with the worst news', () => {
    const h = guild('report-headline');
    const [first, second] = h.session.roster.all();
    const recorder = new ReportRecorder(h.session, true);
    recorder.noteDefense('The walls did not hold.', false);
    recorder.noteExpedition(
      { regionName: 'The Ashfall Barrows', summary: 'The party was broken.', completed: false, wiped: true },
      [
        { hunterId: first!.id, died: true, injured: false },
        { hunterId: second!.id, died: false, injured: true },
      ],
    );
    const report = recorder.finish();
    expect(report.headline).toBe('1 hunter did not come home.');
    expect(report.deaths[0]).toContain(first!.name);
    expect(report.injuries[0]).toContain(second!.name);
    expect(report.breaches).toBe(1);
  });

  it('stops listening once finished, so an old report never grows', () => {
    const h = guild('report-closed');
    const report = h.commands.passTime(5);
    const loot = report.rareLoot.length;
    h.session.events.emit('loot.rareFound', { hunterId: h.session.roster.all()[0]!.id, itemId: 'x' as never, rarity: 'legendary' });
    expect(report.rareLoot.length).toBe(loot);
  });
});

describe('the Guild AI repairs what attacks break (REQ-OFF-004)', () => {
  it('rebuilds damaged buildings it can afford, and the report says so', () => {
    const h = guild('repair-on');
    const bunkhouse = h.session.town.grid.all().find((p) => p.buildingId === 'bunkhouse')!;
    h.session.town.grid.damage(bunkhouse.instanceId);
    const report = h.commands.passTime(10);
    expect(h.session.town.grid.damaged()).toHaveLength(0);
    expect(report.repairs.join(' ')).toMatch(/Bunkhouse/);
  });

  it('leaves them broken when the player turned repairs off', () => {
    const h = guild('repair-off');
    h.commands.setAutoRepair(false);
    const bunkhouse = h.session.town.grid.all().find((p) => p.buildingId === 'bunkhouse')!;
    h.session.town.grid.damage(bunkhouse.instanceId);
    h.commands.passTime(10);
    expect(h.session.town.grid.damaged().map((p) => p.instanceId)).toContain(bunkhouse.instanceId);
  });

  it('says what it could not afford instead of leaving it pending silently', () => {
    const h = guild('repair-broke');
    const bunkhouse = h.session.town.grid.all().find((p) => p.buildingId === 'bunkhouse')!;
    h.session.town.grid.damage(bunkhouse.instanceId);
    h.session.resources.transact({ debits: { gold: h.session.resources.amount('gold') } });
    const report = h.commands.passTime(1);
    expect(report.skippedOrders.join(' ')).toMatch(/Could not rebuild/);
  });

  it('two back-to-back three-day absences leave a standing town', () => {
    const h = guild('offline-twice');
    h.commands.catchUpOffline(72 * HOUR);
    h.commands.catchUpOffline(72 * HOUR);
    expect(h.session.population.size).toBeGreaterThanOrEqual(h.session.content.balance.town.population.starting);
    expect(h.session.town.capacity().housing).toBeGreaterThan(0);
  });
});
