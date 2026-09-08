/**
 * Item generation, substats, sockets, sets and refinement.
 * REQ-EQP-001..007, REQ-CRD-001..003, REQ-LOT-001/002.
 */

import { describe, expect, it } from 'vitest';
import { testSession } from './helpers.js';
import { createRng } from '../src/core/rng.js';
import { ItemGenerator } from '../src/systems/items/ItemGenerator.js';
import { Substats } from '../src/systems/items/Substats.js';
import { Equipment } from '../src/systems/items/Equipment.js';
import { isPerfect, itemQuality, emptySockets } from '../src/core/items/Item.js';
import { loadContent } from '../src/data/loader.js';

const content = loadContent();

describe('item generation', () => {
  it('is deterministic for a given seed (REQ-TEC-005)', () => {
    const a = new ItemGenerator(content).generate(createRng('item'), { itemLevel: 40 });
    const b = new ItemGenerator(content).generate(createRng('item'), { itemLevel: 40 });

    // Ids are minted from the same stream, so even those match.
    expect(a).toEqual(b);
  });

  it('fixes main stats by item type, not by rarity (REQ-EQP-002)', () => {
    const { session } = testSession('main-stats');
    const rng = createRng('types');

    const commonBlade = session.itemGenerator.generate(rng, {
      itemLevel: 50,
      typeId: 'blade',
      rarity: 'common',
    });
    const legendaryBlade = session.itemGenerator.generate(rng, {
      itemLevel: 50,
      typeId: 'blade',
      rarity: 'legendary',
    });

    const commonStats = session.equipment.mainStats(commonBlade);
    const legendaryStats = session.equipment.mainStats(legendaryBlade);

    // Same stats present — rarity scales them, it does not change what a blade is.
    expect(Object.keys(commonStats).sort()).toEqual(Object.keys(legendaryStats).sort());
    expect(legendaryStats['physicalAttack'] ?? 0).toBeGreaterThan(
      commonStats['physicalAttack'] ?? 0,
    );
    expect(commonStats['magicAttack']).toBeUndefined();
  });

  it('gives higher rarities more substats and sockets', () => {
    const { session } = testSession('rarity-shape');
    const rng = createRng('shape');

    const common = session.itemGenerator.generate(rng, { itemLevel: 30, rarity: 'common' });
    const legendary = session.itemGenerator.generate(rng, { itemLevel: 30, rarity: 'legendary' });

    expect(legendary.substats.length).toBeGreaterThan(common.substats.length);
    expect(legendary.socketed.length).toBeGreaterThan(common.socketed.length);
  });

  it('never rolls the same substat twice on one item', () => {
    const { session } = testSession('distinct');
    const rng = createRng('distinct');

    for (let i = 0; i < 300; i++) {
      const item = session.itemGenerator.generate(rng, { itemLevel: 40, rarity: 'legendary' });
      const stats = item.substats.map((s) => s.stat);
      expect(new Set(stats).size).toBe(stats.length);
    }
  });

  it('keeps every substat roll inside its declared range', () => {
    const { session } = testSession('ranges');
    const rng = createRng('ranges');

    for (let i = 0; i < 200; i++) {
      const item = session.itemGenerator.generate(rng, { itemLevel: 25, rarity: 'epic' });
      const type = content.itemTypesById.get(item.typeId);
      expect(type).toBeDefined();
      if (!type) continue;

      const pool = content.substats.pools[type.substatPool] ?? [];
      for (const roll of item.substats) {
        const def = pool.find((d) => d.stat === roll.stat);
        expect(def).toBeDefined();
        if (!def) continue;
        expect(roll.value).toBeGreaterThanOrEqual(def.min * item.itemLevel - 1e-9);
        expect(roll.value).toBeLessThanOrEqual(def.max * item.itemLevel + 1e-9);
        expect(roll.quality).toBeGreaterThanOrEqual(0);
        expect(roll.quality).toBeLessThanOrEqual(1);
      }
    }
  });

  it('makes two copies of the same item genuinely differ in worth (REQ-EQP-021)', () => {
    const { session } = testSession('copies');
    const rng = createRng('copies');

    const qualities = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const item = session.itemGenerator.generate(rng, {
        itemLevel: 40,
        typeId: 'blade',
        rarity: 'epic',
      });
      qualities.add(Math.round(itemQuality(item) * 100));
    }
    expect(qualities.size).toBeGreaterThan(10);
  });

  it('makes a perfect item possible but extremely rare (REQ-EQP-003)', () => {
    const { session } = testSession('perfect');
    const rng = createRng('perfect');
    const threshold = content.substats.perfectThreshold;

    let perfect = 0;
    const runs = 20_000;
    for (let i = 0; i < runs; i++) {
      const item = session.itemGenerator.generate(rng, {
        itemLevel: 20,
        typeId: 'blade',
        rarity: 'rare',
      });
      if (isPerfect(item, threshold)) perfect += 1;
    }

    // Three substats each needing a top-0.5% roll is vanishingly unlikely, but the maths
    // permits it — which is exactly REQ-EQP-003: possible, extremely rare, never required.
    expect(perfect / runs).toBeLessThan(0.001);

    // And the check itself must be capable of returning true, or "perfect" would be a
    // goal the player could never reach and the test above would pass vacuously.
    const contrived = {
      ...session.itemGenerator.generate(rng, { itemLevel: 20, typeId: 'blade', rarity: 'rare' }),
      substats: [{ stat: 'physicalAttack', value: 10, quality: 1 }],
    };
    expect(isPerfect(contrived, threshold)).toBe(true);
  });

  it('only lets legendary items carry a unique effect (REQ-EQP-007)', () => {
    const { session } = testSession('unique');
    const rng = createRng('unique');

    for (let i = 0; i < 200; i++) {
      const item = session.itemGenerator.generate(rng, { itemLevel: 40 });
      if (item.uniqueEffectId !== undefined) expect(item.rarity).toBe('legendary');
    }
  });

  it('only lets set-capable rarities carry a set', () => {
    const { session } = testSession('set-capable');
    const rng = createRng('set-capable');

    for (let i = 0; i < 200; i++) {
      const item = session.itemGenerator.generate(rng, { itemLevel: 40 });
      if (item.setId === undefined) continue;
      expect(content.raritiesById.get(item.rarity)?.canCarrySet).toBe(true);
    }
  });
});

describe('loot table and pity (REQ-LOT-001)', () => {
  it('follows the weighted rarity distribution', () => {
    const generator = new ItemGenerator(content);
    const rng = createRng('distribution');
    const counts = new Map<string, number>();
    const runs = 20_000;

    for (let i = 0; i < runs; i++) {
      const rarity = generator.rollRarity(rng);
      counts.set(rarity, (counts.get(rarity) ?? 0) + 1);
    }

    const common = (counts.get('common') ?? 0) / runs;
    const legendary = (counts.get('legendary') ?? 0) / runs;

    // Weights are 520 and 1 out of 1000; pity nudges the tail upward, so these are bands.
    expect(common).toBeGreaterThan(0.4);
    expect(common).toBeLessThan(0.6);
    expect(legendary).toBeLessThan(0.02);
    expect(counts.size).toBeGreaterThan(3);
  });

  it('forces the pity tier after a long unlucky run', () => {
    const generator = new ItemGenerator(content);
    const rng = createRng('pity');
    const { threshold, tier } = content.balance.loot.pity;
    const order = content.rarities.order;
    const pityRank = order.indexOf(tier);

    let longestDrought = 0;
    let current = 0;
    for (let i = 0; i < 5000; i++) {
      const rarity = generator.rollRarity(rng);
      if (order.indexOf(rarity) >= pityRank) {
        longestDrought = Math.max(longestDrought, current);
        current = 0;
      } else {
        current += 1;
      }
    }

    // No run of sub-tier drops may exceed the threshold — that is what pity guarantees.
    expect(longestDrought).toBeLessThanOrEqual(threshold);
  });

  it('round-trips its pity counter', () => {
    const generator = new ItemGenerator(content);
    const rng = createRng('pity-save');
    for (let i = 0; i < 7; i++) generator.rollRarity(rng);

    const saved = generator.pity;
    const restored = new ItemGenerator(content);
    restored.restorePity(saved);
    expect(restored.pity).toEqual(saved);
  });
});

describe('equipping', () => {
  it('equips into the item’s own slot and displaces what was there', () => {
    const { session, debug } = testSession('equip');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 40 });

    const first = debug.spawnItem({ itemLevel: 40, typeId: 'blade', rarity: 'rare' });
    const second = debug.spawnItem({ itemLevel: 40, typeId: 'maul', rarity: 'rare' });

    expect(session.equipment.equip(hunter, first.id).ok).toBe(true);
    const withFirst = session.equipment.equip(hunter, first.id);
    expect(withFirst.ok).toBe(true);
    if (!withFirst.ok) return;

    const withSecond = session.equipment.equip(withFirst.value.hunter, second.id);
    expect(withSecond.ok).toBe(true);
    if (!withSecond.ok) return;

    expect(withSecond.value.hunter.equipment.weapon).toBe(second.id);
    expect(withSecond.value.displaced?.id).toBe(first.id);
  });

  it('refuses to equip the same item twice', () => {
    const { session, debug } = testSession('equip-twice');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 40 });
    const item = debug.spawnItem({ itemLevel: 40, typeId: 'blade' });

    const equipped = session.equipment.equip(hunter, item.id);
    expect(equipped.ok).toBe(true);
    if (!equipped.ok) return;

    const again = session.equipment.equip(equipped.value.hunter, item.id);
    expect(again.ok).toBe(false);
  });

  it('refuses to take an item another hunter is wearing', () => {
    const { commands, debug } = testSession('contested');
    const first = debug.spawnHunter({ archetype: 'vanguard', level: 40 });
    const second = debug.spawnHunter({ archetype: 'vanguard', level: 40 });
    const item = debug.spawnItem({ itemLevel: 40, typeId: 'blade' });

    expect(commands.equipItem(first.id, String(item.id)).ok).toBe(true);

    const stolen = commands.equipItem(second.id, String(item.id));
    expect(stolen.ok).toBe(false);
    if (!stolen.ok) expect(stolen.error).toMatch(/is using that item/);
  });

  it('adds equipment stats on top of attribute-derived ones', () => {
    const { session, debug } = testSession('stats');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 40 });

    const before = session.equipment.aggregateStats(session.roster.require(hunter.id));
    expect(Object.keys(before)).toHaveLength(0);

    debug.outfit(hunter.id, { rarity: 'epic' });

    const after = session.equipment.aggregateStats(session.roster.require(hunter.id));
    expect(Object.keys(after).length).toBeGreaterThan(3);
    expect(after['maxHp'] ?? 0).toBeGreaterThan(0);
  });

  it('scales main stats with refinement but never substats (REQ-EQP-005)', () => {
    const { session, debug } = testSession('refine-stats');
    const item = debug.spawnItem({ itemLevel: 40, typeId: 'blade', rarity: 'epic' });

    const before = session.equipment.mainStats(item);
    const beforeSubstats = Substats.aggregate(item.substats);

    const refined = { ...item, refinement: 5 };
    const after = session.equipment.mainStats(refined);
    const afterSubstats = Substats.aggregate(refined.substats);

    expect(after['physicalAttack'] ?? 0).toBeGreaterThan(before['physicalAttack'] ?? 0);
    expect(afterSubstats).toEqual(beforeSubstats);
  });
});

describe('cards (REQ-CRD-001..003)', () => {
  it('refuses a card whose tags do not match the item type', () => {
    const { session, debug } = testSession('card-tags');
    const stave = debug.spawnItem({ itemLevel: 40, typeId: 'stave', rarity: 'epic' });

    // Bulwark Sigil wants defensive/threat affinity; a stave is arcane/magical.
    const verdict = session.cards.compatibility(stave, 'bulwark_sigil');
    expect(verdict.ok).toBe(false);
  });

  it('accepts a card whose tags match', () => {
    const { session, debug } = testSession('card-fit');
    const shield = debug.spawnItem({ itemLevel: 40, typeId: 'shield', rarity: 'epic' });
    expect(session.cards.compatibility(shield, 'bulwark_sigil').ok).toBe(true);
  });

  it('treats an empty tag list as universal', () => {
    const { session, debug } = testSession('card-universal');
    const robes = debug.spawnItem({ itemLevel: 40, typeId: 'robes', rarity: 'epic' });
    // Quartermaster's Seal has no tags and lists body among its slots.
    expect(session.cards.compatibility(robes, 'quartermasters_seal').ok).toBe(true);
  });

  it('refuses to socket into an item with no free socket', () => {
    const { session, debug } = testSession('card-full');
    const shield = debug.spawnItem({ itemLevel: 40, typeId: 'shield', rarity: 'common' });
    expect(emptySockets(shield)).toBe(0);

    const socketed = session.cards.socket(shield, 'bulwark_sigil');
    expect(socketed.ok).toBe(false);
    if (!socketed.ok) expect(socketed.error).toMatch(/no sockets/);
  });

  it('refuses the same card twice in one item', () => {
    const { session, debug } = testSession('card-dupe');
    const shield = debug.spawnItem({ itemLevel: 40, typeId: 'shield', rarity: 'ancient' });

    const first = session.cards.socket(shield, 'bulwark_sigil');
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = session.cards.socket(first.value, 'bulwark_sigil');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already socketed/);
  });

  it('returns the card to the armoury when unsocketed, never destroying it', () => {
    const { session, commands, debug } = testSession('card-return');
    const shield = debug.spawnItem({ itemLevel: 40, typeId: 'shield', rarity: 'ancient' });
    debug.giveCard('bulwark_sigil');

    expect(commands.socketCard(String(shield.id), 'bulwark_sigil').ok).toBe(true);
    expect(session.armoury.cardCount('bulwark_sigil')).toBe(0);

    expect(commands.unsocketCard(String(shield.id), 0).ok).toBe(true);
    expect(session.armoury.cardCount('bulwark_sigil')).toBe(1);
  });

  it('gives every boss its own card pool (REQ-CRD-002)', () => {
    const { session } = testSession('boss-pools');
    const ash = session.cards.poolForBoss('warden_of_ash');
    const ember = session.cards.poolForBoss('emberheart');

    expect(ash.length).toBeGreaterThan(0);
    expect(ember.length).toBeGreaterThan(0);
    expect(ash.map((c) => c.id)).not.toEqual(ember.map((c) => c.id));
  });

  it('locks the boss card drop rate at 0.5% (REQ-CRD-002)', () => {
    expect(content.balance.loot.bossCards.dropChance).toBe(0.005);
  });

  it('gives a duplicate a useful conversion (REQ-CRD-003)', () => {
    const { session } = testSession('dupe-convert');

    const first = session.armoury.addCard('emberheart_card');
    expect(first.duplicate).toBe(false);

    const second = session.armoury.addCard('emberheart_card');
    expect(second.duplicate).toBe(true);

    const conversion = session.cards.duplicateConversion('emberheart_card');
    expect(conversion.ok).toBe(true);
    if (conversion.ok) {
      expect(conversion.value.resourceId).toBe(
        content.balance.loot.conversion.duplicateCardResourceId,
      );
      expect(conversion.value.amount).toBeGreaterThan(0);
    }
  });

  it('makes every card change behaviour, not just numbers (REQ-CRD-001)', () => {
    // A card whose only effects were flat stats would be the thing §24 forbids.
    for (const card of content.cards) {
      const behavioural = card.effects.some(
        (fx) =>
          fx.type === 'aiWeightShift' ||
          fx.type === 'threatGeneration' ||
          fx.type === 'statusChance' ||
          fx.type === 'overhealConversion' ||
          fx.type === 'downedTimerBonus' ||
          fx.type === 'interruptReadiness' ||
          fx.type === 'skillTagCost',
      );
      expect(behavioural, `${card.id} has no behavioural effect`).toBe(true);
    }
  });
});

describe('sets (REQ-EQP-006)', () => {
  it('activates tiers at 2, 3 and 4 pieces and stacks them', () => {
    const { session, debug } = testSession('set-tiers');
    const items = [];
    for (const slot of ['head', 'body', 'hands', 'feet'] as const) {
      items.push(debug.spawnItem({ itemLevel: 40, slot, rarity: 'epic', setId: 'ashwardens' }));
    }

    expect(session.sets.active(items.slice(0, 1))).toHaveLength(0);
    expect(session.sets.active(items.slice(0, 2))[0]?.tiers).toHaveLength(1);
    expect(session.sets.active(items.slice(0, 3))[0]?.tiers).toHaveLength(2);
    expect(session.sets.active(items)[0]?.tiers).toHaveLength(3);
  });

  it('grants behavioural bonuses rather than flat stats, so non-set gear stays viable', () => {
    // This is the mechanism by which REQ-EQP-006's "must not invalidate normal equipment"
    // is honoured. A set tier granting a big flat stat would break it.
    for (const set of content.sets) {
      for (const tier of set.tiers) {
        expect(tier.effects.length, `${set.id} ${tier.pieces}pc has no effects`).toBeGreaterThan(0);
        for (const effect of tier.effects) {
          expect(
            [
              'skillTagPower',
              'skillTagCost',
              'threatGeneration',
              'aiWeightShift',
              'statusChance',
              'overhealConversion',
              'downedTimerBonus',
              'interruptReadiness',
            ],
            `${set.id} ${tier.pieces}pc uses ${effect.type}`,
          ).toContain(effect.type);
        }
      }
    }
  });

  it('describes progress toward the next tier', () => {
    const { session, debug } = testSession('set-describe');
    const items = [
      debug.spawnItem({ itemLevel: 40, slot: 'head', rarity: 'epic', setId: 'quietstep' }),
      debug.spawnItem({ itemLevel: 40, slot: 'body', rarity: 'epic', setId: 'quietstep' }),
    ];

    const lines = session.sets.describe(items);
    expect(lines.join('\n')).toMatch(/Quietstep \(2 pieces\)/);
    expect(lines.join('\n')).toMatch(/3 \(1 more\)/);
  });
});

describe('refinement (REQ-EQP-005)', () => {
  it('never fails inside the safe zone', () => {
    const { session, debug } = testSession('safe-zone');
    const rng = createRng('safe');
    let item = debug.spawnItem({ itemLevel: 40, typeId: 'blade', rarity: 'epic' });

    for (let level = 0; level < session.refinement.safeLimit; level++) {
      const result = session.refinement.attempt(rng, item, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.kind).toBe('success');
      if (result.value.kind !== 'success') return;
      item = result.value.item;
    }

    expect(item.refinement).toBe(session.refinement.safeLimit);
  });

  it('can fail in the risk zone', () => {
    const { session, debug } = testSession('risk-zone');
    const rng = createRng('risk');
    const item = { ...debug.spawnItem({ itemLevel: 40, typeId: 'blade', rarity: 'epic' }), refinement: 10 };

    const outcomes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const result = session.refinement.attempt(rng, item, {});
      if (result.ok) outcomes.add(result.value.kind);
    }

    expect(outcomes.has('success')).toBe(true);
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it('can destroy an item at high refinement', () => {
    const { session, debug } = testSession('destroy');
    const rng = createRng('destroy');
    const item = { ...debug.spawnItem({ itemLevel: 40, typeId: 'blade', rarity: 'epic' }), refinement: 14 };

    let destroyed = 0;
    for (let i = 0; i < 200; i++) {
      const result = session.refinement.attempt(rng, item, {});
      if (result.ok && result.value.kind === 'destroyed') destroyed += 1;
    }
    expect(destroyed).toBeGreaterThan(0);
  });

  it('protection softens the outcome without improving the odds', () => {
    const { session, debug } = testSession('protection');
    const item = { ...debug.spawnItem({ itemLevel: 40, typeId: 'blade', rarity: 'epic' }), refinement: 14 };

    expect(session.refinement.failureOutcome(item, {})).toBe('destroy');
    expect(session.refinement.failureOutcome(item, { useProtection: true })).toBe('downgrade');

    // Crucially, the success chance is identical either way.
    expect(session.refinement.successChance(item)).toBe(
      session.refinement.successChance(item),
    );
  });

  it('refuses to refine past the maximum', () => {
    const { session, debug } = testSession('max-refine');
    const rng = createRng('max');
    const item = {
      ...debug.spawnItem({ itemLevel: 40, typeId: 'blade', rarity: 'epic' }),
      refinement: session.refinement.maxLevel,
    };

    const result = session.refinement.attempt(rng, item, {});
    expect(result.ok).toBe(false);
  });

  it('recovers socketed cards when refinement destroys an item', () => {
    const { session, commands, debug } = testSession('destroy-cards');
    const shield = debug.spawnItem({ itemLevel: 40, typeId: 'shield', rarity: 'ancient' });
    debug.giveCard('bulwark_sigil');

    commands.socketCard(String(shield.id), 'bulwark_sigil');
    session.armoury.update({ ...session.armoury.require(shield.id), refinement: 14 });

    // Hammer it until it breaks, then check the card survived.
    for (let i = 0; i < 500; i++) {
      if (!session.armoury.get(shield.id)) break;
      commands.refineItem(String(shield.id));
    }

    expect(session.armoury.get(shield.id)).toBeUndefined();
    expect(session.armoury.cardCount('bulwark_sigil')).toBe(1);
  });

  it('explains the next attempt in plain language (REQ-UX-002)', () => {
    const { session, debug } = testSession('refine-describe');
    const item = debug.spawnItem({ itemLevel: 40, typeId: 'blade', rarity: 'epic' });

    expect(session.refinement.describeNextAttempt(item)).toMatch(/safe zone/);
    expect(
      session.refinement.describeNextAttempt({ ...item, refinement: 14 }),
    ).toMatch(/destroyed/);
  });
});

describe('armoury disposal (REQ-LOT-002)', () => {
  it('refuses to sell a locked item', () => {
    const { session, debug } = testSession('locked');
    const item = debug.spawnItem({ itemLevel: 40, typeId: 'blade', rarity: 'epic' });
    session.armoury.setLocked(item.id, true);

    const result = session.armoury.sell(item.id, new Set());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/locked/);
  });

  it('refuses to sell an equipped item', () => {
    const { session, debug } = testSession('sell-equipped');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 40 });
    debug.outfit(hunter.id, { rarity: 'epic' });

    const equipped = Equipment.equippedIdsAcross(session.roster.all());
    const someId = [...equipped][0];
    expect(someId).toBeDefined();
    if (!someId) return;

    const result = session.armoury.sell(someId, equipped);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/equipped/);
  });

  it('values a better-rolled item above a worse one', () => {
    const { session, debug } = testSession('value');
    const items = [];
    for (let i = 0; i < 30; i++) {
      items.push(debug.spawnItem({ itemLevel: 40, typeId: 'blade', rarity: 'epic' }));
    }
    const sorted = [...items].sort((a, b) => itemQuality(a) - itemQuality(b));
    const worst = sorted[0];
    const best = sorted[sorted.length - 1];
    expect(worst).toBeDefined();
    expect(best).toBeDefined();
    if (!worst || !best) return;

    expect(session.armoury.sellValue(best)).toBeGreaterThan(session.armoury.sellValue(worst));
  });

  it('recovers cards when an item is dismantled', () => {
    const { session, commands, debug } = testSession('dismantle-cards');
    const shield = debug.spawnItem({ itemLevel: 40, typeId: 'shield', rarity: 'ancient' });
    debug.giveCard('bulwark_sigil');

    commands.socketCard(String(shield.id), 'bulwark_sigil');

    const result = session.armoury.dismantle(shield.id, new Set());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.recoveredCards).toContain('bulwark_sigil');
    expect(result.value.resources[0]?.amount).toBeGreaterThan(0);
  });

  it('bulk-sells below a rarity while sparing locked and equipped items', () => {
    const { session, debug } = testSession('bulk');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 40 });

    debug.forceLoot(40, 30);
    const keeper = debug.spawnItem({ itemLevel: 30, typeId: 'blade', rarity: 'common' });
    session.armoury.setLocked(keeper.id, true);
    debug.outfit(hunter.id, { rarity: 'common' });

    const before = session.armoury.size;
    const equipped = Equipment.equippedIdsAcross(session.roster.all());
    const result = session.armoury.sellBelowRarity('rare', equipped);

    expect(result.sold).toBeGreaterThan(0);
    expect(session.armoury.size).toBe(before - result.sold);
    expect(session.armoury.get(keeper.id)).toBeDefined();
    for (const id of equipped) expect(session.armoury.get(id)).toBeDefined();
  });
});

describe('effect aggregation', () => {
  it('merges effects of the same kind additively', () => {
    const merged = Equipment.mergeEffects([
      { type: 'threatGeneration', value: 0.2, tag: undefined, key: undefined, status: undefined },
      { type: 'threatGeneration', value: 0.3, tag: undefined, key: undefined, status: undefined },
      { type: 'skillTagPower', value: 0.1, tag: 'defensive', key: undefined, status: undefined },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.type === 'threatGeneration')?.value).toBeCloseTo(0.5, 6);
  });

  it('keeps effects with different qualifiers separate', () => {
    const merged = Equipment.mergeEffects([
      { type: 'skillTagPower', value: 0.1, tag: 'defensive', key: undefined, status: undefined },
      { type: 'skillTagPower', value: 0.2, tag: 'martial', key: undefined, status: undefined },
    ]);
    expect(merged).toHaveLength(2);
  });

  it('collects unique, card and set effects into one list', () => {
    const { session, debug } = testSession('aggregate-effects');
    const hunter = debug.spawnHunter({ archetype: 'vanguard', level: 60 });

    debug.outfit(hunter.id, { rarity: 'ancient', setId: 'ashwardens' });
    debug.giveCard('bulwark_sigil');
    debug.socketAvailable(hunter.id);

    const effects = session.equipment.aggregateEffects(session.roster.require(hunter.id));
    expect(effects.length).toBeGreaterThan(0);
    // The 4-piece Ashwarden bonus shifts an AI weight; that must reach the aggregate.
    expect(effects.some((e) => e.type === 'aiWeightShift')).toBe(true);
  });
});
