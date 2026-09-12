/** specs/06-equipment.md — world layers for what the camera can see; icons for everything. */

import { data } from './lib.mjs';

const types = data('items/item-types.json').types;
const cards = data('items/cards.json').cards;
const sets = data('items/sets.json').sets;
const uniques = data('items/unique-effects.json');
const uniqueList = Object.entries(uniques).find(([k, v]) => k !== '$comment' && Array.isArray(v))[1];
const monsterIds = new Set(data('combat/monsters.json').monsters.map((m) => m.id));
const dir = 'art/equipment';
const CELL = [128, 160];

const LOOK = {
  blade: 'a plain straight single-handed blade with a leather-wrapped grip and a simple crossguard',
  maul: 'a two-handed maul with a heavy iron-banded head on a long haft',
  bow: 'a tall recurve hunting bow of laminated wood with a plain grip',
  stave: 'a plain wooden stave taller than a person, iron-shod at the foot, no crystal',
  shield: 'a round timber-and-hide shield with an iron boss',
  focus: 'a hand-held focus: a brass lens in a leather-bound frame',
  helm: 'a simple open-faced iron helm with a leather lining',
  cuirass: 'a boiled-leather cuirass with iron fittings',
  robes: 'a folded length of heavy practical robe cloth with a rope belt',
  gauntlets: 'a pair of iron-backed leather gauntlets',
  wraps: 'a pair of cloth hand wraps',
  greaves: 'a pair of leather-and-iron greaves',
  boots: 'a pair of worn soft travel boots',
  charm: 'a small carved bone charm on a cord',
  sigil: 'a small cast-iron sigil disc',
};
const WORLD = ['blade', 'maul', 'bow', 'stave', 'shield', 'focus', 'helm'];
const TIERS = 'tier 1 is plain and worn, tier 2 fitted and bound, tier 3 fine work — always by material and wear, never glow';

const worldLayer = (id) => ({
  id: `EQP_WORLD_${id.toUpperCase()}`, priority: ['bow', 'blade', 'stave', 'shield', 'focus'].includes(id) ? 'P0' : 'P1',
  canvas: CELL, pivot: [64, 144], out: `${dir}/world/${id}/eqp_${id}_t2_vanguard_idle_se_01@2x.png`,
  subject: `Equipment layer for a character sprite: ${LOOK[id]}, tier 2 (${TIERS}). A working tool made by a frontier smith, true to real scale against a 112-pixel hunter, no ornament. Drawn alone in the exact position it is held in a neutral standing pose facing south-east; everything else transparent.`,
  variations: [
    `tier 1 — plainer and more worn. Save as eqp_${id}_t1_vanguard_idle_se_01@2x.png.`,
    `tier 3 — finer work, still practical. Save as eqp_${id}_t3_vanguard_idle_se_01@2x.png.`,
    id === 'bow' ? 'the carried position: the bow slung across the back, seen facing north-east.' : 'the facing, to north-east, where the item sits behind the body.',
  ],
});

const UNIQUE_LOOK = {
  the_long_argument: 'a blade whose edge is notched along its length with small tally marks, one for each blow in a long fight',
  widows_ledger: 'a focus made from a small iron-bound ledger with a mourning ribbon for a bookmark',
  iron_promise: 'a round shield with a heavy iron chain wrapped through its boss',
  cold_arithmetic: 'a cold-iron sigil scored with columns of tally marks, rimed at the edges',
};

export default {
  id: '06',
  title: 'Weapons and Equipment',
  spec: 'art/specs/06-equipment.md',
  groups: [
    { title: 'World layers', note: 'Only slots the camera can see at 0.55 zoom get a world layer (O-7).', assets: WORLD.map(worldLayer) },
    {
      title: 'Inventory icons',
      assets: [{
        id: 'EQP_ICONS', priority: 'P0', kind: 'sheet', canvas: [96, 96], grid: { cols: 5 }, out: `${dir}/icons/eqp_icons_t1@2x.png`,
        subject: `An inventory icon sheet for a frontier guild game: every item type at tier 1, each object alone in three-quarter view filling about 80 percent of its panel, on transparency, with no frame. The same pixel grid, palette and upper-left light as the game world. All fifteen must be distinguishable at 24 by 24 pixels. ${TIERS}.`,
        members: types.map((t) => ({ id: t.id, covers: [`itemType:${t.id}`], out: `${dir}/icons/eqp_icon_${t.id}_t1@2x.png`, subject: LOOK[t.id] ?? (() => { throw new Error(`06-equipment: no look for ${t.id}`); })() })),
        variations: ['the tier, to 2 for all fifteen — fitted, bound and cared for. Save each as eqp_icon_<type>_t2@2x.png.', 'the tier, to 3 for all fifteen — fine work, still practical. Save each as eqp_icon_<type>_t3@2x.png.'],
      }],
    },
    {
      title: 'Sets, unique effects and cards',
      assets: [
        ...sets.map((s) => ({
          id: `EQP_SET_${s.id.toUpperCase()}`, priority: 'P2', kind: 'icon', canvas: [96, 96], covers: [`set:${s.id}`], out: `${dir}/sets/eqp_set_${s.id}_motif@2x.png`,
          subject: `The shared motif of the "${s.name}" equipment set — "${s.description}" — shown on a leather shoulder piece: ${s.id === 'ashwardens' ? 'soot-darkened iron edging and one ember-coloured stitch line' : s.id === 'quietstep' ? 'wrapped cord bindings in muted grey-green' : 'a small hooded-lantern badge in lantern gold'}. A small mark repeated on every piece of the set, not a matching costume.`,
          variations: ['the same motif applied to a boot.', 'the same motif applied to a helm.'],
        })),
        ...uniqueList.map((u) => ({
          id: `EQP_UNIQUE_${u.id.toUpperCase()}`, priority: 'P2', kind: 'icon', canvas: [96, 96], covers: [`unique:${u.id}`], out: `${dir}/unique/eqp_unique_${u.id}@2x.png`,
          subject: `Inventory icon of a unique item, "${u.name}": ${UNIQUE_LOOK[u.id] ?? (() => { throw new Error(`06-equipment: no look for unique ${u.id}`); })()}. Its effect changes how a build works, so its shape differs from the ordinary item — never a glow, never a colour change.`,
        })),
        {
          id: 'EQP_CARDS', priority: 'P1', kind: 'sheet', canvas: [96, 96], out: `${dir}/cards/eqp_cards@2x.png`,
          subject: 'A sheet of guild cards drawn as small physical objects in a frontier world — plates, tokens and seals, never trading cards with frames or stat blocks — each on transparency in three-quarter view.',
          members: cards.filter((c) => c.rarity !== 'legendary').map((c) => ({
            id: c.id, covers: [`card:${c.id}`], out: `${dir}/cards/eqp_card_${c.id}@2x.png`,
            subject: { bulwark_sigil: 'an iron plate stamped with a wall', tidebound_charm: 'a tide-worn stone on a cord', quartermasters_seal: 'a wax seal on a paper tag', counterpoise: 'a balanced brass weight', long_watch: 'a worn watch-candle stub in a holder', hoarfrost_lens: 'a frosted glass disc' }[c.id] ?? `the ${c.name}`,
          })),
        },
        ...cards.filter((c) => c.rarity === 'legendary').map((c) => {
          const boss = c.source?.bossId;
          if (!monsterIds.has(boss)) {
            return { id: `EQP_CARD_${c.id.toUpperCase()}`, priority: 'P2', generate: false, covers: [`card:${c.id}`],
              construct: `Blocked on content: this card's source boss "${boss}" does not exist in combat/monsters.json. Add the boss or change the card's source, then write its prompt.` };
          }
          const look = { warden_of_ash_card: 'a coal still glowing faintly in a setting of grave-stone', hollow_choir_card: 'a small drowned bronze bell, water beading on it' }[c.id];
          return {
            id: `EQP_CARD_${c.id.toUpperCase()}`, priority: 'P2', kind: 'icon', canvas: [96, 96], covers: [`card:${c.id}`], out: `${dir}/cards/eqp_card_${c.id}@2x.png`,
            subject: `A legendary boss card drawn as a physical object: ${look ?? `a relic of ${boss}`}. It visibly relates to the boss it came from. A physical object, never a trading card.`,
            variations: ['reveal-animation frames 2 to 8: the object turning once in warm lantern light, one frame per image.'],
          };
        }),
      ],
    },
  ],
};
