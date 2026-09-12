/**
 * specs/03-monsters.md — read from combat/monsters.json. Tier sets the canvas, element sets the
 * colour read, and boss phases come from the data, so a renamed phase renames its prompt.
 */

import { data } from './lib.mjs';

const monsters = data('combat/monsters.json').monsters;
const worldBossId = data('world/worldBoss.json').bossId;
const dir = 'art/monsters';

const SIZE = {
  trash: { canvas: [128, 128], pivot: [64, 112], facings: 'mirror' },
  elite: { canvas: [192, 192], pivot: [96, 176], facings: 'mirror' },
  boss: { canvas: [384, 320], pivot: [192, 288], facings: 'all' },
  world: { canvas: [640, 512], pivot: [320, 464], facings: 'all' },
};
const ELEMENT = {
  fire: 'Its fire element must read at a glance even with effects off: ember light held inside it, in ember orange-red and honey gold.',
  frost: 'Its frost element must read at a glance even with effects off: pale rime and a cold frost-white sheen on its edges.',
};

// The visual brief is the art's; everything else comes from the data.
const BRIEF = {
  moss_crawler: ['a low, broad, slow creature of damp moss and overlapping bark plates on many short stubby legs, the size of a large dog, with a pale lichen underside — a piece of forest floor that decided to walk. A nuisance, not a terror', 'about 80 pixels long and never taller than a hunter\'s knee'],
  thicket_wasp: ['a wasp the size of a small bird, amber with dark bands, two pairs of flat translucent wings drawn as simple shapes, legs tucked, hovering above the ground', 'about 60 pixels across, its body hovering 20 pixels above the ground point'],
  quarry_hound: ['a lean, long-legged grey hound coated in stone dust, head carried low, mineral scabs across the shoulders — something that has lived in quarry spoil. Its attack goes low, at the legs', 'about 88 pixels long'],
  slag_thrower: ['a squat, heat-scarred quarry dweller with arms long enough to lob, carrying a small crucible of glowing slag it hurls from', 'about 104 pixels tall'],
  bracken_stalker: ['a tall, thin, bent-forward thing of dead bracken and ash with long hooked forelimbs, that walks in a straight line and does not stop at the ditch', 'about 124 pixels tall'],
  cairn_archer: ['a hunched, stone-grey barrow dweller drawing a heavy bow made from a cairn-stone stave, clearly a ranged threat even at distance', 'about 108 pixels tall'],
  hollow_chanter: ['a robed figure with a hollow, open chest, standing in an open singing posture, arms slightly raised toward allies it mends', 'about 112 pixels tall'],
  rot_shambler: ['a waterlogged, heavy, lurching figure dragging one oversized arm that is clearly the threat', 'about 120 pixels tall'],
  mire_weaver: ['a spindly, many-jointed marsh weaver with strands of silk stretched between its limbs', 'about 116 pixels tall'],
  warden_of_ash: ['a towering, slow guardian of burial terraces, built from fused grave-stone and banked glowing coals, wearing a heavy mantle of grey ash like a cloak; dull ember light shows through cracks in the stone. Solemn and deliberate, a keeper rather than a beast, with no face', 'about 220 pixels tall on a 2 by 2 tile footprint'],
  the_drowned_choir: ['a slow procession of drowned robed figures fused together at the shoulders into one tall, heavy mass, heads bowed, one figure at the front leading. Water still runs from their robes and pools at their feet, though they stand in dry grey ash. Cold, sorrowful and enormous rather than monstrous: no detailed faces, no skulls', 'about 360 pixels tall on a 3 by 3 tile footprint'],
};
const EXTRA = {
  warden_of_ash: 'fire demon, balrog, lava monster',
  the_drowned_choir: 'screaming faces, ghosts, glowing eyes, zombies, sea monster, kraken',
};
// A boss phase changes the art by adding, never by glowing (specs/03 §2.3–2.4).
const PHASE_LOOK = {
  warden_of_ash: ['the cracks brighten and widen and small embers rise from the mantle', 'flame breaks through the mantle and the ash cloak burns away from the shoulders'],
  the_drowned_choir: ['a second figure lifts its head out of the mass', 'every figure faces outward with its mouth open and the water streams faster'],
};

// DL-069: humanoid enemies share the hunters' soft-chibi ratio so both read at one world scale;
// creatures and the two bosses keep form-appropriate proportions.
const HUMANOID = new Set(['slag_thrower', 'cairn_archer', 'hollow_chanter', 'rot_shambler']);

const REGION_OF = Object.fromEntries(
  data('world/regions.json').regions.flatMap((r) => r.encounters.flatMap((e) => e.monsters).map((m) => [m, r.name])),
);

function monster(m) {
  const [brief, size] = BRIEF[m.id] ?? (() => { throw new Error(`03-monsters: no visual brief for ${m.id}`); })();
  const tier = m.id === worldBossId ? 'world' : m.tier;
  const s = SIZE[tier];
  const where = REGION_OF[m.id] ?? (m.id === worldBossId ? 'the Ashfall Barrows, as a world event' : 'the Ashfall Barrows');
  const label = tier === 'world' ? 'world boss' : m.tier === 'trash' ? 'common creature' : m.tier;
  const phases = (m.phases ?? []).map((p, i) => `phase overlay "${p.name}", shown below ${Math.round(p.belowHealthFraction * 100)} percent health: ${PHASE_LOOK[m.id]?.[i] ?? 'a visible escalation added as a layer'}. Draw only what the phase adds, as a layer over the approved base.`);
  return {
    id: `MON_${m.id.toUpperCase()}`,
    priority: ['moss_crawler', 'thicket_wasp'].includes(m.id) ? 'P0' : ['quarry_hound', 'slag_thrower'].includes(m.id) ? 'P1' : 'P2',
    canvas: s.canvas, pivot: s.pivot, covers: [`monster:${m.id}`],
    out: `${dir}/${m.id}/monster_${m.id}_idle_se_01@2x.png`,
    subject: `${m.name}, a ${label} from ${where}: ${brief}. ${size[0].toUpperCase()}${size.slice(1)}. ${m.element ? ELEMENT[m.element] : ''}${HUMANOID.has(m.id) ? ' A compact humanoid build of about 1 to 4.5 head-to-height, matching the proportions of the hunters so both read at the same world scale — unsettling, not cute.' : ''} Grounded and strange rather than monstrous; no gore. Facing south-east, neutral idle pose.`,
    negative: EXTRA[m.id],
    dropNegative: m.id === worldBossId ? ['multiple characters'] : [],
    variations: [
      s.facings === 'all' ? 'the facing, to north-east, drawn fresh; its asymmetric features stay on the same side of its body.' : 'the facing, to north-east, showing its back.',
      ...(s.facings === 'all' ? ['the facing, to south-west, drawn fresh, not mirrored.', 'the facing, to north-west, drawn fresh, not mirrored.'] : []),
      ...phases,
    ],
  };
}

export default {
  id: '03',
  title: 'Monsters and Bosses',
  spec: 'art/specs/03-monsters.md',
  groups: [
    { title: 'Common creatures', assets: monsters.filter((m) => m.tier === 'trash').map(monster) },
    { title: 'Elites', note: 'Each elite carries one silhouette feature the common tier lacks, so it can be picked out of a mixed encounter at 0.55 zoom.', assets: monsters.filter((m) => m.tier === 'elite').map(monster) },
    { title: 'Bosses', note: 'Bosses are authored in all four facings: a mirrored telegraph would point the Hunter AI\'s cue the wrong way. Wind-up and cast poses are keyframe sheets in category 11.', assets: monsters.filter((m) => m.tier === 'boss').map(monster) },
    {
      title: 'Blocked',
      assets: [
        { id: 'MON_HENCHMAN_SET', priority: 'P3', generate: false, construct: 'Blocked on content: REQ-CW-013 allows world-boss henchmen, but world/worldBoss.json defines none. When it does, palette-swap existing Ashfall elites with the Choir\'s water motif (O-5).' },
        { id: 'MON_WOLF', priority: 'P2', generate: false, construct: 'Blocked on content: the town-defense threat "A wolf pack at the treeline" spawns moss_crawler, and monsters.json has no wolf. Change the threat text or add a wolf monster; then add its prompt here.' },
      ],
    },
  ],
};
