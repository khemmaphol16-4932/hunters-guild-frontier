/**
 * How a party out in the world reads to the player (DL-071). Words only: where the party is and
 * when it is due home both come from `GuildCommands.partiesInField`, which owns the rules.
 */

import type { FieldParty } from '../app/GuildCommands.js';

const steps = (n: number): string => (n === 1 ? '1 step' : `${n} steps`);

/** The full line, for the expedition screen. */
export function describeParty(party: FieldParty): string {
  const where = {
    outbound: `Walking out to ${party.regionName}`,
    working: `At stop ${party.node} of ${party.nodes} in ${party.regionName}`,
    inbound: `${party.recalled ? 'Recalled — heading' : 'Heading'} home from ${party.regionName}`,
    home: `Back at the gate from ${party.regionName}`,
  }[party.phase];
  return party.phase === 'home' ? where : `${where} · home in ${steps(party.stepsUntilHome)}`;
}

/** The short form, for a hunter's place in the town dock. */
export function describeAway(party: FieldParty): string {
  return {
    outbound: `Walking to ${party.regionName}`,
    working: `${party.regionName} · stop ${party.node}/${party.nodes}`,
    inbound: `Heading home`,
    home: `At the gate`,
  }[party.phase];
}
