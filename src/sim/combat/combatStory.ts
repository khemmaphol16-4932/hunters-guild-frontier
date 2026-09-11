/**
 * The replay as a story (REQ-UX-004).
 *
 * v1.0 §110 asks for a timeline and highlights, not a full-frame replay, and asks that it
 * explain five things: why a hunter died, why a boss fell, the key skills, the rescues, and
 * the mistakes and turning points. This turns an encounter's `CombatFacts` into exactly that:
 * a one-line verdict, a short list of *why* sentences, and a timeline of the moments that
 * mattered.
 *
 * "Mistakes" are stated as choices, not blame. A declined rescue is recorded only when the
 * hunter it abandoned went on to die, and the sentence says what the chooser did instead —
 * the player can judge whether attacking was wrong; the replay only has to show that it was
 * the choice.
 */

import type { CombatFacts, EncounterOutcome } from './CombatEncounter.js';

export type MomentKind = 'turning-point' | 'down' | 'death' | 'rescue' | 'boss-fell' | 'declined-rescue';

export interface CombatMoment {
  readonly at: number;
  readonly kind: MomentKind;
  readonly text: string;
}

export interface CombatStory {
  readonly verdict: string;
  /** The answers to "why": deaths, the boss, the decisive choices. Most important first. */
  readonly why: readonly string[];
  readonly keySkills: readonly string[];
  readonly moments: readonly CombatMoment[];
}

const TURN_WINDOW_SECONDS = 5;
const TURN_THRESHOLD = 0.25;

const ACTION_WORDS: Readonly<Record<string, string>> = {
  attack: 'keep attacking',
  skill: 'use a skill',
  approach: 'close in',
  retreat: 'fall back',
  dodge: 'dodge',
  wait: 'hold',
};

export function tellStory(facts: CombatFacts, outcome: EncounterOutcome, seconds: number): CombatStory {
  const name = (id: string) => facts.names[id] ?? id;
  const time = (at: number) => `${at.toFixed(1)}s`;
  const moments: CombatMoment[] = [];
  const why: string[] = [];

  // --- Deaths: what put them down, and whether anyone could have reached them -------------
  for (const death of facts.deaths) {
    const down = [...facts.downs].reverse().find((d) => d.targetId === death.id && d.at <= death.at);
    const declined = facts.declinedRescues.filter((d) => d.targetId === death.id && d.at <= death.at);
    let line = `${name(death.id)} died at ${time(death.at)}`;
    if (down) line += `, brought down by ${name(down.sourceId)} at ${time(down.at)}`;
    if (declined.length > 0) {
      const first = declined[0]!;
      line += `. ${name(first.byId)} could have gone back for them at ${time(first.at)} but chose to ${ACTION_WORDS[first.chose] ?? first.chose}`;
      if (declined.length > 1) line += ` (and ${declined.length - 1} other chance${declined.length === 2 ? '' : 's'} passed)`;
      moments.push({ at: first.at, kind: 'declined-rescue', text: `${name(first.byId)} did not go back for ${name(death.id)}.` });
    } else {
      line += '. Nobody was in a position to reach them';
    }
    why.push(`${line}.`);
    moments.push({ at: death.at, kind: 'death', text: `${name(death.id)} did not get back up.` });
  }

  // --- The boss: the killing blow, and who carried the fight ------------------------------
  for (const bossId of facts.bosses) {
    const kill = facts.kills.find((k) => k.targetId === bossId);
    if (!kill) continue;
    const dealers = Object.entries(facts.damageBy)
      .filter(([id]) => !facts.bosses.includes(id) && facts.names[id] !== undefined && !isMonsterSide(facts, id))
      .sort((a, b) => b[1] - a[1]);
    const total = dealers.reduce((sum, [, dmg]) => sum + dmg, 0);
    const shares = dealers
      .slice(0, 3)
      .map(([id, dmg]) => `${name(id)} ${Math.round((dmg / Math.max(1, total)) * 100)}%`)
      .join(', ');
    why.unshift(
      `${name(bossId)} fell at ${time(kill.at)} to ${name(kill.byId)}'s ${kill.label}.` +
        (shares ? ` Damage across the fight: ${shares}.` : ''),
    );
    moments.push({ at: kill.at, kind: 'boss-fell', text: `${name(bossId)} fell to ${name(kill.byId)}.` });
  }

  // --- Rescues and downs --------------------------------------------------------------------
  for (const rescue of facts.rescues) {
    moments.push({ at: rescue.at, kind: 'rescue', text: `${name(rescue.byId)} pulled ${name(rescue.targetId)} back up.` });
  }
  for (const down of facts.downs) {
    if (facts.deaths.some((d) => d.id === down.targetId && d.at >= down.at)) continue;
    moments.push({ at: down.at, kind: 'down', text: `${name(down.targetId)} went down to ${name(down.sourceId)}.` });
  }

  // --- Turning points: the biggest swing in the balance of the fight, either way ---------
  for (const turn of turningPoints(facts.samples)) {
    moments.push({
      at: turn.at,
      kind: 'turning-point',
      text: turn.delta < 0 ? 'The fight turned against the party.' : 'The party took control of the fight.',
    });
  }

  // --- Key skills ---------------------------------------------------------------------------
  // Total uses per skill, and whoever used it most.
  const skillTotals = new Map<string, { uses: number; by: string; byUses: number }>();
  for (const [id, uses] of Object.entries(facts.skillUses)) {
    for (const [skill, count] of Object.entries(uses)) {
      const entry = skillTotals.get(skill) ?? { uses: 0, by: name(id), byUses: 0 };
      entry.uses += count;
      if (count > entry.byUses) {
        entry.by = name(id);
        entry.byUses = count;
      }
      skillTotals.set(skill, entry);
    }
  }
  const keySkills = [...skillTotals.entries()]
    .sort((a, b) => b[1].uses - a[1].uses)
    .slice(0, 3)
    .map(([skill, entry]) => `${skill} ×${entry.uses} (mostly ${entry.by})`);

  moments.sort((a, b) => a.at - b.at);
  return { verdict: verdict(outcome, seconds, facts), why, keySkills, moments: moments.slice(0, 12) };
}

function isMonsterSide(facts: CombatFacts, id: string): boolean {
  // Monster combatant ids carry an instance suffix ("wolf#0"); hunters' ids never do.
  return id.includes('#') || facts.bosses.includes(id);
}

function verdict(outcome: EncounterOutcome, seconds: number, facts: CombatFacts): string {
  const length = `${Math.round(seconds)}s`;
  const lost = facts.deaths.length;
  switch (outcome) {
    case 'victory':
      return lost > 0 ? `Won in ${length}, at the cost of ${lost} hunter${lost === 1 ? '' : 's'}.` : `Won in ${length}.`;
    case 'defeat':
      return `The party was broken after ${length}.`;
    case 'withdrawal':
      return `The party broke off after ${length}.`;
    default:
      return `A stalemate after ${length}.`;
  }
}

/**
 * The largest fall and the largest rise in the party's advantage (guild health share minus
 * enemy health share) over any five-second window, if either is large enough to matter.
 */
function turningPoints(samples: CombatFacts['samples']): readonly { at: number; delta: number }[] {
  let worst = { at: 0, delta: 0 };
  let best = { at: 0, delta: 0 };
  for (let i = 0; i < samples.length; i++) {
    const start = samples[i]!;
    for (let j = i + 1; j < samples.length && samples[j]!.at - start.at <= TURN_WINDOW_SECONDS; j++) {
      const end = samples[j]!;
      const delta = end.guild - end.enemy - (start.guild - start.enemy);
      if (delta < worst.delta) worst = { at: end.at, delta };
      if (delta > best.delta) best = { at: end.at, delta };
    }
  }
  return [worst, best].filter((turn) => Math.abs(turn.delta) >= TURN_THRESHOLD);
}
