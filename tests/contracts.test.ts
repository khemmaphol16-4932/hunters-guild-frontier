import { describe, expect, it } from 'vitest';
import { testSession } from './helpers.js';

function guild() {
  const h = testSession('contracts');
  h.commands.foundTown();
  for (let i = 0; i < 4; i++) h.debug.spawnHunter({ level: 20, fullyEquipped: true });
  return h;
}

describe('contracts and factions (REQ-CON-001/REQ-FAC-001)', () => {
  it('analyses offers before acceptance with client, risk and reward reasons', () => {
    const h = guild();
    const board = h.commands.contractBoard();
    expect(board.length).toBeGreaterThan(0);
    expect(board[0]?.offer.clientName).toBeTruthy();
    expect(board[0]?.reasons.join(' ')).toMatch(/level|offers/);
  });

  it('accepts only one active contract and resolves it through a real expedition', () => {
    const h = guild();
    const offer = h.commands.contractBoard().find((x) => x.offer.regionId === 'verdant_reach')!.offer;
    expect(h.commands.acceptContract(offer.offerId).ok).toBe(true);
    expect(h.commands.acceptContract(h.commands.contractBoard()[0]!.offer.offerId).ok).toBe(false);
    const gold = h.session.resources.amount('gold');
    const outcome = h.commands.sendExpedition(offer.regionId, offer.objective);
    expect(outcome.ok).toBe(true);
    expect(h.session.contracts.active()).toBeUndefined();
    if (outcome.ok && outcome.value.result.completed) {
      expect(h.session.resources.amount('gold')).toBeGreaterThan(gold);
    }
  });

  it('updates faction standing and hunter chronicles on success', () => {
    const h = guild();
    const standing = h.session.content.contracts.standing;
    const offer = h.commands.contractBoard().find((x) => x.offer.regionId === 'verdant_reach')!.offer;
    h.commands.acceptContract(offer.offerId);
    const party = h.session.partyPlanner.propose(h.session.roster.all(), offer.objective);
    const outcome = h.commands.sendExpedition(offer.regionId, offer.objective, party);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const completed = outcome.value.result.completed;
    expect(h.session.factions.value(offer.factionId)).toBe(completed ? standing.success : standing.failure);
    for (const member of party.members) {
      expect(
        h.session.chronicle.counter(member.hunterId, completed ? 'contractsCompleted' : 'contractsFailed'),
      ).toBe(1);
    }
  });

  it('persists offers, active contract and faction standing', () => {
    const first = guild();
    const offer = first.commands.contractBoard()[0]!.offer;
    first.commands.acceptContract(offer.offerId);
    first.session.factions.change(offer.factionId, 7);
    const second = testSession('contracts-load');
    second.session.restore(first.session.snapshot());
    expect(second.session.contracts.active()?.offerId).toBe(offer.offerId);
    expect(second.session.factions.value(offer.factionId)).toBe(7);
  });
});

describe('the board follows the guild (REQ-CON-001 tiers, REQ-CAP-001 drives generation)', () => {
  it('a new guild is offered only open work, and is told what the next tier needs', () => {
    const h = testSession('board-new');
    h.commands.foundGuild();
    const tiers = h.commands.contractBoard().map((analysis) => analysis.offer.tier);
    expect(tiers.every((tier) => tier === 1)).toBe(true);
    const locked = h.commands.lockedContracts();
    expect(locked.length).toBeGreaterThan(0);
    expect(locked[0]!.missing.join(' ')).toMatch(/reputation|capability|standing/);
  });

  it('reputation and capability open higher tiers', () => {
    const h = testSession('board-veteran');
    h.commands.foundTown();
    for (let i = 0; i < 4; i++) h.debug.spawnHunter({ level: 30, fullyEquipped: true });
    h.session.reputation.change(40, 'test fame');
    for (const faction of h.session.content.contracts.factions) h.session.factions.change(faction.id, 20);
    const eligible = h.session.contracts.eligible().map((template) => template.tier);
    expect(Math.max(...eligible)).toBeGreaterThan(1);
  });

  it('clients post new work on the town clock, not only once per save', () => {
    const h = testSession('board-clock');
    h.commands.foundGuild();
    const first = h.commands.contractBoard().map((analysis) => analysis.offer.offerId);
    h.commands.advanceTown(h.session.content.contracts.board.refreshSteps + 1);
    const second = h.commands.contractBoard().map((analysis) => analysis.offer.offerId);
    expect(second).not.toEqual(first);
  });
});

describe('Endgame Challenge Contracts (REQ-END-004)', () => {
  function challengeGuild(seed: string, templateId: string) {
    const h = testSession(seed);
    h.commands.foundTown();
    const template = h.session.content.contracts.templates.find((t) => t.id === templateId)!;
    // Put the challenge on the board directly: this test is about the constraint, not the draw.
    h.session.contracts.restore({
      offers: [{ ...template, offerId: 'contract_test', clientName: 'Test Client' }],
      active: undefined,
      sequence: 2,
      refreshedAtTick: h.session.clock.tick,
    });
    return { ...h, template };
  }

  it('the planner shapes its party to the terms when the player lets it choose', () => {
    const h = challengeGuild('challenge-shape', 'lean_patrol');
    for (let i = 0; i < 4; i++) h.debug.spawnHunter({ level: 12, fullyEquipped: true });
    expect(h.commands.acceptContract('contract_test').ok).toBe(true);
    const outcome = h.commands.sendExpedition(h.template.regionId, h.template.objective);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.party.members.length).toBeLessThanOrEqual(2);
  });

  it('a party the player chose is refused with the reasons, never quietly altered', () => {
    const h = challengeGuild('challenge-refuse', 'lean_patrol');
    for (let i = 0; i < 4; i++) h.debug.spawnHunter({ level: 12, fullyEquipped: true });
    expect(h.commands.acceptContract('contract_test').ok).toBe(true);
    const party = h.session.partyPlanner.propose(h.session.roster.all(), h.template.objective);
    expect(party.members.length).toBeGreaterThan(2);
    const outcome = h.commands.sendExpedition(h.template.regionId, h.template.objective, party);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/at most 2 hunters/);
    expect(h.session.contracts.active()?.id).toBe('lean_patrol');
  });

  it('a level cap the roster cannot meet is visible before acceptance', () => {
    const h = challengeGuild('challenge-level', 'untested_blades');
    for (let i = 0; i < 4; i++) h.debug.spawnHunter({ level: 40 });
    const analysis = h.commands.contractBoard().find((a) => a.offer.id === 'untested_blades')!;
    expect(analysis.recommendation).toBe('unavailable');
    expect(analysis.reasons.join(' ')).toMatch(/0 hunter\(s\) at or below level 12/);
  });

  it('pays its rare reward on success', () => {
    const h = challengeGuild('challenge-pay', 'lean_patrol');
    for (let i = 0; i < 2; i++) h.debug.spawnHunter({ level: 30, fullyEquipped: true });
    expect(h.commands.acceptContract('contract_test').ok).toBe(true);
    const crystals = h.session.resources.amount('insight_crystal');
    const outcome = h.commands.sendExpedition(h.template.regionId, h.template.objective);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !outcome.value.result.completed || outcome.value.result.wiped) return;
    expect(h.session.resources.amount('insight_crystal')).toBeGreaterThanOrEqual(
      crystals + (h.template.reward.extras?.['insight_crystal'] ?? 0),
    );
  });
});
