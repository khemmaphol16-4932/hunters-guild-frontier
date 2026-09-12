/** ART_BIBLE.md §11 — reference sheets. Approved before any production asset. */

const dir = 'art/reference-sheets';

export default {
  id: '00',
  title: 'Reference Sheets',
  spec: 'art/ART_BIBLE.md',
  groups: [
    {
      title: 'Gate sheets',
      note: 'The four gates. REF_PALETTE_MASTER, REF_LIGHTING_BALL, REF_GRID_PROJECTION and REF_SCALE_LINEUP must be approved before the first production asset is ordered.',
      assets: [
        {
          id: 'REF_PALETTE_MASTER', priority: 'P0', generate: false, out: `${dir}/palette_master.png`,
          construct: 'Built by hand in Aseprite from the exact hex values in ART_BIBLE.md §6 and exported as palette_master.png and palette_master.gpl. An image model cannot reproduce exact hex values, and every other asset is checked against this file, so it must be exact.',
        },
        {
          id: 'REF_LIGHTING_BALL', priority: 'P0', kind: 'sheet', out: `${dir}/lighting_ball.png`, canvas: [128, 128],
          subject: 'A lighting reference sheet for a pixel-art game. Each panel shows one primitive shape, about 96 pixels tall, standing on a small flat grey 2:1 diamond ground tile, painted in a neutral five-step grey ramp. Light: one warm key light from the upper left at about 45 degrees elevation, a faint cool fill from the upper right, a very faint warm bounce on the undersides. Hard 1-pixel outline two steps darker than the local grey. No cast shadows.',
          members: [
            { id: 'sphere', subject: 'a sphere' },
            { id: 'cube', subject: 'a cube, one corner toward the viewer' },
            { id: 'cylinder', subject: 'an upright cylinder' },
          ],
          note: 'Every asset\'s shading is compared against this sheet. Correct the output by hand until the three shapes agree exactly with ART_BIBLE.md §7.',
        },
        {
          id: 'REF_GRID_PROJECTION', priority: 'P0', generate: false, out: `${dir}/grid_projection.png`,
          construct: 'Drawn programmatically or by hand: an 8 × 8 grid of exact 64 × 32 @1x (128 × 64 @2x) diamonds, with 1 × 1, 2 × 2 and 3 × 3 footprints outlined. Geometry must be exact to the pixel, which generation cannot guarantee.',
        },
        {
          id: 'REF_SCALE_LINEUP', priority: 'P0', kind: 'sheet', out: `${dir}/scale_lineup.png`, canvas: [320, 440],
          subject: 'A scale reference line-up for an isometric pixel-art frontier management game: every subject stands on one shared ground baseline, drawn at true relative scale, plain and unfinished like a blocking pass, in neutral colours.',
          members: [
            { id: 'tile', subject: 'one flat 2:1 ground tile, 128 pixels wide' },
            { id: 'hunter', subject: 'an adult human hunter, 112 pixels tall' },
            { id: 'npc', subject: 'a townsperson, 104 pixels tall' },
            { id: 'trash', subject: 'a small creature the size of a large dog, 72 pixels long' },
            { id: 'elite', subject: 'a tall thin creature, 112 pixels tall' },
            { id: 'boss', subject: 'a towering guardian, 220 pixels tall, on a 2 by 2 tile footprint' },
            { id: 'building', subject: 'a small timber cottage on a 2 by 2 footprint' },
            { id: 'tree', subject: 'a broadleaf tree, 160 pixels tall' },
            { id: 'barrel', subject: 'a wooden barrel, 36 pixels tall' },
          ],
          note: 'The model will not hit exact heights. Use the output as a blocking draft and correct every subject to its exact ART_BIBLE.md §5 height by hand.',
        },
      ],
    },
    {
      title: 'Production reference sheets',
      assets: [
        {
          id: 'REF_MATERIAL_STUDY', priority: 'P0', kind: 'sheet', out: `${dir}/material_study.png`, canvas: [128, 128], grid: { cols: 3 },
          subject: 'A material study sheet for an isometric pixel-art frontier game. Each panel is one 2:1 diamond swatch of a single material, shaded in a five-step ramp that shifts cooler in the shadows and warmer in the highlights, lit from the upper left.',
          members: [
            { id: 'timber', subject: 'weathered dressed timber planks' },
            { id: 'thatch', subject: 'straw thatch' },
            { id: 'cut_stone', subject: 'cut grey stone blocks' },
            { id: 'leather', subject: 'worn brown leather' },
            { id: 'iron', subject: 'dark forged iron' },
            { id: 'cloth', subject: 'undyed wool cloth' },
            { id: 'rope', subject: 'coiled hemp rope' },
            { id: 'water', subject: 'still teal-grey water' },
            { id: 'ash', subject: 'drifted grey ash' },
          ],
        },
        {
          id: 'REF_HUNTER_TURNAROUND', priority: 'P0', kind: 'sheet', out: `${dir}/hunter_turnaround.png`, canvas: [128, 160], grid: { cols: 4 },
          subject: 'A character turnaround sheet for three frontier hunter archetypes in an isometric pixel-art management game. Neutral standing poses, arms slightly away from the body, plain practical clothing, head-to-body ratio 1 to 6, no facial detail beyond two-pixel eyes. Each row is one archetype seen from the four camera-relative facings.',
          members: [
            ...['south-east', 'south-west', 'north-east', 'north-west'].map((f, i) => ({ id: `vanguard_${i}`, subject: `a broad, grounded vanguard, facing ${f}` })),
            ...['south-east', 'south-west', 'north-east', 'north-west'].map((f, i) => ({ id: `adept_${i}`, subject: `a tall, robed adept, facing ${f}` })),
            ...['south-east', 'south-west', 'north-east', 'north-west'].map((f, i) => ({ id: `ranger_${i}`, subject: `a lean, asymmetric ranger with a quiver on the right hip, facing ${f}` })),
          ],
        },
        {
          id: 'REF_SILHOUETTE_SHEET', priority: 'P1', generate: false, out: `${dir}/silhouette_sheet.png`,
          construct: 'Made from approved sprites, not generated: fill every character and monster 100% black, place them in a row at 100% and at 55%, and update the sheet whenever a character or monster is approved.',
        },
        {
          id: 'REF_ZONE_MOOD', priority: 'P1', kind: 'sheet', out: `${dir}/zone_mood.png`, canvas: [512, 256], grid: { cols: 2 },
          subject: 'A zone mood comparison sheet for an isometric pixel-art frontier game: the same small 4 by 4 tile woodland clearing with a path, two trees and a rock, rendered four times with different palettes so a player can rank the danger without being told. Terrain only; no creatures, no people.',
          members: [
            { id: 'blue', subject: 'safe: soft moss greens, warm light, generous' },
            { id: 'yellow', subject: 'cautious: cold grey stone, exposed, sparse scrub' },
            { id: 'red', subject: 'dangerous: drowned, still dark water, failing light' },
            { id: 'black', subject: 'deadly: scorched earth under a fall of warm grey ash, wrong but not gory' },
          ],
        },
        {
          id: 'REF_BUILDING_TIERS', priority: 'P1', kind: 'sheet', out: `${dir}/building_tiers.png`, canvas: [384, 400],
          subject: 'A building tier reference sheet: the same frontier guild hall on the same 3 by 3 tile footprint and in the same orientation at three points in its life, so the tier reads from material and additions alone, never from a label.',
          members: [
            { id: 't1', subject: 'Command Post: an open-sided timber frame with a canvas roof, a map table, a ledger and one lantern' },
            { id: 't2', subject: 'Guild Hall: the same structure enclosed with plank walls, shutters, a shingle roof, a chimney and a guild banner' },
            { id: 't3', subject: 'Great Hall: two storeys of timber on a cut-stone plinth, clay tile roof, a modest bell tower, glazed windows, a trophy over the door' },
          ],
        },
      ],
    },
  ],
};
