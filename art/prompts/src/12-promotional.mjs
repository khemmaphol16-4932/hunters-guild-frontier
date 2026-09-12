/** specs/12-promotional.md — authored small at 480 × 270 and upscaled by whole numbers. */

import { data } from './lib.mjs';

const dir = 'art/promotional';
const NATIVE = [480, 270];
const scene = (id, priority, subject, extra = {}) => ({
  id: `PRM_${id.toUpperCase()}`, priority, kind: 'scene', canvas: NATIVE, out: `${dir}/prm_${id}.png`,
  subject: `A pixel-art landscape composition at a native resolution of 480 by 270 pixels, every pixel hand-placed on a strict grid, at most 64 colours, for a frontier hunters' guild management game: ${subject} Elevated three-quarter view; any buildings and people are drawn in the same 2:1 dimetric angle as the game's sprites and never larger than twice gameplay scale. Golden-hour light from the upper left. Keep the upper-left third of the frame calm and open for interface overlays. No player character, no text.`,
  ...extra,
});

export default {
  id: '12',
  title: 'Loading and Promotional Art',
  spec: 'art/specs/12-promotional.md',
  groups: [
    {
      title: 'Key art',
      note: 'Ship the native 480 × 270 file and let CSS upscale it with image-rendering: pixelated — about 60–120 KB instead of 3 MB.',
      assets: [
        scene('town_overview', 'P1', 'a compact frontier town at golden hour, a sturdy timber-and-stone guild hall anchoring the upper middle, a gate and road leading to the lower edge where a five-hunter party is returning, modest housing, a lantern-lit cookhouse, a forge corner, food stores, paths and trees, busy but legible, with the untamed frontier beyond the palisade.', { note: 'Replaces art/generated/guild-town-overview-v1.png, which is not on a pixel grid.' }),
        scene('verdant_vista', 'P1', 'the road leaving a warm guild settlement into a broad moss-green river valley, trail markers and a small camp showing what the guild already knows, a small travelling party on the road.', { note: 'Replaces art/generated/verdant-reach-vista-v1.png, which is not on a pixel grid.' }),
        scene('guild_hall_exterior', 'P2', 'the Great Hall at its third tier, lived-in, a monster trophy over the door, hunters coming and going, lanterns lit.'),
        scene('black_zone_vista', 'P2', 'the Ashfall Barrows: burial terraces under a permanent fall of warm grey ash, a distant cairn line, a small party at the edge — real danger without horror.', { negative: 'horror, gore, skulls in quantity' }),
        scene('title', 'P2', 'the edge of a warm lantern-lit town on one side and the wild frontier stretching away on the other, a road between them — a world worth living in, and a frontier worth risking it for, in one frame.'),
      ],
    },
    {
      title: 'Region cards',
      note: 'Shown at a region hard-cut. Place and mood only, never gameplay tips; the region\'s own description from world/regions.json is rendered beside it as interface text.',
      assets: data('world/regions.json').regions.map((r) => ({
        ...scene(`region_${r.id}`, 'P3', `${r.name}, a ${r.zoneTier}-danger region — "${r.description}" — seen from the road as a party approaches.`),
        canvas: [240, 135],
        subject: `A pixel-art vignette at a native resolution of 240 by 135 pixels, at most 48 colours: ${r.name}, a ${r.zoneTier}-danger region — "${r.description}" — seen from the road as a party approaches. Same 2:1 dimetric angle as the game's sprites. No text.`,
        covers: [`region:${r.id}`],
      })),
    },
    {
      title: 'Web',
      assets: [
        { id: 'PRM_SHARE_IMAGE', priority: 'P2', generate: false, construct: 'A 400 × 210 crop of the approved PRM_TITLE, upscaled ×3 to 1200 × 630 for Open Graph and social previews.' },
        {
          id: 'PRM_APP_ICON', priority: 'P2', kind: 'icon', canvas: [32, 32], out: `${dir}/prm_app_icon_32.png`,
          subject: 'An app icon at a native 32 by 32 pixels: a guild pennant on a short pole, bold and simple enough to read as a browser favicon, in muted cloth red and timber brown with a lantern-gold point. Scaled up by whole numbers to 192 and 512 for the web app manifest.',
        },
      ],
    },
  ],
};
