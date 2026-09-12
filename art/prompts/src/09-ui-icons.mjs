/**
 * specs/09-ui-icons.md — every set is one sheet, so its members share one look by construction,
 * and every data-backed set is read from src/data.
 */

import { data } from './lib.mjs';

const dir = 'art/ui/icons';
const CELL = [96, 96];
const firstArray = (o) => Object.entries(o).find(([k, v]) => k !== '$comment' && Array.isArray(v))[1];

const set = (id, title, members, { priority = 'P1', cols = Math.min(members.length, 5), extra = '' } = {}) => ({
  id: `ICO_${id.toUpperCase()}`, priority, kind: 'sheet', canvas: CELL, grid: { cols },
  out: `${dir}/${id}/icon_${id}_sheet@2x.png`,
  subject: `A user-interface icon sheet for a frontier guild management game: the ${title} set. Each icon is one clear physical object from the game world rather than an abstract glyph, centred in its panel with a 4-pixel margin, a 1-pixel outline in a darker shade of its own colour, lit from the upper left, on transparency, no frame. Every icon must read instantly at 24 by 24 pixels, and the whole set must look like one family. ${extra}`,
  members: members.map(([mid, subject, cover]) => ({ id: mid, out: `${dir}/${id}/icon_${id}_${mid}@2x.png`, subject, covers: cover ? [cover] : [] })),
});

const need = (map, ids, kind, file) => ids.map((i) => [i, map[i] ?? (() => { throw new Error(`09-ui-icons: no ${file} icon for ${i}`); })(), `${kind}:${i}`]);

const jobs = firstArray(data('town/jobs.json')).map((j) => j.id);
const departments = firstArray(data('town/departments.json')).map((d) => d.id);
const personalities = firstArray(data('personalities.json')).map((p) => p.id);
const notifications = data('ui/notifications.json').priorities;
const categories = Object.keys(data('town/buildings.json').categories).filter((k) => !k.startsWith('$'));
const slots = data('items/item-types.json').slots;
const statuses = firstArray(data('combat/statuses.json')).map((s) => s.id);
const resources = data('economy/resources.json').resources;
const rarities = data('items/rarities.json').rarities;

export default {
  id: '09',
  title: 'UI Icons',
  spec: 'art/specs/09-ui-icons.md',
  groups: [
    {
      title: 'Core sets',
      assets: [
        set('control', 'interface controls', [
          ['build', 'a hammer resting on a plank'], ['hunters', 'three hunters\' hoods side by side'], ['guild_affairs', 'a guild pennant on a pole'],
          ['expeditions', 'a road marker post pointing outward'], ['speed_1', 'one chevron pointing right'], ['speed_2', 'two chevrons pointing right'],
          ['speed_4', 'four chevrons pointing right'], ['zoom_in', 'a brass magnifier with a small plus notch'], ['zoom_out', 'a brass magnifier with a small minus notch'],
          ['center', 'a compass rose'], ['notices', 'a hand bell'], ['settings', 'a key ring'], ['close', 'two crossed sticks'],
        ], { priority: 'P0', extra: 'The three speed icons differ only by chevron count, never by colour. There is no pause icon.' }),
        set('attribute', 'hunter attributes', [
          ['str', 'a clenched fist gripping a coil of rope', 'attribute:str'], ['agi', 'a feather', 'attribute:agi'], ['vit', 'a heart-shaped hearthstone', 'attribute:vit'],
          ['dex', 'a needle and thread', 'attribute:dex'], ['int', 'an open book', 'attribute:int'], ['luk', 'a knucklebone die', 'attribute:luk'],
        ], { priority: 'P0', cols: 6 }),
        set('role', 'combat roles', [
          ['tank', 'a shield, flat top and tapered base, in blue #5b8dd6', 'role:tank'], ['healer', 'a plain cross in green #5fbf87', 'role:healer'],
          ['damage', 'an upward chevron in red #d4685f', 'role:damage'], ['support', 'a circle in violet #b58bd6', 'role:support'], ['control', 'a diamond in teal #4fb0b8', 'role:control'],
        ], { priority: 'P0', extra: 'Each role must also be recognisable in greyscale by its shape.' }),
        set('resource', 'resources, for the resource bar', [
          ...resources.map((r) => [r.id, { gold: 'a tied coin pouch', food: 'a sack of provisions', materials: 'a timber plank and stone block', iron: 'an iron bar', salvage: 'a bundle of scrap', warding_salt: 'a sealed salt jar', essence: 'a stoppered cloudy vial', insight_crystal: 'a clear crystal' }[r.id] ?? r.name, `resource:${r.id}`]),
          ['residents', 'a small house with one lit window'],
        ], { priority: 'P0' }),
        set('condition', 'hunter condition', [
          ['hunger', 'an empty wooden bowl'], ['fatigue', 'a guttering candle stub'], ['morale_high', 'a small banner raised high'],
          ['morale_low', 'the same small banner drooping'], ['friendship', 'two clasped hands'],
        ], { priority: 'P0' }),
      ],
    },
    {
      title: 'Data-backed sets',
      assets: [
        set('notification', 'notice kinds', need({
          hunterDied: 'a lowered, furled banner — never a skull', townBreached: 'a broken palisade stake', worldBossAppeared: 'a drowned bronze bell',
          legendaryFound: 'an item with a notched legendary frame corner', stageReached: 'a raised town banner', researchCompleted: 'a brass instrument',
          contractResolved: 'a sealed contract', worldBossDefeated: 'a bell hanging still on a bracket', endlessRecord: 'a notched depth post',
          rareFound: 'an item with a plain rare frame corner', frontierEntered: 'a trail cairn', townDefended: 'an upright shield on a wall',
          hunterLeveled: 'a small upward notch on a staff', rescue: 'an arm around a shoulder', bossDefeated: 'a lowered boss crest',
        }, Object.keys(notifications), 'notification', 'notification'), { extra: 'Critical kinds — hunterDied, townBreached, worldBossAppeared, legendaryFound — carry a heavier 2-pixel outline.' }),
        set('job', 'town jobs', need({
          hunter_drill: 'a wooden practice sword', escort_duty: 'a lantern on a pole', forge_work: 'a smith\'s hammer', leatherwork: 'a curved leather knife',
          timber_cutting: 'a felling axe', quarrying: 'a pick', field_kitchen: 'a ladle', archive_work: 'a quill', field_survey: 'a spyglass',
          gate_watch: 'a gate key', wall_patrol: 'a spear', infirmary_rounds: 'a rolled bandage', town_hunting: 'a hunting bow',
        }, jobs, 'job', 'job')),
        set('building_category', 'building categories — the same silhouettes as the kit identity parts', need({
          management: 'a bell tower', housing: 'a row of shuttered windows', services: 'an open counter with steam', healing: 'a porch with hanging herbs',
          revival: 'a standing stone with a brazier', crafting: 'a forge chimney', economy: 'a loading platform with crates', research: 'a roof lantern with a vane',
          defense: 'a crenellated parapet', recruitment: 'a gate arch with a notice board',
        }, categories, 'buildingCategory', 'building category')),
        set('equipment_slot', 'empty equipment slots, drawn as pale 40-percent outlines', need({
          weapon: 'a blade outline', offhand: 'a round shield outline', head: 'a helm outline', body: 'a cuirass outline',
          hands: 'a glove outline', feet: 'a boot outline', trinket: 'a charm-on-a-cord outline',
        }, slots, 'slot', 'slot')),
        set('status', 'combat statuses', need({
          burn: 'a small flame', bleed: 'a single dark drop', slow: 'a boot held by frost', stun: 'three small orbiting marks',
        }, statuses, 'status', 'status')),
        set('department', 'guild departments', need({
          hunter: 'a hunter\'s hood', defense: 'a round shield', resource: 'a sack and pick', crafting: 'an anvil', research: 'an open book with a lens',
        }, departments, 'department', 'department'), { priority: 'P2' }),
        set('personality', 'hunter personalities — none reads as good or bad', need({
          cautious: 'a lantern held low', reckless: 'a thrown die', stoic: 'a standing stone', protective: 'an arm raised to shelter',
          methodical: 'a set square', opportunist: 'an open hand catching a coin',
        }, personalities, 'personality', 'personality'), { priority: 'P2', cols: 6 }),
      ],
    },
    {
      title: 'Frames',
      assets: [
        {
          id: 'ICO_RARITY_FRAME', priority: 'P1', kind: 'sheet', canvas: CELL, grid: { cols: 6 }, out: `${dir}/frames/icon_rarity_frames@2x.png`,
          subject: 'A sheet of empty square item frames for inventory icons, one per rarity, each different in shape as well as colour so rarity survives colour-blindness. Empty centres, transparent.',
          members: rarities.map((r, i) => ({
            id: r.id, covers: [`rarity:${r.id}`], out: `${dir}/frames/icon_frame_${r.id}@2x.png`,
            subject: `${r.name}, ${r.colour}: ${['a plain 1-pixel frame', 'a 1-pixel frame with corner ticks', 'a 2-pixel frame', 'a 2-pixel frame with notched corners', 'a 2-pixel frame with notched corners and an inner line', 'a 3-pixel frame with notched corners, an inner line and corner studs'][i] ?? 'a distinct frame'}`,
          })),
        },
        {
          id: 'ICO_FRAME_SELECTED', priority: 'P1', kind: 'icon', canvas: CELL, out: `${dir}/frames/icon_frame_selected@2x.png`,
          subject: 'An empty square selection frame for a pressed icon button: a 2-pixel warm lantern-gold border with small inward corner brackets, empty and transparent in the centre.',
        },
      ],
    },
  ],
};
