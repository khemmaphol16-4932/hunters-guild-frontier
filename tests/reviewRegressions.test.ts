/**
 * Regression tests for the Phase 7–8 review (DL-044 … DL-048).
 *
 * Every test here reproduces a bug that the full suite passed over when it shipped. They are
 * kept together, rather than spread across each system's file, because they share one
 * lesson: each bug was invisible to tests that checked the happy path at the scale the
 * author imagined (one unit, one contract, one cycle, a fresh save). Each test below goes to
 * the scale or the history where the bug actually lived.
 */

import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/data/loader.js';
import { parseEconomy } from '../src/data/economySchema.js';
import { parseProgression } from '../src/data/progressionSchema.js';
import { ContentValidationError } from '../src/data/schema.js';
import { Market } from '../src/systems/economy/Market.js';
import { Resources } from '../src/systems/economy/Resources.js';
import { migratePayload } from '../src/save/migrations/index.js';
import { CURRENT_SAVE_VERSION } from '../src/save/envelope.js';
import resourcesJson from '../src/data/economy/resources.json';
import progressionJson from '../src/data/balance/progression.json';
import { testSession, workshopSession } from './helpers.js';

const content = loadContent();

function market() {
  const resources = new Resources(content.economy.resources);
  return { resources, market: new Market(content.economy.market, resources) };
}

describe('DL-046 — the market cannot be pumped for gold', () => {
  it('a large buy-and-sell-back round trip loses gold (it earned +300 per cycle)', () => {
    const h = market();
    h.resources.transact({ credits: { gold: 100_000 } });
    h.market.sell('materials', 70); // the original exploit first dumped the price to its floor
    for (let i = 0; i < 20; i++) {
      const before = h.resources.amount('gold');
      expect(h.market.buy('materials', 150).ok).toBe(true);
      expect(h.market.sell('materials', 150).ok).toBe(true);
      expect(h.resources.amount('gold')).toBeLessThan(before);
    }
  });

  it('prices every unit where the price is when it trades', () => {
    const one = market();
    const many = market();
    const single = one.market.quote('iron', 1, 'buy');
    const bulk = many.market.quote('iron', 40, 'buy');
    expect(single.ok && bulk.ok).toBe(true);
    if (!single.ok || !bulk.ok) return;
    // A bulk order pays more per unit than a single unit does, because it moves the price.
    expect(bulk.value.unitPrice).toBeGreaterThan(single.value.unitPrice - 1);
    expect(bulk.value.total).toBeGreaterThan(single.value.total * 40 - 40);
    many.market.buy('iron', 40);
    expect(many.market.scaleOf('iron')).toBeGreaterThan(one.market.scaleOf('iron'));
  });

  it('the long-run balance gate now finds no profitable round trip at any size or price', async () => {
    const { runEconomyBalance } = await import('../src/sim/Balance.js');
    const report = runEconomyBalance(content, 2000);
    expect(report.violations).toEqual([]);
    expect(report.bestRoundTripProfit).toBeLessThanOrEqual(0);
  });

  it('refuses a market config whose spread is too thin to cover one unit of impact', () => {
    const thin = structuredClone(resourcesJson) as { market: { buyMarkup: number; sellMarkdown: number } };
    thin.market.buyMarkup = 1.0;
    thin.market.sellMarkdown = 0.999;
    expect(() => parseEconomy(thin)).toThrow(/would earn gold/);
  });

  it('refuses a traded good that is not a resource', () => {
    const bad = structuredClone(resourcesJson) as { market: { goods: Record<string, unknown> } };
    bad.market.goods['moonbeams'] = { basePrice: 5, startingStock: 5 };
    expect(() => parseEconomy(bad)).toThrow(ContentValidationError);
  });
});

describe('DL-044 — nothing is paid for and lost', () => {
  it('refuses a purchase that cannot be stored and charges nothing (it took 495 gold for 0 salt)', () => {
    const h = market();
    h.resources.transact({ credits: { warding_salt: h.resources.room('warding_salt') } });
    const gold = h.resources.amount('gold');
    const bought = h.market.buy('warding_salt', 5);
    expect(bought.ok).toBe(false);
    expect(h.resources.amount('gold')).toBe(gold);
  });

  it('reports overflowing income instead of dropping it silently', () => {
    const resources = new Resources(content.economy.resources);
    resources.transact({ credits: { food: resources.room('food') - 3 } });
    const receipt = resources.transact({ credits: { food: 10 } });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    expect(receipt.value.discarded['food']).toBe(7);
    expect(resources.amount('food')).toBe(resources.capacity('food'));
  });

  it('judges capacity on the net result of a transaction', () => {
    const resources = new Resources(content.economy.resources);
    resources.transact({ credits: { iron: resources.room('iron') } });
    const swap = resources.transact({ debits: { iron: 5 }, credits: { iron: 5 }, overflow: 'reject' });
    expect(swap.ok).toBe(true);
  });
});

describe('DL-045 — an old save opens with its founding balances', () => {
  it('a Phase 6 (v10) save migrated forward is not left with zero gold and zero food', () => {
    const { session } = testSession('migrate-v10');
    const payload = { ...session.snapshot() } as Record<string, unknown>;
    for (const key of ['resources', 'food', 'crafting', 'market', 'contracts', 'factions', 'guildMastery', 'monument', 'legacy', 'mentors', 'newGamePlus']) {
      delete payload[key];
    }
    const migrated = migratePayload(payload, 10, CURRENT_SAVE_VERSION);
    const loaded = testSession('migrate-v10-load');
    loaded.session.restore(migrated as never);
    for (const resource of content.economy.resources) {
      expect(loaded.session.resources.amount(resource.id)).toBe(resource.starting);
    }
  });

  it('a balance the save does record is kept exactly, including zero', () => {
    const first = testSession('keep-zero');
    first.session.resources.transact({ debits: { food: first.session.resources.amount('food') } });
    const second = testSession('keep-zero-load');
    second.session.restore(first.session.snapshot());
    expect(second.session.resources.amount('food')).toBe(0);
  });
});

describe('DL-047 — Legacy is bounded and every unlock does something', () => {
  it('routine contracts cannot farm Legacy: one plaque per contract, capped per cycle', () => {
    const { session, commands, debug } = testSession('legacy-farm');
    commands.foundTown();
    for (let i = 0; i < 4; i++) debug.spawnHunter({ level: 60, fullyEquipped: true });
    const completions = new Map<string, number>();
    for (let round = 0; round < 20; round++) {
      const offer = commands.contractBoard()[0]?.offer;
      if (!offer) break;
      expect(commands.acceptContract(offer.offerId).ok).toBe(true);
      const outcome = commands.sendExpedition(offer.regionId, offer.objective);
      // A challenge contract this veteran roster cannot meet is refused at dispatch; walk away.
      if (!outcome.ok) commands.abandonContract();
      if (outcome.ok && outcome.value.result.completed && !outcome.value.result.wiped) {
        completions.set(offer.id, (completions.get(offer.id) ?? 0) + 1);
      }
      commands.advanceTown(200);
    }
    const plaques = session.monument.all().filter((entry) => entry.kind === 'historicContract');
    const total = [...completions.values()].reduce((sum, n) => sum + n, 0);
    // The guild completed some contracts more than once...
    expect(total).toBeGreaterThan(completions.size);
    // ...and each went on the Monument once, the first time.
    expect(plaques).toHaveLength(completions.size);
  });

  it('caps a single kind of achievement per cycle', () => {
    const { session, debug } = testSession('legacy-cap');
    const hunter = debug.spawnHunter();
    for (let i = 0; i < 20; i++) {
      session.events.emit('loot.rareFound', { hunterId: hunter.id, itemId: `relic_${i}` as never, rarity: 'legendary' });
    }
    const award = content.progression.legacy.awards.legendaryFind!;
    expect(session.monument.all().filter((e) => e.kind === 'legendaryFind')).toHaveLength(20);
    expect(session.legacy.lifetimePoints).toBe(award.points * award.maxPerCycle);
  });

  it('refuses an unbounded award and an unlock with no effect at load', () => {
    const unbounded = structuredClone(progressionJson) as { legacy: { awards: Record<string, { maxPerCycle: number }> } };
    unbounded.legacy.awards['worldBossVictory']!.maxPerCycle = 0;
    expect(() => parseProgression(unbounded)).toThrow(/farming bug/);

    const orphan = structuredClone(progressionJson) as { legacy: { unlocks: { id: string; category: string }[] } };
    orphan.legacy.unlocks.push({ id: 'nowhere_start', category: 'startingChoice', name: 'Nowhere', cost: 1, description: 'x' } as never);
    expect(() => parseProgression(orphan)).toThrow(/openings/);
  });

  it('Long Winter makes every resident eat more', () => {
    const plain = testSession('winter-off');
    const winter = testSession('winter-on');
    winter.session.events.emit('combat.bossDefeated', { hunterId: winter.debug.spawnHunter().id, bossId: 'warden', worldBoss: true });
    expect(winter.commands.purchaseLegacyUnlock('long_winter').ok).toBe(true);
    expect(winter.commands.beginNewGamePlus({ worldVariant: 'long_winter' }).ok).toBe(true);
    plain.commands.foundGuild();
    const eatenPlain = plain.session.food.step(20, 1, 0).consumed;
    const eatenWinter = winter.session.food.step(20, 1, 0).consumed;
    expect(eatenWinter).toBeCloseTo(eatenPlain * 1.5);
  });

  it('Carved Founders puts the last generation on the new Monument', () => {
    const { session, commands, debug } = testSession('founders');
    const founder = debug.spawnHunter();
    session.events.emit('combat.bossDefeated', { hunterId: founder.id, bossId: 'warden', worldBoss: true });
    expect(commands.purchaseLegacyUnlock('carved_founders').ok).toBe(true);
    expect(commands.beginNewGamePlus().ok).toBe(true);
    const facade = session.monument.all().find((entry) => entry.kind === 'foundersFacade');
    expect(facade?.detail).toContain(founder.name);
  });

  it('Veteran Records is consumed by the recruitment board', () => {
    const { session, commands } = testSession('veteran-records');
    expect(commands.recruitmentHistories().length).toBe(0);
    session.events.emit('town.stageReached', { stageId: 'village', name: 'Village' });
    expect(commands.purchaseLegacyUnlock('veteran_records').ok).toBe(true);
    expect(session.town.grid.place('recruitment_hall', 0, 0, 0).ok).toBe(true);
    expect(commands.refreshRecruits().ok).toBe(true);
    const histories = commands.recruitmentHistories();
    expect(histories.length).toBeGreaterThan(0);
    expect(histories[0]?.lines.length).toBeGreaterThan(0);
  });
});

describe('DL-048 — New Game+ founds a new guild in a new world', () => {
  it('opens with a Guild Hall and a roster (it opened on an empty grid with nobody)', () => {
    const { session, commands } = testSession('ng-founded');
    commands.foundGuild();
    expect(commands.beginNewGamePlus().ok).toBe(true);
    expect(session.town.grid.countOf('guild_hall')).toBe(1);
    expect(session.roster.size).toBeGreaterThan(0);
  });

  it('each cycle is a different world, and the same cycle is always the same world', () => {
    const a = testSession('ng-cycles');
    a.commands.foundGuild();
    a.commands.beginNewGamePlus();
    const cycleOne = a.session.roster.all().map((h) => h.name);
    a.commands.beginNewGamePlus();
    const cycleTwo = a.session.roster.all().map((h) => h.name);
    expect(cycleTwo).not.toEqual(cycleOne);

    const b = testSession('ng-cycles');
    b.commands.foundGuild();
    b.commands.beginNewGamePlus();
    expect(b.session.roster.all().map((h) => h.name)).toEqual(cycleOne);
  });

  it('an unlocked archetype arrives developed, as an extra member of the founding roster', () => {
    const { session, commands, debug } = testSession('ng-exile');
    session.events.emit('combat.bossDefeated', { hunterId: debug.spawnHunter().id, bossId: 'warden', worldBoss: true });
    expect(commands.purchaseLegacyUnlock('frontier_exile').ok).toBe(true);
    expect(commands.beginNewGamePlus({ archetype: 'frontier_exile' }).ok).toBe(true);
    expect(session.roster.size).toBe(5);
    expect(session.roster.all().every((hunter) => hunter.knownSkills.length > 0)).toBe(true);
  });

  it('refuses an unlock offered in the wrong slot', () => {
    const { session, commands, debug } = testSession('ng-slot');
    session.events.emit('combat.bossDefeated', { hunterId: debug.spawnHunter().id, bossId: 'warden', worldBoss: true });
    expect(commands.purchaseLegacyUnlock('prepared_caravan').ok).toBe(true);
    const result = commands.beginNewGamePlus({ worldVariant: 'prepared_caravan' });
    expect(result.ok).toBe(false);
    expect(session.newGamePlus.cycle).toBe(0);
  });

  it('Legacy can be earned again in a new cycle, but not twice in one', () => {
    const { session, commands, debug } = testSession('ng-reearn');
    const boss = () => session.events.emit('combat.bossDefeated', { hunterId: debug.spawnHunter().id, bossId: 'warden', worldBoss: true });
    boss();
    boss();
    const firstCycle = session.legacy.lifetimePoints;
    commands.beginNewGamePlus();
    boss();
    expect(session.legacy.lifetimePoints).toBe(firstCycle * 2);
  });
});

describe('contracts can be abandoned (they could block the board forever)', () => {
  it('abandoning frees the slot and costs standing with the client', () => {
    const { session, commands } = testSession('abandon');
    commands.foundGuild();
    const offer = commands.contractBoard()[0]!.offer;
    expect(commands.acceptContract(offer.offerId).ok).toBe(true);
    expect(commands.abandonContract().ok).toBe(true);
    expect(session.contracts.active()).toBeUndefined();
    expect(session.factions.value(offer.factionId)).toBe(content.contracts.standing.abandon);
    expect(commands.acceptContract(commands.contractBoard()[0]!.offer.offerId).ok).toBe(true);
    expect(commands.abandonContract().ok).toBe(true);
    expect(commands.abandonContract().ok).toBe(false);
  });
});

describe('crafting needs its workshop', () => {
  it('refuses to forge without a smithy and charges nothing', () => {
    const { session, commands, debug } = testSession('no-smithy');
    const hunter = debug.spawnHunter({ level: 30 });
    session.resources.transact({ credits: { salvage: 10 } });
    const before = session.resources.snapshot();
    const result = commands.craftItem('forge_blade', hunter.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/smithy/);
    expect(session.resources.snapshot()).toEqual(before);
  });

  it('forges once the smithy stands', () => {
    const { session, commands, debug } = workshopSession('with-smithy');
    const hunter = debug.spawnHunter({ level: 30 });
    session.resources.transact({ credits: { salvage: 10 } });
    expect(commands.craftItem('forge_blade', hunter.id).ok).toBe(true);
  });
});

describe('mentors', () => {
  it('practice uses both training effects under one cap, never two stacked caps', () => {
    const { session } = testSession('mentor-cap');
    // Two strong mentors, each carrying the most of both training effects a mentor can.
    const strong = (id: string) => ({
      hunterId: id as never, name: id, retiredAtLevel: 99, speciality: 'int',
      experienceScale: 1.2, masteryScale: 1.25, trainingEfficiency: 1.2, legacyTraits: [],
    });
    session.mentors.restore({ mentors: [strong('a'), strong('b'), strong('c')] });
    const cap = content.progression.mentors.practiceCap;
    expect(session.mentors.practiceScale()).toBeLessThanOrEqual(cap);
    expect(session.mentors.masteryScale() * session.mentors.trainingEfficiency()).toBeGreaterThan(cap);
  });

  it('the EXP bonus reaches expedition experience, not only town hunts', () => {
    const plain = testSession('mentor-xp');
    const taught = testSession('mentor-xp');
    for (const h of [plain, taught]) {
      h.commands.foundTown();
      for (let i = 0; i < 4; i++) h.debug.spawnHunter({ level: 5, fullyEquipped: true });
    }
    taught.session.mentors.retire(taught.debug.spawnHunter({ level: 90 }), []);
    // Retiring spawned one more hunter in the taught guild; remove it so both parties match.
    const extra = taught.session.roster.all().at(-1)!;
    taught.session.roster.remove(extra.id);
    const a = plain.commands.sendExpedition('verdant_reach', 'clear');
    const b = taught.commands.sendExpedition('verdant_reach', 'clear');
    expect(a.ok && b.ok).toBe(true);
    const xpOf = (h: typeof plain) => h.session.roster.all().reduce((sum, hunter) => sum + hunter.level * 1e6 + hunter.xp, 0);
    expect(xpOf(taught)).toBeGreaterThan(xpOf(plain));
  });
});

describe('Phase 7 leftovers: prices that were never charged, resources with no source', () => {
  it('respec costs Insight Crystals, and refuses without them', () => {
    const { session, commands, debug } = testSession('respec-cost');
    const hunter = debug.spawnHunter({ level: 30 });
    commands.spendAllOn(hunter.id, 'str');
    const price = commands.respecPrice(hunter.id);
    expect(price.resourceId).toBe('insight_crystal');
    expect(price.amount).toBeGreaterThan(0);
    expect(session.resources.amount('insight_crystal')).toBe(0);
    expect(commands.respec(hunter.id).ok).toBe(false);
    session.resources.transact({ credits: { insight_crystal: price.amount } });
    expect(commands.respec(hunter.id).ok).toBe(true);
    expect(session.resources.amount('insight_crystal')).toBe(0);
  });

  it('Insight Crystals have more than one source', () => {
    const sources = [
      'insight_crystal' in content.economy.market.goods,
      Object.values(content.economy.expeditionRewards).some((reward) => (reward.extras?.['insight_crystal'] ?? 0) > 0),
      content.contracts.templates.some((template) => (template.reward.extras?.['insight_crystal'] ?? 0) > 0),
    ];
    expect(sources.filter(Boolean).length).toBeGreaterThanOrEqual(2);
  });

  it('merchants restock a good the guild bought out', () => {
    const h = market();
    h.resources.transact({ credits: { gold: 100_000 } });
    const stock = h.market.stockOf('insight_crystal');
    expect(h.market.buy('insight_crystal', stock).ok).toBe(true);
    expect(h.market.stockOf('insight_crystal')).toBe(0);
    h.market.step(200);
    expect(h.market.stockOf('insight_crystal')).toBeGreaterThan(0);
  });

  it('the duplicate-card conversion names a resource that exists', () => {
    expect(content.resourcesById.has(content.balance.loot.conversion.duplicateCardResourceId)).toBe(true);
  });
});
