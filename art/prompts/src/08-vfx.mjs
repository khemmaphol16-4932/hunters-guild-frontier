/**
 * specs/08-vfx.md — effect families tinted per element. Which skills each family covers is
 * checked against skills.json and monsters.json, so a new skill without an effect fails the build.
 */

import { data } from './lib.mjs';

const dir = 'art/vfx';
const statuses = Object.entries(data('combat/statuses.json')).find(([k, v]) => k !== '$comment' && Array.isArray(v))[1];

const family = (id, frames, cell, desc, { skills = [], monsterSkills = [], priority = 'P1', anchor = 'the target' } = {}) => ({
  id: `VFX_${id.toUpperCase()}`, priority, kind: 'sheet', canvas: cell, grid: { cols: Math.min(frames, 4) },
  covers: [...skills.map((s) => `skill:${s}`), ...monsterSkills.map((s) => `monsterSkill:${s}`)],
  out: `${dir}/vfx_${id}@2x.png`,
  subject: `A combat effect sprite sheet for a grounded frontier fantasy game, ${frames} frames of one effect: ${desc}. Anchored on ${anchor}. Restrained and readable rather than flashy — a few strong shapes, normal alpha only, at most 12 colours, drawn in a neutral grey ramp so it can be recoloured per element. It must never cover the unit it hits for more than two frames.`,
  members: Array.from({ length: frames }, (_, i) => ({ id: `frame_${i + 1}`, out: `${dir}/vfx_${id}_0${i + 1}@2x.png`, subject: `frame ${i + 1} of ${frames}` })),
});

export default {
  id: '08',
  title: 'VFX',
  spec: 'art/specs/08-vfx.md',
  groups: [
    {
      title: 'Skill effect families',
      note: 'Twelve families cover all 26 skills, tinted by the element ramps in the spec (O-5). Only fire and frost are in use; no storm, earth or reaction effects until the design exists.',
      assets: [
        family('impact_light', 4, [128, 128], 'a quick light hit — a small bright chip and two dust flecks', { skills: ['riposte'], monsterSkills: ['hamstring'], priority: 'P0' }),
        family('impact_heavy', 5, [128, 128], 'a heavy blow — a short wide shock crescent and a burst of dust', { skills: ['shield_bash'], monsterSkills: ['rend', 'sundering_blow', 'ashen_grasp', 'undertow'], priority: 'P0' }),
        family('projectile_arrow', 3, [128, 64], 'an arrow in flight with a short motion trail', { skills: ['piercing_shot'], anchor: 'the bow hand' }),
        family('projectile_bolt', 4, [128, 64], 'a lobbed or thrown bolt of energy with a short trail, recolourable to fire', { skills: ['ember_lance'], monsterSkills: ['molten_arc'], anchor: 'the casting hand' }),
        family('chain', 6, [192, 96], 'a chain of linked shapes snapping from the caster to the target and tightening, recolourable to frost', { skills: ['frost_chain'], monsterSkills: ['binding_silk'] }),
        family('heal_burst', 6, [128, 128], 'a soft upward burst of healing with a visible thread back toward whoever cast it', { skills: ['mend'], monsterSkills: ['mend_kin', 'weave_mend', 'many_voices'] }),
        family('heal_over_time', 4, [128, 128], 'a gentle looping motes-and-ring effect of lingering healing', { skills: ['renewal'] }),
        family('aura_guard', 4, [128, 160], 'a looping protective stance aura: a low ground ring and a faint braced outline', { skills: ['guard_stance', 'last_stand'] }),
        family('mark_threat', 4, [64, 64], 'a looping small mark above an enemy that has been taunted, drawing its attention', { skills: ['taunt'], anchor: 'the space above the target\'s head' }),
        family('rally', 8, [256, 160], 'a rallying pulse spreading outward from a hunter along the ground to nearby allies', { skills: ['rally'], priority: 'P2', anchor: 'the ground at the caster' }),
        family('volley', 8, [256, 192], 'a volley of arrows arcing down across an area', { skills: ['culling_volley'], priority: 'P2', anchor: 'the ground at the target area' }),
        family('area_wave', 8, [384, 256], 'a wave sweeping across the ground in a wide arc, recolourable to fire or frost', { monsterSkills: ['cinder_sweep', 'dirge', 'final_verse'], priority: 'P2', anchor: 'the ground at the caster' }),
      ],
    },
    {
      title: 'Telegraphs',
      note: 'Two frames each — outline and fill. Code grows the fill over each skill\'s telegraphSeconds from monsters.json, so one asset serves every telegraphed skill and can never drift from the timing the Hunter AI reacts to. Coloured in the region\'s zone hue at runtime.',
      assets: [
        {
          id: 'VFX_TELEGRAPH_AREA', priority: 'P1', kind: 'sheet', canvas: [256, 128], out: `${dir}/vfx_telegraph_area@2x.png`,
          subject: 'A ground-projected area warning marker for boss attacks, lying flat on the ground in true 2:1 dimetric, drawn in white so it can be tinted.',
          members: [
            { id: 'outline', out: `${dir}/vfx_telegraph_area_outline@2x.png`, subject: 'a clean elliptical outline with small inward-pointing ticks' },
            { id: 'fill', out: `${dir}/vfx_telegraph_area_fill@2x.png`, subject: 'a solid hatched fill texture of the same ellipse' },
          ],
        },
        {
          id: 'VFX_TELEGRAPH_TARGET', priority: 'P1', kind: 'sheet', canvas: [128, 64], out: `${dir}/vfx_telegraph_target@2x.png`,
          subject: 'A ground ring that marks the one hunter a boss has chosen, lying flat under their feet in true 2:1 dimetric, drawn in white so it can be tinted, and different in shape from a selection ring.',
          members: [
            { id: 'outline', out: `${dir}/vfx_telegraph_target_outline@2x.png`, subject: 'a ring broken into four arcs with a small notch at each gap' },
            { id: 'fill', out: `${dir}/vfx_telegraph_target_fill@2x.png`, subject: 'a closing inner fill texture for the same ring' },
          ],
        },
      ],
    },
    {
      title: 'Statuses',
      note: 'Exactly the statuses in combat/statuses.json.',
      assets: statuses.map((s) => ({
        ...family(`status_${s.id}`, 6, [64, 64], {
          burn: 'two or three small flame tongues at the shoulders',
          bleed: 'an occasional dark drop falling from the torso, restrained — no spray, no pooling',
          slow: 'frost-white drag lines at the feet',
          stun: 'small marks orbiting above the head',
        }[s.id] ?? `a small looping mark for the ${s.name ?? s.id} status`, { anchor: s.id === 'slow' ? 'the ground at the target' : 'the target', priority: 'P1' }),
        covers: [`status:${s.id}`],
      })),
    },
    {
      title: 'World feedback',
      assets: [
        { ...family('selection_ring', 4, [128, 64], 'a looping ground ring under the selected hunter or building, lying flat in 2:1 dimetric', { priority: 'P0', anchor: 'the ground point' }) },
        { ...family('downed', 4, [128, 64], 'a slow pulsing ground ring in soft healer green #5fbf87 that reads as downed and waiting for rescue, never as death', { priority: 'P0', anchor: 'the ground under the downed hunter' }) },
        { ...family('loot_pickup', 6, [64, 64], 'a small landing puff of dust, then a brief spark as the item is picked up', { priority: 'P0', anchor: 'the ground where the item lands' }) },
        { ...family('rescue', 6, [128, 128], 'a rescue: a brief bracing shimmer as one hunter drags another to safety', { skills: ['drag_to_safety'] }) },
        { ...family('level_up', 8, [96, 192], 'a brief column of warm lantern-gold light rising around a hunter', { anchor: 'the ground at the hunter' }) },
        { ...family('build_complete', 6, [256, 160], 'dust settling as scaffolding comes down from a finished building', { anchor: 'the building footprint' }) },
        { ...family('the_song', 8, [256, 128], 'faint concentric ripples spreading across still water in a slow rhythm — sound made visible', { priority: 'P2', anchor: 'still water' }), covers: ['hazard:the_song'] },
        { ...family('world_boss_arrival', 12, [640, 512], 'water sheeting off a huge drowned mass as it rises out of dry grey ash', { priority: 'P2', anchor: 'the world boss\'s footprint' }) },
      ],
    },
  ],
};
