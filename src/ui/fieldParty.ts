/**
 * How a party out in the world reads to the player (DL-071). Words only: where the party is and
 * when it is due home both come from `GuildCommands.partiesInField`, which owns the rules.
 */

import type { FieldParty } from '../app/GuildCommands.js';

const steps = (n: number): string => (n === 1 ? '1 step' : `${n} steps`);

/**
 * The full line, for the expedition screen. While a party is still working, its return time is not
 * yet known (DL-074), so the line says which stop it is on rather than counting down; the countdown
 * appears once it has turned for home.
 */
export function describeParty(party: FieldParty): string {
  const where = {
    outbound: `Walking out to ${party.regionName}`,
    working: `At stop ${party.node} in ${party.regionName}`,
    inbound: `${party.recalled ? 'Recalled — heading' : 'Heading'} home from ${party.regionName}`,
    home: `Back at the gate from ${party.regionName}`,
  }[party.phase];
  if (party.phase === 'home') return where;
  return party.stepsUntilHome !== undefined ? `${where} · home in ${steps(party.stepsUntilHome)}` : `${where} · still out`;
}

/** The short form, for a hunter's place in the town dock. */
export function describeAway(party: FieldParty): string {
  return {
    outbound: `Walking to ${party.regionName}`,
    working: `${party.regionName} · stop ${party.node}`,
    inbound: `Heading home`,
    home: `At the gate`,
  }[party.phase];
}
