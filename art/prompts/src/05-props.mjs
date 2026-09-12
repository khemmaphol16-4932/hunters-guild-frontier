/** specs/05-props.md — every prop is placeable, state made visible, or history made physical. */

const dir = 'art/props';
// Ids follow the registry groups (ASSET_REGISTRY.md §05): PRP_<GROUP>_<ITEM>. Variants are file
// suffixes (_01, _02 …), never part of the id. Small props use the spec's 64 × 48 @1x canvas.
const SMALL = [128, 96];
const prop = (group, item, subject, { canvas = [128, 128], priority = 'P1', variations = [], covers = [], negative, out } = {}) => ({
  id: `PRP_${group.toUpperCase()}_${item.toUpperCase()}`, priority, canvas, pivot: [canvas[0] / 2, canvas[1] - 12], covers, negative, variations,
  out: out ?? `${dir}/${group}/prp_${group}_${item}_01@2x.png`,
  subject,
});

const HISTORY = [
  ['worldBossVictory', 'world_boss_trophy', 'a salvaged, drowned bronze choir-bell mounted on a timber bracket above a doorway'],
  ['frontierDiscovery', 'survey_stone', 'a waist-high survey marker stone with a simple carved region sigil, beside a road'],
  ['legendaryFind', 'display_case', 'a timber-framed glass-fronted display case on a plinth, holding one item'],
  ['historicContract', 'contract_board', 'a weathered board with several sealed contract papers nailed to it'],
  ['legendaryHunter', 'hunter_post', 'a carved standing post honouring one hunter, with a simple carved motif and a small offering at its foot'],
  ['townMilestone', 'stage_banner', 'a tall flagpole flying a long stage banner of the town\'s growth'],
  ['researchBreakthrough', 'brass_instrument', 'a brass surveying instrument on a stone plinth'],
  ['foundersFacade', 'cornerstone', 'a founders\' cornerstone set into a foundation, chisel-marked'],
  ['endlessRecord', 'depth_post', 'a tall post notched along its length to record how deep the guild has gone'],
];

export default {
  id: '05',
  title: 'Props and Decorations',
  spec: 'art/specs/05-props.md',
  groups: [
    {
      title: 'History made physical',
      note: 'One prop per MONUMENT_KINDS entry (src/data/progressionSchema.ts). Each appears in town only when the Monument records an entry of its kind. No readable text in any of them.',
      assets: HISTORY.map(([kind, id, desc]) => prop('history', id,
        `A commemorative object in a frontier hunters' guild town: ${desc}. Made by hand from what a frontier town has — timber, stone, rope, salvaged metal — modest and a little rough, clearly kept with care. It marks something that really happened. No text, no letters, no gilding, no glow. Facing south-east.`,
        { covers: [`monument:${kind}`], priority: 'P2', variations: ['the facing, to south-west.', 'a weathered version, a few years older, with moss or wear.'] })),
    },
    {
      title: 'Town dressing',
      assets: [
        prop('town_basic', 'barrel', 'A wooden barrel with iron hoops, lid on.', { priority: 'P0', canvas: SMALL, variations: ['an open barrel of grain.', 'a barrel on its side.'] }),
        prop('town_basic', 'crate', 'A plank crate with rope handles.', { priority: 'P0', canvas: SMALL, variations: ['an open crate of produce.', 'two crates stacked.'] }),
        prop('town_basic', 'sack', 'A tied hessian sack of grain.', { priority: 'P0', canvas: SMALL, variations: ['three sacks piled.', 'a slumped half-empty sack.'] }),
        prop('town_basic', 'handcart', 'A two-wheeled wooden handcart, empty, handles down.', { priority: 'P1', canvas: [128, 96], variations: ['the facing, to south-west.', 'the cart loaded with timber.'] }),
        prop('town_basic', 'bench', 'A plain timber bench.', { priority: 'P1', canvas: [128, 80], variations: ['the facing, to south-west.'] }),
        prop('town_basic', 'firepit', 'A stone-ringed firepit with a small low fire.', { priority: 'P0', canvas: SMALL, variations: ['animation frame 2 of 4 of the fire.', 'animation frame 3 of 4.', 'animation frame 4 of 4.', 'the firepit cold, ash only.'] }),
        prop('town_basic', 'woodpile', 'A neat stacked woodpile.', { priority: 'P1', canvas: [128, 96], variations: ['a smaller, half-used woodpile.'] }),
        prop('town_basic', 'weapon_rack', 'A timber training rack of wooden practice swords and staves.', { priority: 'P2', canvas: [128, 112], variations: ['the facing, to south-west.'] }),
        prop('town_basic', 'washing_line', 'A washing line on two posts with plain linen hanging from it.', { priority: 'P1', canvas: [160, 112], variations: ['the facing, to south-west.'] }),
      ],
    },
    {
      title: 'Lighting',
      note: 'Light sources are the only props allowed self-illumination: a hand-authored halo of 2–3 ramp steps, never additive glow.',
      assets: [
        prop('lighting', 'lantern_post', 'A timber lantern post with a lit lantern, honey-gold light held inside the glass.', { priority: 'P0', canvas: [64, 160], variations: ['animation frame 2 of 4: the flame one pixel lower.', 'animation frame 3 of 4: the flame leaning left.', 'animation frame 4 of 4: the flame leaning right.'] }),
        prop('lighting', 'hanging_lamp', 'An iron hanging lamp on a short chain, lit honey gold.', { priority: 'P0', canvas: [64, 96], variations: ['animation frame 2 of 4.', 'animation frame 3 of 4.', 'animation frame 4 of 4.'] }),
        prop('lighting', 'brazier', 'An iron brazier on three legs with a steady fire.', { priority: 'P1', canvas: [80, 112], variations: ['animation frames 2 to 6 of a six-frame fire loop, one per image.'] }),
      ],
    },
    {
      title: 'Trees',
      note: 'Replaces the CSS scenery trees in worldView.renderScene() one for one, keeping its deterministic placement. Regional versions are palette swaps.',
      assets: [
        ['broadleaf', 'a broadleaf tree with a rounded crown and a sturdy trunk'],
        ['conifer', 'a tall conifer with layered dark boughs'],
        ['birch', 'a slim birch with pale bark and a light crown'],
      ].map(([id, desc]) => prop('trees', `${id}_medium`, `A medium frontier woodland tree, about 160 pixels tall: ${desc}. The upper crown is kept clean so the tree can fade when it hides something behind it.`,
        { priority: 'P0', canvas: [192, 256], variations: [`the size, to small — a young version about 120 pixels tall. Save as prp_trees_${id}_small@2x.png.`, `the size, to large — an older version about 192 pixels tall. Save as prp_trees_${id}_large@2x.png.`] })),
    },
    {
      title: 'Landscaping and signage',
      note: 'Placeable decoration (REQ-CW-006). Flowers use warm earthy colours only; blue, violet and red are functional signal colours.',
      assets: [
        prop('landscaping', 'hedge', 'A short clipped hedge section.', { variations: ['a hedge corner.'] }),
        prop('landscaping', 'fence', 'A split-rail timber fence section running from the upper-right to the lower-left of the tile.', { variations: ['a fence corner.', 'a fence end post.', 'a fence gate.'] }),
        prop('landscaping', 'planter', 'A timber planter box of herbs.', { canvas: [96, 80] }),
        prop('landscaping', 'flowerbed', 'A small bordered flowerbed of cream, gold and ochre flowers only.', { canvas: [128, 80], negative: 'blue flowers, purple flowers, red flowers, violet flowers' }),
        prop('landscaping', 'path_edging', 'A line of set edging stones along a path.', { canvas: [128, 64] }),
        prop('landscaping', 'stone_marker', 'A small upright stone waymarker.', { canvas: [64, 96] }),
        prop('signage', 'notice_board', 'A timber notice board with pinned papers showing no readable text.', { canvas: [96, 128], variations: ['the facing, to south-west.'] }),
        prop('signage', 'guild_banner', 'A tall guild banner on a pole, muted cloth with a simple pennant shape and no lettering.', { canvas: [64, 192] }),
        prop('signage', 'shop_sign', 'A hanging shop sign on a bracket with a pictogram of a loaf and no text.', { canvas: [96, 112], variations: ['the pictogram changed to a hammer.', 'the pictogram changed to a bottle.'] }),
        prop('signage', 'gate_sign', 'A tall gate sign on two posts, carved with a simple pennant and no text.', { canvas: [160, 192] }),
      ],
    },
    {
      title: 'Field camps and route events',
      note: 'Knowledge made visible (REQ-CW-014): these appear along a region\'s routes as its knowledge tier rises, and one prop marks each route event where it happens.',
      assets: [
        prop('field_camp', 'trail_blaze', 'A tree trunk with a fresh axe blaze cut into the bark — the first sign a place has been discovered.', { canvas: [96, 160] }),
        prop('field_camp', 'cairn', 'A small stacked-stone trail cairn.', { canvas: [64, 80] }),
        prop('field_camp', 'campsite', 'A cleared campsite: a cold firepit ringed with stones and two log seats.', { canvas: [160, 112] }),
        prop('field_camp', 'rope_line', 'A rope line strung between two stakes across a crossing.', { canvas: [160, 96] }),
        prop('field_camp', 'supply_cache', 'A guild supply cache: a covered crate under oilcloth, weighted with stones.', { canvas: [96, 80] }),
        prop('field_camp', 'waymark_post', 'A waymarked route post with a painted band, no text.', { canvas: [64, 128] }),
        prop('field_camp', 'lean_to', 'A lean-to shelter of poles and bark.', { canvas: [160, 128] }),
        prop('event', 'abandoned_cache', 'Someone else\'s supply crate, left in a hurry, its lid jammed shut.', { covers: ['event:abandoned_cache'], canvas: [96, 80] }),
        prop('event', 'collapsed_passage', 'A pile of fallen rock and timber blocking a narrow way.', { covers: ['event:collapsed_passage'], canvas: [160, 128] }),
        prop('event', 'wounded_stranger', 'A bedroll and a dropped pack where a wounded traveller has been lying — the traveller themselves is not shown.', { covers: ['event:wounded_stranger'], canvas: [128, 80] }),
        prop('event', 'defensible_ground', 'A dry rocky corner with one way in and a small firepit — defensible ground.', { covers: ['event:defensible_ground'], canvas: [160, 128] }),
        prop('rubble', 'pile', 'Rubble from an attack: broken planks, a fallen beam and scattered stone. Restrained, no gore.', { canvas: [128, 96], variations: ['a smaller rubble pile.', 'scorched rubble.', 'a fallen beam alone.', 'scattered stones alone.', 'a broken door on the ground.'] }),
      ],
    },
  ],
};
