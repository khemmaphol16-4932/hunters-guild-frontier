import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { blank, decodePng, encodePng } from '../../tools/png.mjs';

const OUT = 'art/qa/master-overview-v1';
mkdirSync(OUT, { recursive: true });

const board = blank(1536, 900);

function rect(x, y, w, h, color) {
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
    const p = (py * board.width + px) * 4;
    [board.data[p], board.data[p + 1], board.data[p + 2], board.data[p + 3]] = [...color, 255];
  }
}

function resizeNearest(img, width, height) {
  const out = blank(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.min(img.width - 1, Math.floor(x * img.width / width));
    const sy = Math.min(img.height - 1, Math.floor(y * img.height / height));
    const s = (sy * img.width + sx) * 4, d = (y * width + x) * 4;
    for (let k = 0; k < 4; k++) out.data[d + k] = img.data[s + k];
  }
  return out;
}

function blit(source, x, y, width = null, height = null) {
  let img = decodePng(readFileSync(source));
  if (width && height) img = resizeNearest(img, width, height);
  for (let py = 0; py < img.height; py++) for (let px = 0; px < img.width; px++) {
    if (x + px < 0 || y + py < 0 || x + px >= board.width || y + py >= board.height) continue;
    const s = (py * img.width + px) * 4;
    if (img.data[s + 3] < 128) continue;
    const d = ((y + py) * board.width + x + px) * 4;
    const a = img.data[s + 3] / 255;
    for (let k = 0; k < 3; k++) board.data[d + k] = Math.round(img.data[s + k] * a + board.data[d + k] * (1 - a));
    board.data[d + 3] = 255;
  }
}

rect(0, 0, 1536, 900, [29, 34, 31]);
rect(24, 24, 930, 500, [103, 124, 76]);
rect(978, 24, 534, 500, [44, 50, 46]);
rect(24, 548, 1488, 328, [39, 45, 42]);

// Current world baseline: greybox buildings on the approved olive ground family.
blit('art/qa/town/town_preview.png', 24, 24, 930, 500);
// Building vocabulary remains greybox; this panel makes that gap explicit.
blit('art/qa/greybox/category_lineup.png', 990, 44, 510, 210);
blit('art/qa/greybox/guild_hall_tiers.png', 1010, 282, 470, 220);

// Static P0 actors, monsters and dressing at a shared review scale.
const sprites = [
  'art/qa/hunter-turnaround-source-v3/hunter_vanguard_skel_idle_se_turnaround_v03@2x.png',
  'art/qa/hunter-turnaround-source-v3/hunter_adept_skel_idle_se_turnaround_v03@2x.png',
  'art/qa/hunter-turnaround-source-v3/hunter_ranger_skel_idle_se_turnaround_v03@2x.png',
  'art/qa/moss-crawler-source-v2/monster_moss_crawler_idle_se_02@2x.png',
  'art/qa/thicket-wasp-source-v1/monster_thicket_wasp_idle_se_01@2x.png',
  'art/qa/trees-source-v1/prp_trees_broadleaf_medium_01@2x.png',
  'art/qa/trees-source-v1/prp_trees_birch_medium_01@2x.png',
  'art/qa/trees-source-v1/prp_trees_conifer_medium_01@2x.png',
  'art/qa/town-props-source-v1/prp_town_basic_barrel_01@2x.png',
  'art/qa/town-props-source-v1/prp_town_basic_crate_01@2x.png',
  'art/qa/town-props-source-v2/prp_town_basic_handcart_01@2x.png',
  'art/qa/town-props-source-v2/prp_town_basic_firepit_01@2x.png',
  'art/qa/lighting-source-v1/prp_lighting_lantern_post_01@2x.png',
];
sprites.forEach((source, index) => blit(source, 38 + index * 112, 620, 96, 96));

writeFileSync(`${OUT}/master_art_overview.png`, encodePng(board));
console.log('PASS master art overview — 13 static P0 samples plus town/building baselines');
