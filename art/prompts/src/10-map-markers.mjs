/** specs/10-map-markers.md — shape systems first; hue only reinforces. */

import { data } from './lib.mjs';

const R = data('world/regions.json');
const dir = 'art/ui/markers';
const PIN = [64, 80];
const zoneShape = { blue: 'a circle', yellow: 'a triangle', red: 'a diamond', black: 'a notched octagon' };
const zoneRule = {
  blue: 'hunters are downed and rescued, never killed', yellow: 'injury and recovery', red: 'a small chance of losing carried loot', black: 'death is possible',
};

const pins = (id, title, members, { priority = 'P1', cols = Math.min(members.length, 5), extra = '' } = {}) => ({
  id: `MRK_${id.toUpperCase()}`, priority, kind: 'sheet', canvas: PIN, grid: { cols },
  out: `${dir}/marker_${id}_sheet@2x.png`,
  subject: `A map marker sheet for an isometric frontier world: the ${title} set. Each marker is a pin — a 64 by 64 head over a short 16-pixel stem whose tip touches the ground point it marks — flat, bold and readable at 24 pixels, with a 1-pixel outline in a darker shade of its own colour, on transparency. ${extra}`,
  members: members.map(([mid, subject, cover]) => ({ id: mid, out: `${dir}/marker_${id}_${mid}@2x.png`, subject, covers: cover ? [cover] : [] })),
});

const knowledge = ['rumor', 'discovered', 'experienced', 'mastered'];
const knowledgeLook = {
  rumor: 'a dotted outline only, nothing solid', discovered: 'a solid outline, empty inside', experienced: 'a solid outline, half filled', mastered: 'fully filled with a small inner mark',
};

export default {
  id: '10',
  title: 'Map Markers',
  spec: 'art/specs/10-map-markers.md',
  groups: [
    {
      title: 'Danger and knowledge',
      assets: [
        pins('zone', 'zone danger', Object.keys(R.zoneTiers).filter((k) => !k.startsWith('$')).map((z) => [
          z, `${R.zoneTiers[z].name} zone — ${zoneRule[z]}: ${zoneShape[z]} in ${R.zoneTiers[z].colour}`, `zone:${z}`,
        ]), { priority: 'P0', cols: 4, extra: 'Danger rises with the number of corners, so the four read in order even in greyscale.' }),
        pins('knowledge', 'guild knowledge badges', knowledge.map((k) => [k, `${k}: ${knowledgeLook[k]}`, `knowledge:${k}`]),
          { cols: 4, extra: 'Knowledge is shown by how solid the badge is, drawn in warm neutral parchment so it can sit over any zone pin.' }),
        { id: 'MRK_KNOWLEDGE_UNKNOWN', priority: 'P1', generate: false, covers: ['knowledge:unknown'],
          construct: 'Unknown places have no marker — fog. If an important discovery is pending, the place shows the rumor badge instead, because important discoveries must never depend on unmarked secrets.' },
        pins('node', 'route node kinds', Object.keys(R.nodeKinds).filter((k) => !k.startsWith('$')).map((n) => [n,
          { combat: 'crossed blades', rest: 'a small campfire', discovery: 'a spyglass', event: 'a signpost' }[n] ?? n, `node:${n}`]), { cols: 4 }),
        pins('region', 'region identity badges', R.regions.map((r) => [r.id,
          { verdant_reach: 'a fern frond', coldwater_quarry: 'a quarry winch', the_sunken_choirhouse: 'a drowned stone arch', ashfall_barrows: 'a stone cairn' }[r.id] ?? r.name, `region:${r.id}`]), { cols: 4 }),
      ],
    },
    {
      title: 'Parties, alerts and state',
      assets: [
        pins('party', 'party positions', [
          ['travelling', 'a walking pennant pointed in the direction of travel'],
          ['fighting', 'the pennant with crossed blades'],
          ['returning', 'the pennant pointing home with a small pack badge'],
        ], { priority: 'P0', cols: 3 }),
        pins('alert', 'camera alert-jump targets — the player chooses to jump; alerts never move the camera', [
          ['hunter_downed', 'a pulsing ring in soft healer green'], ['town_attack', 'a palisade silhouette'],
          ['world_boss', 'a drowned bronze bell'], ['rare_find', 'a notched item-frame corner'],
        ], { cols: 4 }),
        pins('state', 'place states', [
          ['locked', 'a padlock badge'], ['requirement_met', 'an open padlock badge'],
          ['queued', 'a small hourglass — an assignment is waiting for an injured hunter to recover'], ['bookmark', 'a plain flag, its number drawn later by the interface'],
        ], { cols: 4 }),
      ],
    },
  ],
};
