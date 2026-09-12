/** specs/02-hunter-characters.md — three archetype skeletons plus a paper-doll layer set. */

import { data } from './lib.mjs';

const CELL = [128, 160];
const PIVOT = [64, 144];
const dir = 'art/characters';
const archetypes = data('archetypes.json').archetypes.map((a) => a.id);
const origins = data('names.json').pools.map((p) => p.id);

const BODY = {
  vanguard: 'broad-shouldered adult, weight low and centred, feet planted in a slightly wide stance; built like someone who does heavy physical work and expects to be struck — solid and practical, not muscular fantasy',
  adept: 'tall slender adult, narrow shoulders, hands held forward and clearly visible, attentive upright posture; a scholar who walks into dangerous country, not a wizard',
  ranger: 'lean athletic adult with a deliberately asymmetric stance: one shoulder lower, weight forward on the balls of the feet, reading as someone who has been walking for days',
};
const SKELETON_EXTRA = {
  vanguard: '',
  adept: 'glowing runes, magic circle, floating objects, pointy wizard hat, staff with a crystal, spell effects',
  ranger: 'hood covering the whole face, assassin, ninja, cloak billowing, rogue stereotype',
};

const skeleton = (id) => ({
  id: `HUN_SKEL_${id.toUpperCase()}`, priority: 'P0', canvas: CELL, pivot: PIVOT, covers: [`archetype:${id}`],
  out: `${dir}/${id}/hunter_${id}_skel_idle_se_01@2x.png`,
  subject: `Base character rig for a frontier hunter of the "${id}" archetype: a ${BODY[id]}. Plain neutral grey undergarment only — this is a base body rig, clothing is added as separate layers. Head-to-body ratio 1 to 6, standing 112 pixels tall. No facial detail beyond two-pixel eyes. Facing south-east, neutral standing pose with the arms slightly away from the body for clean layer separation.`,
  negative: SKELETON_EXTRA[id],
  variations: [
    'the facing, to north-east — a back three-quarter view; do not mirror the front view.',
    ...(id === 'ranger' ? ['the facing, to south-west, drawn fresh rather than mirrored, because the ranger\'s asymmetry must stay on the same side of the body.', 'the facing, to north-west, drawn fresh rather than mirrored.'] : []),
  ],
});

const ORIGIN = {
  frontier: 'the default frontier pool — honest working kit: canvas, boiled leather, undyed wool; warm browns and faded brick red',
  marshfolk: 'marshfolk — people of reed beds, slow water and constant weather: waxed oilcloth, reed-woven belts and pouches, rolled and bound cuffs; muted greens, silt brown and grey-cream',
  highland: 'highland — hard, short, weather and stone: heavy wool, fur trim, iron pins; blue-grey and undyed cream',
  collegium: 'collegium — faintly pleased with itself: layered cloth, several belts, satchels and document cases, ink-stained cuffs; deep neutrals',
  farroad: 'farroad — from no single place, deliberately heterogeneous: every piece from somewhere different, patched and mismatched, yet worn with ease',
};
const CUT = {
  vanguard: 'a vanguard\'s cut: padded jerkin and reinforced shoulders over a broad frame, sturdy trousers, heavy boots',
  adept: 'an adept\'s cut: a long coat or robe to mid-calf that makes one vertical column, sleeves free at the hands',
  ranger: 'a ranger\'s cut: close-fitting layered travel clothing, bound sleeves, soft boots, one side weighted by a hip pouch',
};
const outfit = (origin, arche) => ({
  id: `HUN_LAYER_OUTFIT_${origin.toUpperCase()}_${arche.toUpperCase()}`,
  priority: origin === 'frontier' ? 'P0' : origin === 'farroad' ? 'P2' : 'P1',
  canvas: CELL, pivot: PIVOT, covers: arche === archetypes[0] ? [`origin:${origin}`] : [],
  out: `${dir}/outfits/${origin}/hunter_outfit_${origin}_${arche}_t2_idle_se_01@2x.png`,
  subject: `Clothing layer for a frontier hunter sprite. Culture: ${ORIGIN[origin]}. Garment: ${CUT[arche]}. Tier 2 kit — reinforced with visible, honest repair, mended and maintained, neither new nor ruined. No heraldry, no bright dye, no ornament. Drawn as a clothing overlay for an existing ${arche} body rig facing south-east in a neutral standing pose. Clothing only: no body, no head, no weapon.`,
  negative: 'armour plate, chainmail, heraldry, tabard, bright dye, clean new fabric, fantasy robes',
  variations: [
    `tier 1 — the same garment plainer and more worn, rough and patched. Save as hunter_outfit_${origin}_${arche}_t1_idle_se_01@2x.png.`,
    `tier 3 — the same garment better made and well maintained, finer materials, still practical. Save as hunter_outfit_${origin}_${arche}_t3_idle_se_01@2x.png.`,
    'the facing, to north-east, showing the back of the same garment.',
  ],
});

const HAIR = ['close-cropped', 'shaved sides with a short top knot', 'a single long braid', 'loose shoulder-length hair', 'short tight curls', 'hair tied back in a low tail', 'a shaved head', 'wild unkempt hair', 'two short braids', 'hair bound up under a cloth wrap'];

export default {
  id: '02',
  title: 'Hunter Characters',
  spec: 'art/specs/02-hunter-characters.md',
  groups: [
    {
      title: 'Archetype skeletons',
      note: 'All animation lives on these three rigs. Every generated hunter is a paper-doll composite on one of them.',
      assets: archetypes.map(skeleton),
    },
    {
      title: 'Body and hair',
      assets: [
        {
          id: 'HUN_LAYER_BODY', priority: 'P0', canvas: CELL, pivot: PIVOT, out: `${dir}/body/hunter_body_skin1_vanguard_idle_se_01@2x.png`,
          subject: 'Skin and body layer for a frontier hunter sprite on the vanguard rig, facing south-east: bare head, neck, forearms and hands only, in the first of four natural skin-tone ramps, lit from the upper left. Everything else is transparent so clothing layers go on top.',
          variations: ['skin-tone ramp 2 of 4.', 'skin-tone ramp 3 of 4.', 'skin-tone ramp 4 of 4.', 'the same layer fitted to the adept rig.', 'the same layer fitted to the ranger rig.'],
        },
        {
          id: 'HUN_LAYER_HAIR', priority: 'P0', kind: 'sheet', canvas: CELL, grid: { cols: 5 }, out: `${dir}/hair/hunter_hair_styles_se@2x.png`,
          subject: 'A hair-style layer sheet for frontier hunter sprites, all on the same head position of a south-east-facing rig, in one dark-brown ramp so colours can be swapped later. Hair only: no head, no face. Every style must be distinguishable as a pure black silhouette at small size.',
          members: HAIR.map((h, i) => ({ id: `style_${String(i + 1).padStart(2, '0')}`, out: `${dir}/hair/hunter_hair_${String(i + 1).padStart(2, '0')}_se@2x.png`, subject: h })),
          variations: ['the same ten styles seen from behind, facing north-east — draw the backs fresh; a braid or tail must hang down the back, not appear mirrored at the front.'],
        },
      ],
    },
    {
      title: 'Outfits',
      note: 'Five origin cultures from names.json, each cut for the three archetypes. Tiers 1 and 3 are variations of tier 2.',
      assets: origins.flatMap((o) => archetypes.map((a) => outfit(o, a))),
    },
    {
      title: 'Packs and overlays',
      assets: [
        {
          id: 'HUN_LAYER_PACK', priority: 'P0', kind: 'sheet', canvas: CELL, out: `${dir}/packs/hunter_packs_se@2x.png`,
          subject: 'Carried-gear layer sheet for frontier hunter sprites, each drawn in the exact position it sits on a south-east-facing hunter, gear only, no body.',
          members: [
            { id: 'travel_pack', out: `${dir}/packs/hunter_pack_travel_se@2x.png`, subject: 'a canvas travel pack with a bedroll strapped on top' },
            { id: 'quiver', out: `${dir}/packs/hunter_pack_quiver_se@2x.png`, subject: 'a leather hip quiver of arrows on the right side' },
            { id: 'satchel', out: `${dir}/packs/hunter_pack_satchel_se@2x.png`, subject: 'a cross-body satchel of books and cases' },
          ],
          variations: ['the same three seen from behind, facing north-east.'],
        },
        {
          id: 'HUN_OVERLAY_INJURED', priority: 'P1', canvas: CELL, pivot: PIVOT, out: `${dir}/overlays/hunter_overlay_injured_se@2x.png`,
          subject: 'Injury overlay layer for a frontier hunter sprite facing south-east: a pale linen bandage wrapped around the left forearm and a bound left knee, clean and restrained, no blood. Bindings only, everything else transparent.',
          negative: 'blood, gore, open wounds',
          variations: ['a sling holding the right arm across the chest.', 'a bandage wrapped around the head.'],
          note: 'Fatigue, hunger and low morale are posture changes on the skeleton, not overlays: see the condition keyframe sheets in category 11.',
        },
        {
          id: 'HUN_OVERLAY_ROLE_PIP', priority: 'P0', kind: 'sheet', canvas: [20, 20], out: `${dir}/overlays/hunter_role_pips@2x.png`,
          subject: 'A sheet of five tiny ground-anchored role markers, 20 by 20 pixels each, flat and bold, each a distinct shape so they read in greyscale.',
          members: [
            { id: 'tank', covers: ['role:tank'], out: `${dir}/overlays/hunter_pip_tank@2x.png`, subject: 'a shield shape, flat top and tapered base, in blue #5b8dd6' },
            { id: 'healer', covers: ['role:healer'], out: `${dir}/overlays/hunter_pip_healer@2x.png`, subject: 'a plain cross, in green #5fbf87' },
            { id: 'damage', covers: ['role:damage'], out: `${dir}/overlays/hunter_pip_damage@2x.png`, subject: 'an upward chevron, in red #d4685f' },
            { id: 'support', covers: ['role:support'], out: `${dir}/overlays/hunter_pip_support@2x.png`, subject: 'a circle, in violet #b58bd6' },
            { id: 'control', covers: ['role:control'], out: `${dir}/overlays/hunter_pip_control@2x.png`, subject: 'a diamond, in teal #4fb0b8' },
          ],
        },
      ],
    },
    {
      title: 'Service NPCs',
      note: 'Service NPCs only (REQ-TWN-004) — no life simulation. They stand at their building and work.',
      assets: [
        ['recruiter', 'a recruiter behind a notice board, ledger under one arm, weathered and shrewd'],
        ['merchant', 'a market merchant in an apron with a coin pouch, sleeves rolled up'],
        ['crafter', 'a smith in a leather apron holding tongs, forearms scarred'],
        ['researcher', 'a guild archivist with ink-stained fingers and a satchel of papers'],
        ['service_worker', 'a cook in a plain apron carrying a covered pot'],
      ].map(([id, desc]) => ({
        id: `NPC_${id.toUpperCase()}`, priority: 'P1', canvas: CELL, pivot: [64, 148], out: `${dir}/npc/npc_${id}_idle_se_01@2x.png`,
        subject: `A frontier townsperson sprite: ${desc}. Slightly smaller than a hunter at 104 pixels tall, head-to-body ratio 1 to 6, no facial detail beyond two-pixel eyes, facing south-east in a neutral working pose.`,
        variations: ['the facing, to north-east.', 'a working pose — mid-task, in the middle of their trade.'],
      })),
    },
  ],
};
