/** specs/01-world-environment.md — ground, roads, the town edge, hunting grounds, regions, hazards. */

import { data } from './lib.mjs';

const TILE = [128, 64];
const env = 'art/environment';
const regions = data('world/regions.json').regions;

// Four-bit road auto-tile: which diamond edges the road leaves through, in screen terms.
const EDGES = ['upper-left', 'upper-right', 'lower-right', 'lower-left'];
const MASKS = Array.from({ length: 16 }, (_, n) => n)
  .map((n) => ({ bits: [0, 1, 2, 3].map((b) => (n >> (3 - b)) & 1).join(''), edges: EDGES.filter((_, b) => (n >> (3 - b)) & 1) }))
  .filter((m) => m.bits !== '0101'); // the base tile itself
const describeMask = (m) =>
  m.edges.length === 0 ? 'an isolated patch of road that leaves through no edge' :
  m.edges.length === 1 ? `a dead end: the road leaves only through the ${m.edges[0]} edge` :
  `the road leaves through the ${m.edges.join(', ').replace(/, ([^,]*)$/, ' and $1')} edge${m.edges.length > 1 ? 's' : ''}`;

const ground = (material, desc, priority = 'P0') => ({
  id: `ENV_TOWN_GROUND_${material.toUpperCase()}`, priority, kind: 'tile', canvas: TILE,
  out: `${env}/town/env_town_ground_${material}_01@2x.png`,
  subject: `Frontier town ground: ${desc}. Low contrast and calm, so buildings and people read clearly on top of it. Palette: trail dust, warm brown earth, muted moss green, slate-blue shadow. Designed to tile seamlessly with copies of itself on all four edges.`,
  variations: [2, 3, 4].map((n) => `variant 0${n} — move the stones, ruts and worn patches so four variants can sit side by side without a visible repeat. Save as env_town_ground_${material}_0${n}@2x.png.`),
});

// Six identity tiles per region: where form has to change, not just palette (O-5).
const REGION_TILES = {
  verdant_reach: {
    mood: 'overgrown lowland within a day of the gate, walked a hundred times by guild hunters; generous and known. Palette: moss green, fern green, trail dust, warm light.',
    tiles: ['a soft fern meadow', 'a worn hunter trail crossing the tile', 'a low dry-stone field wall', 'a patch of wildflowers in warm cream and gold only', 'a mossy boulder half-sunk in grass', 'a shallow stream crossing of flat stones'],
  },
  coldwater_quarry: {
    mood: 'a flooded stone cutting the guild works for stone and salvage; exposed, mineral and cold. Palette: cut grey stone, slate, cold water blue-grey, rust, sparse olive scrub.',
    tiles: ['cut stone steps', 'a spoil heap of broken rock', 'a pool of cold standing water in a cutting', 'a rusted winch base bolted to rock', 'a split quarry face edge', 'sparse wiry scrub on gravel'],
  },
  the_sunken_choirhouse: {
    mood: 'a drowned hall under the marsh, absolutely still and quiet, holding its breath rather than frightening. Palette: deep teal-grey water, wet stone, pale algae green, silt brown.',
    tiles: ['old flagstones half under still dark water', 'a drowned wooden pew', 'a fallen arch stone in the reeds', 'a reed island', 'a submerged stone step', 'the stump of a broken stone column'],
  },
  ashfall_barrows: {
    mood: 'burial terraces under a permanent fall of warm grey ash; wrong, but never gory and never horror. Palette: ash grey, scorched earth, bone, ember red-orange in small amounts.',
    tiles: ['a grassed barrow terrace edge', 'a small stone cairn', 'a deep drift of grey ash', 'scorched roots breaking the ground', 'a toppled marker stone', 'a cracked slab over a barrow entrance'],
  },
};

const regionTiles = regions.flatMap((r) => {
  const def = REGION_TILES[r.id];
  if (!def) throw new Error(`01-world-environment: no identity tiles for region ${r.id}`);
  return def.tiles.map((t, i) => ({
    id: `ENV_${r.id.toUpperCase()}_ID_${i + 1}`,
    priority: r.id === 'verdant_reach' ? 'P0' : r.id === 'coldwater_quarry' ? 'P1' : 'P2',
    kind: 'tile', canvas: TILE, out: `${env}/${r.id}/env_${r.id}_id${i + 1}_01@2x.png`,
    covers: i === 0 ? [`region:${r.id}`] : [],
    subject: `Identity ground tile for ${r.name}, a ${r.zoneTier}-danger region: ${def.mood} This tile shows ${t}, seamless on all four edges with the region's plain base ground.`,
    variations: [`variant 02 of the same feature with different placement. Save as env_${r.id}_id${i + 1}_02@2x.png.`],
  }));
});

export default {
  id: '01',
  title: 'World Environment',
  spec: 'art/specs/01-world-environment.md',
  groups: [
    {
      title: 'Town ground',
      assets: [
        ground('grass', 'trampled short grass with a few pressed-in stones'),
        ground('dirt', 'packed earth with faint wheel ruts'),
        ground('gravel', 'loose grey gravel spread over earth'),
        ground('plaza', 'a cut-stone plaza of large worn flagstones, used only for the Great Hall forecourt', 'P1'),
        ground('mud', 'wet churned mud with standing puddles', 'P1'),
      ],
    },
    {
      title: 'Roads',
      note: 'A four-bit auto-tile set. The base tile runs straight between the upper-right and lower-left edges; each variation is one of the other fifteen connection sets. The road centreline must meet every edge at its exact midpoint so any two tiles join.',
      assets: [
        {
          id: 'ENV_ROAD_EARTH', priority: 'P0', kind: 'tile', canvas: TILE, out: `${env}/road/env_road_earth_0101@2x.png`,
          subject: 'A frontier road tile: compacted earth and fine gravel, two shallow wheel ruts, a soft grassy verge on each side. The road runs straight across the tile, entering through the upper-right edge and leaving through the lower-left edge, meeting each edge exactly at its midpoint. It must work equally on town ground and on wild meadow.',
          negative: 'paved asphalt, cobblestones, lane markings',
          variations: MASKS.map((m) => `the connection set — ${describeMask(m)}. Save as env_road_earth_${m.bits}@2x.png.`),
        },
        {
          id: 'ENV_ROAD_EDGED', priority: 'P1', kind: 'tile', canvas: TILE, out: `${env}/road/env_road_edged_0101@2x.png`,
          subject: 'A town road tile: compacted earth and gravel with a neat line of set edging stones along both sides, used inside the town once it grows. The road runs straight from the upper-right edge to the lower-left edge, meeting each edge exactly at its midpoint.',
          negative: 'paved asphalt, cobblestones, lane markings',
          variations: MASKS.map((m) => `the connection set — ${describeMask(m)}. Save as env_road_edged_${m.bits}@2x.png.`),
        },
      ],
    },
    {
      title: 'Town edge and water',
      assets: [
        {
          id: 'ENV_TOWN_EDGE', priority: 'P0', kind: 'tile', canvas: TILE, out: `${env}/town/env_town_edge_straight_01@2x.png`,
          subject: 'The edge of a frontier town: trampled earth on the upper half of the tile giving way to rough scrub and the first saplings on the lower half, the palette crossing from warm town browns to cooler wild greens across the tile. It must look right with or without a palisade standing on it.',
          variations: ['an outer corner of the same town edge.', 'an inner corner of the same town edge.', 'the straight edge running the other way, from upper-left to lower-right.'],
        },
        {
          id: 'ENV_WATER', priority: 'P1', kind: 'tile', canvas: TILE, out: `${env}/water/env_water_open_01@2x.png`,
          subject: 'Open still water: a calm teal-grey surface with two or three small flat highlight shapes, no ripples, seamless on all four edges.',
          variations: ['a straight shoreline, water on the lower half and a muddy bank with reeds on the upper half.', 'an outer shoreline corner.', 'an inner shoreline corner.', 'animation frame 02 of the open water: move the highlight shapes one pixel right.', 'animation frame 03: move them two pixels right.', 'animation frame 04: move them one pixel left of frame 01.'],
        },
      ],
    },
    {
      title: 'Hunting grounds',
      note: 'Town work, not expeditions: both grounds sit within sight of the palisade (town/threats.json).',
      assets: [
        {
          id: 'ENV_GATE_THICKETS', priority: 'P1', kind: 'tile', canvas: TILE, covers: ['ground:gate_thickets'], out: `${env}/hunting/env_gate_thickets_01@2x.png`,
          subject: 'The gate thickets: dense low scrub just outside a frontier palisade, with fresh-cut stumps and a narrow cleared path, because somebody is always cutting it back. Safe, familiar, warm-edged green.',
          variations: ['a denser patch of the same scrub with no path.', 'a freshly cleared patch with cut brush piled at one side.', 'the same scrub with a trampled patch where a fight happened.'],
        },
        {
          id: 'ENV_OLD_ORCHARD', priority: 'P1', kind: 'tile', canvas: TILE, covers: ['ground:old_orchard'], out: `${env}/hunting/env_old_orchard_01@2x.png`,
          subject: 'The old orchard: half-wild, half-tended grass under fruit trees, fallen fruit in the grass, a broken fence rail, full of things that eat the fruit. Warm and generous.',
          variations: ['a tile with more fallen fruit and a trampled patch.', 'a tile with the broken fence line running across it.', 'a tile of long uncut grass between the trees.'],
        },
        {
          id: 'PRP_ORCHARD_TREE', priority: 'P1', canvas: [192, 256], pivot: [96, 240], out: `${env}/hunting/prp_orchard_tree_01@2x.png`,
          subject: 'A gnarled old fruit tree from a half-wild orchard: low twisted trunk, wide uneven crown with a few small fruit, some fallen fruit at its foot.',
          variations: ['a second tree with a different crown shape.', 'a dead orchard tree, bare branches, still standing.'],
        },
        {
          id: 'PRP_THICKET_STUMPS', priority: 'P1', canvas: [128, 96], pivot: [64, 80], out: `${env}/hunting/prp_thicket_stumps_01@2x.png`,
          subject: 'A cluster of three fresh-cut scrub stumps with pale cut faces and a small pile of cut brush beside them.',
          variations: ['a heap of cut brush alone, ready to be burned.'],
        },
      ],
    },
    {
      title: 'Region templates',
      note: 'Authored once in neutral grey ramps and palette-swapped per region (O-5). Palette tables live in art/environment/<region>/palette.json.',
      assets: [
        {
          id: 'ENV_TEMPLATE_BASE', priority: 'P0', kind: 'tile', canvas: TILE, out: `${env}/template/env_template_base_01@2x.png`,
          subject: 'A neutral template ground tile painted in a five-step grey ramp only, so it can be recoloured by palette swap: short uneven ground cover with a few small stones. Seamless on all four edges.',
          variations: ['variant 02, worn and patchy.', 'variant 03, dense cover.', 'variant 04, bare with scattered stones.'],
        },
        {
          id: 'ENV_TEMPLATE_PATH_EDGE', priority: 'P0', kind: 'tile', canvas: TILE, out: `${env}/template/env_template_edge_0011@2x.png`,
          subject: 'A neutral grey-ramp template transition tile between ground cover and a bare path: the lower half of the diamond is bare path, the upper half ground cover, the boundary soft and irregular. Part of a two-corner Wang set, seamless with the base template.',
          variations: ['the outer corner where only the lower-right quarter is bare path.', 'the inner corner where only the upper-left quarter keeps ground cover.', 'the diagonal case where the upper-left and lower-right quarters are bare path.'],
        },
        {
          id: 'ENV_TEMPLATE_SCATTER', priority: 'P1', kind: 'sheet', canvas: [128, 64],
          out: `${env}/template/env_template_scatter@2x.png`,
          subject: 'A neutral grey-ramp scatter overlay sheet: small details that sit on top of any ground tile, each on transparency.',
          members: [
            { id: 'stones', out: `${env}/template/env_template_scatter_stones@2x.png`, subject: 'three small stones' },
            { id: 'litter', out: `${env}/template/env_template_scatter_litter@2x.png`, subject: 'a few fallen leaves and twigs' },
            { id: 'tufts', out: `${env}/template/env_template_scatter_tufts@2x.png`, subject: 'two tufts of taller grass' },
            { id: 'debris', out: `${env}/template/env_template_scatter_debris@2x.png`, subject: 'a broken branch and a flat stone' },
          ],
        },
      ],
    },
    { title: 'Region identity tiles', note: 'Six per region, from each region\'s description in world/regions.json.', assets: regionTiles },
    {
      title: 'Hazards',
      note: 'Every hazard in world/regions.json has a physical presence — decals on region ground, or runtime overlays.',
      assets: [
        {
          id: 'ENV_HAZARD_FLOODED_GALLERIES', priority: 'P1', kind: 'tile', canvas: TILE, covers: ['hazard:flooded_galleries'], out: `${env}/hazard/env_hazard_flooded_galleries_01@2x.png`,
          subject: 'A ground decal lying flat on a 2:1 diamond and transparent everywhere else: a sheet of cold grey-blue standing water over cut quarry stone, a few stone edges showing through.',
          variations: ['a smaller patch of the same water.', 'the water filling a stone channel.', 'a shallow spreading edge of the water.'],
        },
        {
          id: 'ENV_HAZARD_POOR_FOOTING', priority: 'P1', kind: 'tile', canvas: TILE, covers: ['hazard:poor_footing'], out: `${env}/hazard/env_hazard_poor_footing_01@2x.png`,
          subject: 'A ground decal, transparent except the decal: loose grey scree and a cracked stone ledge, clearly unsafe to stand on.',
          variations: ['a smaller scree patch.', 'a crack running across bare rock.', 'a crumbled ledge edge.'],
        },
        {
          id: 'ENV_HAZARD_STANDING_WATER', priority: 'P2', kind: 'tile', canvas: TILE, covers: ['hazard:standing_water', 'event:still_water'], out: `${env}/hazard/env_hazard_standing_water_01@2x.png`,
          subject: 'A ground decal, transparent except the decal: a still, dark pool over old flagstones, perfectly flat, no ripple — quiet, which is worse than if it were not.',
          variations: ['a larger pool reaching two edges of the tile.', 'animation frame 02: a single faint highlight shifts one pixel.', 'a narrow channel of the same still water.'],
        },
        {
          id: 'ENV_HAZARD_GRAVE_COLD', priority: 'P2', kind: 'tile', canvas: TILE, covers: ['hazard:grave_cold'], out: `${env}/hazard/env_hazard_grave_cold_01@2x.png`,
          subject: 'A ground decal, transparent except the decal: pale rime frost on stone and ash, a cold patch that should not exist in warm ashland.',
          variations: ['a smaller rime patch around a marker stone.', 'rime creeping along a crack.', 'a thin rime ring.'],
        },
        {
          id: 'ENV_HAZARD_ASHFALL', priority: 'P2', kind: 'fx', canvas: [32, 32], covers: ['hazard:ashfall'], out: `${env}/hazard/env_hazard_ashfall_mote_01@2x.png`,
          subject: 'A particle sprite: one slow falling mote of warm grey ash, three or four pixels across, soft-edged in shape but hard-edged in pixels, drifting.',
          variations: ['a second mote shape, slightly larger and flatter.'],
        },
        {
          id: 'ENV_HAZARD_FAILING_LIGHT', priority: 'P2', generate: false, covers: ['hazard:failing_light'],
          construct: 'A runtime overlay: a 256 × 256 radial darkening gradient drawn in code over the region, not a painted asset.',
        },
        {
          id: 'ENV_HAZARD_THE_SONG', priority: 'P2', generate: false, covers: ['hazard:the_song', 'event:the_singing'],
          construct: 'Sound made visible as an effect, not terrain: see VFX_THE_SONG in category 08.',
        },
      ],
    },
    {
      title: 'Borders and weather',
      assets: [
        {
          id: 'ENV_REGION_BORDER', priority: 'P2', kind: 'sheet', canvas: [256, 192], out: `${env}/border/env_region_border@2x.png`,
          subject: 'Natural region border pieces for a connected isometric world, so a region boundary reads as geography rather than a loading seam. Each piece spans two tiles along the border.',
          members: [
            { id: 'ridge', out: `${env}/border/env_border_ridge@2x.png`, subject: 'a low rocky ridge' },
            { id: 'riverbank', out: `${env}/border/env_border_riverbank@2x.png`, subject: 'a riverbank with reeds' },
            { id: 'treeline', out: `${env}/border/env_border_treeline@2x.png`, subject: 'a dense treeline' },
            { id: 'rockband', out: `${env}/border/env_border_rockband@2x.png`, subject: 'a band of broken rock' },
          ],
        },
        {
          id: 'ENV_WEATHER_DRIZZLE', priority: 'P3', kind: 'fx', canvas: [32, 32], out: `${env}/weather/env_weather_drizzle_01@2x.png`,
          subject: 'A particle sprite for the Drowned Choir\'s arrival weather: one short cold drizzle streak, pale teal-grey, falling at a slight angle.',
          variations: ['a shorter streak.', 'a splash of three pixels where a drop lands.'],
          note: 'The rest of the arrival weather — desaturation toward #2f4a52 and dimmed ember light — is a runtime tint, not art (REQ-CW-013).',
        },
      ],
    },
  ],
};
