/**
 * specs/11-animations.md — keyframe reference sheets for animators. Generation gives the key
 * poses; the in-betweens are hand-animated in Aseprite. Monster wind-ups are read from
 * monsters.json, including each skill's telegraphSeconds.
 */

import { data } from './lib.mjs';

const archetypes = data('archetypes.json').archetypes.map((a) => a.id);
const monsters = data('combat/monsters.json').monsters;
const worldBossId = data('world/worldBoss.json').bossId;
const canvasFor = (m) => (m.id === worldBossId ? [640, 512] : m.tier === 'boss' ? [384, 320] : m.tier === 'elite' ? [192, 192] : [128, 128]);
const jobs = Object.entries(data('town/jobs.json')).find(([k, v]) => k !== '$comment' && Array.isArray(v))[1].map((j) => j.id);
const CELL = [128, 160];
const LOOK = {
  vanguard: 'a broad, grounded vanguard with a round shield and a blade',
  adept: 'a tall, robed adept with a plain wooden stave',
  ranger: 'a lean, asymmetric ranger with a bow and a hip quiver on the right',
};

// state: [priority, key poses]
const STATES = {
  idle: ['P0', ['neutral stand', 'breath in, shoulders up one pixel', 'weight shifted to the left foot', 'weight back to centre']],
  walk: ['P0', ['left heel contact', 'passing pose', 'right heel contact', 'passing pose on the other side']],
  attack: ['P0', ['wind-up', 'step in and commit', 'impact — the key frame', 'recover']],
  hit: ['P0', ['struck and absorbing the blow', 'recovering balance']],
  downed: ['P0', ['buckling at the knees', 'falling to one side', 'lying downed and still conscious — held until rescue, clearly not dead']],
  gather: ['P1', ['bending toward the ground', 'picking an item up', 'stowing it in the pack']],
  rest: ['P1', ['sitting down', 'seated and resting', 'seated, head lowered']],
  run: ['P1', ['left foot push-off', 'airborne', 'right foot push-off', 'airborne on the other side']],
  death: ['P2', ['collapsing', 'falling', 'lying still — quiet and dignified, no gore']],
  rescue: ['P2', ['kneeling beside a downed ally', 'grabbing their collar', 'dragging backward']],
  carry: ['P2', ['an ally\'s arm over the shoulder, left step', 'right step', 'steadying them']],
  injured_walk: ['P2', ['limping step on the good leg', 'wincing step on the hurt leg', 'catching balance']],
  sell: ['P2', ['swinging the pack down', 'handing goods over a counter', 'pocketing coin']],
  celebrate: ['P2', ['fist raised', 'laughing with shoulders back', 'relaxed and pleased']],
  fatigued_walk: ['P1', ['shoulders dropped, heavy left step', 'dragging passing pose', 'heavy right step']],
};
const WORK = {
  work_hammer: [['forge_work', 'leatherwork'], ['hammer raised', 'hammer striking', 'hammer rebounding', 'inspecting the work']],
  work_chop: [['timber_cutting', 'quarrying'], ['tool raised over the shoulder', 'tool swinging down', 'impact', 'pulling the tool free']],
  work_stir: [['field_kitchen'], ['ladle in the pot', 'stirring left', 'stirring right', 'tasting']],
  work_write: [['archive_work'], ['bent over a ledger', 'writing', 'dipping the quill', 'reading back']],
  work_tend: [['infirmary_rounds'], ['kneeling beside a cot', 'checking a bandage', 'offering water', 'sitting back']],
  work_watch: [['gate_watch', 'wall_patrol', 'field_survey'], ['looking ahead', 'head turned left', 'head turned right', 'shading the eyes']],
};
const covered = new Set(Object.values(WORK).flatMap(([j]) => j));
for (const j of jobs) if (!['hunter_drill', 'escort_duty', 'town_hunting'].includes(j) && !covered.has(j)) throw new Error(`11-animations: job ${j} has no work motion`);

const sheet = (arche, state, priority, poses, note) => ({
  id: `ANM_${arche.toUpperCase()}_${state.toUpperCase()}`, priority, kind: 'sheet', canvas: CELL, grid: { cols: poses.length },
  out: `art/characters/${arche}/keys/hunter_${arche}_${state}_keys_se@2x.png`,
  subject: `An animation keyframe reference sheet for an animator: ${LOOK[arche]}, facing south-east, performing "${state.replace(/_/g, ' ')}". The same character in every panel, same scale, feet on one shared baseline, plain neutral clothing so only the pose matters.${note ? ` ${note}` : ''}`,
  members: poses.map((p, i) => ({ id: `key_${i + 1}`, subject: p })),
});

const hunterSheets = archetypes.flatMap((a) => [
  ...Object.entries(STATES).map(([s, [p, poses]]) => sheet(a, s === 'attack' && a === 'adept' ? 'cast' : s, p,
    s === 'attack' && a === 'adept' ? ['gathering', 'shaping', 'shaping further', 'release — the key frame'] : poses)),
  ...Object.entries(WORK).map(([m, [jobList, poses]]) => sheet(a, m, 'P1', poses, `This one motion serves the jobs ${jobList.join(', ')}; the tool in hand is a separate layer.`)),
]);

const monsterSheets = monsters.flatMap((m) => {
  const look = `${m.name}, a ${m.tier} monster`;
  const core = {
    id: `ANM_${m.id.toUpperCase()}_CORE`, priority: ['moss_crawler', 'thicket_wasp'].includes(m.id) ? 'P0' : 'P2', kind: 'sheet',
    canvas: canvasFor(m), grid: { cols: 5 },
    out: `art/monsters/${m.id}/keys/monster_${m.id}_core_keys_se@2x.png`,
    subject: `An animation keyframe reference sheet of ${look}, matching its approved base sprite, facing south-east, feet on one shared baseline. Its core states.`,
    members: [
      { id: 'idle', subject: 'idle' }, { id: 'walk', subject: 'walking, mid-stride' }, { id: 'attack', subject: 'attacking, at the moment of impact' },
      { id: 'hit', subject: 'struck and recoiling' }, { id: 'death', subject: 'collapsed and still — no gore, it fades after a second' },
    ],
  };
  const skills = (m.skills ?? []).filter((s) => s.telegraphSeconds || s.healPower).map((s) => ({
    id: `ANM_${m.id.toUpperCase()}_${s.id.toUpperCase()}`, priority: 'P2', kind: 'sheet',
    canvas: canvasFor(m), grid: { cols: 4 },
    out: `art/monsters/${m.id}/keys/monster_${m.id}_${s.id}_keys_se@2x.png`,
    subject: s.healPower
      ? `An animation keyframe reference sheet of ${look} casting "${s.name}", a heal on an ally — its pose must point clearly at the ally it heals, so a player can see who healed the enemy.`
      : `An animation keyframe reference sheet of ${look} performing "${s.name}", a telegraphed ${s.aoe ? 'area' : 'single-target'} attack. The wind-up is held for ${s.telegraphSeconds} seconds in play, so the held pose must say "something is coming" by itself, without any effect, and show its direction${s.aoe ? ' and reach' : ' and its target'}.`,
    members: s.healPower
      ? [{ id: 'gather', subject: 'drawing in' }, { id: 'turn', subject: 'turning toward the ally' }, { id: 'release', subject: 'releasing the heal toward the ally' }, { id: 'recover', subject: 'recovering' }]
      : [{ id: 'windup_1', subject: 'the wind-up begins' }, { id: 'windup_2', subject: 'the wind-up deepens' }, { id: 'hold', subject: `the held telegraph pose, kept for ${s.telegraphSeconds} seconds` }, { id: 'release', subject: 'the release' }],
  }));
  return [core, ...skills];
});

export default {
  id: '11',
  title: 'Animation Keyframes',
  spec: 'art/specs/11-animations.md',
  groups: [
    { title: 'Hunter keyframes', note: 'Every state for every archetype skeleton, including the six shared work motions that serve the thirteen town jobs.', assets: hunterSheets },
    { title: 'Monster keyframes', note: 'Core states per monster, plus one sheet per telegraphed or healing skill in combat/monsters.json.', assets: monsterSheets },
  ],
};
