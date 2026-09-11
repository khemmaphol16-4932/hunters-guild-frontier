/**
 * Progressive disclosure (REQ-UX-001) and the audio cue map.
 */

import { describe, expect, it } from 'vitest';
import { hintFor } from '../src/app/Guidance.js';
import { parseGuidance, GUIDANCE_CONDITIONS } from '../src/data/guidanceSchema.js';
import { NOTIFICATION_KINDS } from '../src/data/notificationSchema.js';
import { cueFor, playNoticeCue, registerAudioPlayer } from '../src/ui/audio.js';
import guidanceJson from '../src/data/ui/guidance.json';
import cuesJson from '../src/data/ui/audioCues.json';
import { testSession } from './helpers.js';

describe('hints appear when their situation is real (REQ-UX-001)', () => {
  it('the field explains expeditions before the first one, and stops after', () => {
    const h = testSession('hint-field');
    h.commands.foundGuild();
    expect(hintFor(h.session, 'field', new Set())?.id).toBe('first-expedition');
    h.commands.sendExpedition('verdant_reach', 'clear');
    expect(hintFor(h.session, 'field', new Set())?.id).not.toBe('first-expedition');
  });

  it('the walls hint appears only while the walls are empty', () => {
    const h = testSession('hint-walls');
    h.commands.foundGuild();
    const dismissTownPressure = new Set(['town-pressure']);
    expect(hintFor(h.session, 'town', dismissTownPressure)?.id).toBe('walls-empty');
    let placed = false;
    for (let y = 0; y < h.session.town.grid.height && !placed; y++) {
      for (let x = 0; x < h.session.town.grid.width && !placed; x++) placed = h.session.town.grid.place('palisade', x, y, 0).ok;
    }
    expect(placed).toBe(true);
    expect(hintFor(h.session, 'town', dismissTownPressure)?.id).not.toBe('walls-empty');
  });

  it('a dismissed hint stays dismissed, and one screen shows one hint', () => {
    const h = testSession('hint-dismiss');
    h.commands.foundGuild();
    const first = hintFor(h.session, 'field', new Set())!;
    const next = hintFor(h.session, 'field', new Set([first.id]));
    expect(next?.id).not.toBe(first.id);
  });

  it('hints stay short, and name only conditions the game can evaluate', () => {
    // Evaluator coverage is enforced by the compiler: CONDITIONS is a Record over every
    // GUIDANCE_CONDITIONS entry. Here, the content half: shipped hints use known conditions.
    const known = new Set<string>(GUIDANCE_CONDITIONS);
    for (const hint of (guidanceJson as { hints: { when: string }[] }).hints) expect(known.has(hint.when)).toBe(true);
    const long = structuredClone(guidanceJson) as { hints: { text: string }[] };
    long.hints[0]!.text = 'x'.repeat(400);
    expect(() => parseGuidance(long)).toThrow(/manual page/);
  });
});

describe('audio hooks', () => {
  it('every notice kind maps to a cue or to deliberate silence', () => {
    const cues = (cuesJson as { cues: Record<string, unknown> }).cues;
    for (const kind of NOTIFICATION_KINDS) expect(kind in cues).toBe(true);
  });

  it('a registered player hears the cue; with none, nothing happens', () => {
    expect(() => playNoticeCue('hunterDied')).not.toThrow();
    const heard: string[] = [];
    const stop = registerAudioPlayer((cue) => heard.push(cue));
    playNoticeCue('hunterDied');
    playNoticeCue('townDefended');
    stop();
    playNoticeCue('hunterDied');
    expect(heard).toEqual([cueFor('hunterDied')]);
  });
});
