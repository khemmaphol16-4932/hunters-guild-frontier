/** specs/07-resources.md — the eight resources, and the loot a hunter visibly carries. */

import { data } from './lib.mjs';

const resources = data('economy/resources.json').resources;
const dir = 'art/resources';
const LOOK = {
  gold: 'a tied leather coin pouch, its metal a warm lantern-gold ramp built from #e8b45a, clearly not the yellow zone signal colour',
  food: 'a hessian sack of provisions with smoked meat tied to it',
  materials: 'a bundle of sawn timber planks with a cut stone block',
  iron: 'a rough bar of dark forged iron beside an ore lump',
  salvage: 'a bundle of scrap tied with cord: buckles, fittings and a broken blade',
  warding_salt: 'a small wax-sealed jar of coarse white salt',
  essence: 'a stoppered glass vial of cloudy liquid with a faint internal light of two ramp steps, no halo',
  insight_crystal: 'a single clear crystal half-wrapped in cloth, with a faint internal light of two ramp steps, no halo',
};

export default {
  id: '07',
  title: 'Resources and Loot',
  spec: 'art/specs/07-resources.md',
  groups: [
    {
      title: 'Resources',
      note: 'One sheet for all eight so they read as one family. The 24-pixel resource-bar icons are downsampled at build time (O-1).',
      assets: [{
        id: 'RES_ICONS', priority: 'P0', kind: 'sheet', canvas: [96, 96], grid: { cols: 4 }, out: `${dir}/res_icons@2x.png`,
        subject: 'A resource icon sheet for a frontier guild management game: each resource as one physical object in three-quarter view, filling about 80 percent of its panel, on transparency, no frame. Every one must be unmistakable by shape alone at 24 by 24 pixels, and all eight must read as one family.',
        members: resources.map((r) => ({ id: r.id, covers: [`resource:${r.id}`], out: `${dir}/res_${r.id}_icon@2x.png`, subject: `${r.name}: ${LOOK[r.id] ?? (() => { throw new Error(`07-resources: no look for ${r.id}`); })()}` })),
        variations: ['all eight as world drops: each object lying on the ground seen from the game\'s 2:1 dimetric angle, drawn smaller to fit a 64 by 64 panel. Save each as res_<id>_drop@2x.png.'],
      }],
    },
    {
      title: 'Carried loot',
      note: 'REQ-CW-008: carried loot is the hunter\'s until sold, and at risk in Red and Black zones, so a player can see it on the hunter.',
      assets: [{
        id: 'RES_CARRY_OVERLAY', priority: 'P1', kind: 'sheet', canvas: [128, 160], out: `art/characters/packs/hunter_pack_carry_se@2x.png`,
        subject: 'A carried-loot layer sheet for a south-east-facing frontier hunter sprite, gear only, no body, each drawn where it sits on the back.',
        members: [
          { id: 'laden', out: 'art/characters/packs/hunter_pack_travel_laden_se@2x.png', subject: 'a bulging travel pack with one extra bundle tied on' },
          { id: 'heavy', out: 'art/characters/packs/hunter_pack_travel_heavy_se@2x.png', subject: 'an overfull travel pack with bundles tied on both sides, clearly heavy' },
        ],
        variations: ['the same two seen from behind, facing north-east.'],
        note: 'The empty state is the ordinary travel pack from HUN_LAYER_PACK. The heavy lean is a walk-cycle variant on the skeleton, in category 11.',
      }],
    },
  ],
};
