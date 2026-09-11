/**
 * Audio hooks (Phase 9).
 *
 * The game has no sounds yet; they arrive with the art and audio pass. What exists now is
 * the seam: every notice already knows which cue it would sound (`ui/audioCues.json`), and a
 * player — Web Audio, a sound library, a test spy — can be registered to hear them. Until
 * one is, cues go nowhere, silently, which is the correct behaviour for a game that has not
 * shipped its sounds rather than a placeholder beep nobody asked for.
 *
 * Volume and mute belong with the sounds themselves and are deliberately not built yet: a
 * volume slider for a silent game would be a control that does nothing.
 */

import cuesJson from '../data/ui/audioCues.json';
import type { NotificationKind } from '../data/notificationSchema.js';

export type AudioPlayer = (cue: string) => void;

const cues = (cuesJson as { cues: Record<string, string | null> }).cues;
let player: AudioPlayer | undefined;

/** Register the thing that actually makes sound. Returns a function that unregisters it. */
export function registerAudioPlayer(next: AudioPlayer): () => void {
  player = next;
  return () => {
    if (player === next) player = undefined;
  };
}

/** The cue a notice kind sounds, or undefined for a deliberately silent one. */
export function cueFor(kind: NotificationKind): string | undefined {
  return cues[kind] ?? undefined;
}

/** Sound the cue for a notice, if it has one and something is listening. */
export function playNoticeCue(kind: NotificationKind): void {
  const cue = cueFor(kind);
  if (cue && player) player(cue);
}
