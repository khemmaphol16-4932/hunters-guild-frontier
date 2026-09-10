import { describe, expect, it } from 'vitest';
import { itemQuality } from '../src/core/items/Item.js';
import { testSession } from './helpers.js';

describe('crafting (REQ-ECO-004)', () => {
  it('previews recipe, cost, time and outcome range before committing', () => {
    const { commands, debug } = testSession('craft-preview');
    const hunter = debug.spawnHunter({ level: 20 });
    const preview = commands.craftingPreview('forge_blade', hunter.id);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.recipe.cost['gold']).toBeGreaterThan(0);
    expect(preview.value.durationSteps).toBeGreaterThan(0);
    expect(preview.value.qualityFloor).toBeLessThan(preview.value.qualityCeiling);
  });

  it('produces the targeted type and charges every input atomically', () => {
    const { session, commands, debug } = testSession('craft-target');
    const hunter = debug.spawnHunter({ level: 30 });
    session.resources.transact({ credits: { salvage: 10 } });
    const before = session.resources.snapshot().balances;
    const result = commands.craftItem('forge_blade', hunter.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.item.typeId).toBe('blade');
    expect(session.armoury.get(result.value.item.id)).toBeUndefined();
    expect(session.roster.require(hunter.id).availability.state).toBe('assigned');
    commands.advanceTown(20);
    expect(session.armoury.get(result.value.item.id)).toBeDefined();
    expect(session.roster.require(hunter.id).availability.state).toBe('available');
    expect(session.resources.amount('gold')).toBe(before['gold']! - 140);
    expect(session.resources.amount('iron')).toBe(before['iron']! - 5);
    expect(session.resources.amount('salvage')).toBe(before['salvage']! - 2);
  });

  it('does not spend partial inputs or create an item when one input is short', () => {
    const { session, commands, debug } = testSession('craft-poor');
    const hunter = debug.spawnHunter({ level: 30 });
    const before = session.resources.snapshot();
    const items = session.armoury.all().length;
    expect(commands.craftItem('forge_blade', hunter.id).ok).toBe(false);
    expect(session.resources.snapshot()).toEqual(before);
    expect(session.armoury.all()).toHaveLength(items);
  });

  it('turns crafter capability into a real quality floor while loot can still exceed it', () => {
    const { session, commands, debug } = testSession('craft-quality');
    const hunter = debug.spawnHunter({ level: 80 });
    session.resources.transact({ credits: { salvage: 10 } });
    const preview = commands.craftingPreview('forge_blade', hunter.id);
    const result = commands.craftItem('forge_blade', hunter.id);
    expect(preview.ok && result.ok).toBe(true);
    if (!preview.ok || !result.ok) return;
    expect(itemQuality(result.value.item)).toBeGreaterThanOrEqual(preview.value.qualityFloor);
    expect(session.content.crafting.recipes.some((recipe) => recipe.rarity === 'legendary')).toBe(false);
  });

  it('round-trips an unfinished order and completes it only after its saved deadline', () => {
    const first = testSession('craft-save');
    const hunter = first.debug.spawnHunter({ level: 30 });
    first.session.resources.transact({ credits: { salvage: 10 } });
    const started = first.commands.craftItem('forge_blade', hunter.id);
    expect(started.ok).toBe(true);
    const second = testSession('craft-load');
    second.session.restore(first.session.snapshot());
    expect(second.session.crafting.active()).toHaveLength(1);
    expect(second.session.armoury.all()).toHaveLength(0);
    second.commands.advanceTown(20);
    expect(second.session.crafting.active()).toHaveLength(0);
    expect(second.session.armoury.all()).toHaveLength(1);
  });
});
