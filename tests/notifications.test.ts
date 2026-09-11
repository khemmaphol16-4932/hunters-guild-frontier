/**
 * Notifications (REQ-UX-005): importance-prioritised; only important events interrupt.
 */

import { describe, expect, it } from 'vitest';
import { parseNotifications } from '../src/data/notificationSchema.js';
import notificationsJson from '../src/data/ui/notifications.json';
import { testSession } from './helpers.js';

describe('notifications (REQ-UX-005)', () => {
  it('a death interrupts; a level-up only goes to the feed', () => {
    const { session, debug } = testSession('notices-priority');
    const hunter = debug.spawnHunter();
    session.events.emit('hunter.leveled', { hunterId: hunter.id, level: 2 });
    expect(session.notifications.interrupting()).toHaveLength(0);
    expect(session.notifications.badgeCount()).toBe(0);
    session.events.emit('hunter.died', { hunterId: hunter.id, zoneTier: 'red' });
    expect(session.notifications.interrupting()[0]?.text).toContain(hunter.name);
    expect(session.notifications.all()).toHaveLength(2);
  });

  it('a contract is one notice however many hunters were on it', () => {
    const { session, debug } = testSession('notices-contract');
    for (const hunter of [debug.spawnHunter(), debug.spawnHunter(), debug.spawnHunter()]) {
      session.events.emit('contract.completed', { hunterId: hunter.id, contractId: 'c1', templateId: 't', name: 'Patrol', succeeded: true });
    }
    expect(session.notifications.all().filter((n) => n.kind === 'contractResolved')).toHaveLength(1);
  });

  it('the world boss announces itself once, when it appears', () => {
    const { session, commands } = testSession('notices-boss');
    commands.foundGuild();
    commands.passTime(1);
    commands.passTime(1);
    expect(session.notifications.all().filter((n) => n.kind === 'worldBossAppeared')).toHaveLength(1);
  });

  it('a breach at the walls interrupts; a held wall does not', () => {
    const { session } = testSession('notices-walls');
    session.events.emit('town.defended', { threatName: 'A wolf pack', held: true });
    expect(session.notifications.interrupting()).toHaveLength(0);
    session.events.emit('town.defended', { threatName: 'A wolf pack', held: false });
    expect(session.notifications.interrupting()).toHaveLength(1);
  });

  it('reading clears the interrupt, and the feed stays bounded', () => {
    const { session, debug } = testSession('notices-read');
    const hunter = debug.spawnHunter();
    for (let i = 0; i < 100; i++) session.events.emit('hunter.leveled', { hunterId: hunter.id, level: i + 2 });
    expect(session.notifications.all().length).toBe(session.content.notifications.feedSize);
    session.events.emit('hunter.died', { hunterId: hunter.id, zoneTier: 'red' });
    session.notifications.markAllRead();
    expect(session.notifications.interrupting()).toHaveLength(0);
  });

  it('every kind the game raises must be classified, and nothing else', () => {
    const missing = structuredClone(notificationsJson) as { priorities: Record<string, string> };
    delete missing.priorities['hunterDied'];
    expect(() => parseNotifications(missing)).toThrow(/hunterDied/);
    const extra = structuredClone(notificationsJson) as { priorities: Record<string, string> };
    extra.priorities['moonrise'] = 'routine';
    expect(() => parseNotifications(extra)).toThrow(/moonrise/);
  });
});
