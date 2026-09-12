# Corrected blocking gate sheets v2

Built against baseline `be0ec97` from the generated drafts in `art/generated/gate-sheets-source-v1/`, the approved palette/grid references, the DL-069 chibi direction, and the latest machine-checked candidate sprites. The exact original generation prompts remain in `art/generated/gate-sheets-source-v1/README.md` and `art/generated/chibi-turnaround-source-v2/SCALE_PROMPT.md`.

**Status: OWNER REVIEW CANDIDATES.** These files are intentionally outside `art/reference-sheets/`. Copying them into that directory and marking the gates approved must happen only after the design owner approves each sheet.

## `ref_lighting_ball_corrected.png`

- Exact canvas: 416×128 pixels, comprising three 128×128 panels with two 16-pixel gaps.
- Exact order: sphere, corner-forward cube, upright cylinder.
- Five colors total, derived from the approved stone-grey five-step ramp.
- Warm upper-left highlight direction, cooler/darker right faces and low-value underside treatment.
- Each primitive sits on a small 2:1 grey diamond; no cast shadow is baked into the subject.
- Binary alpha, no pure black/white, no halo, text, frame or UI.

Codex visual review: **PASS candidate**. The three shapes agree on light direction and value hierarchy. Awaiting owner approval.

## `ref_scale_lineup_corrected.png`

- Exact canvas: 3008×440 pixels — nine 320×440 panels with eight 16-pixel gaps.
- Shared ground-contact baseline: y=380 in every panel.
- Exact order: tile, hunter, service NPC, trash monster, elite, boss, 2×2 cottage, tree, barrel.
- Exact measured targets:

| Member | Measured opaque bounds | Required scale |
|---|---:|---:|
| Tile | 128×64 | 128 px wide |
| Hunter | 54×112 | 112 px tall |
| Service NPC | 33×104 | 104 px tall |
| Trash monster | 72×56 | 72 px long |
| Elite | 48×112 | 112 px tall |
| Boss | 256×220 | 220 px tall, 2×2 footprint |
| Cottage | 277×232 | repository 2×2 T1 greybox massing |
| Tree | 130×160 | 160 px tall |
| Barrel | 29×36 | 36 px tall |

`ref_scale_lineup_review.png` is an exact nearest-neighbour 25% review copy. The full sheet has binary alpha and no pure black/white.

Codex visual review: **PASS candidate**. Relative scale, chibi proportions and the large boss/building reads remain clear in the compact review. Awaiting owner approval.

## Sources

- Hunter: `art/qa/proof-cycle-rigs-source-v2/hunter_vanguard_skel_idle_se_02@2x.png`
- Service NPC blocking stand-in: `art/qa/proof-cycle-rigs-source-v2/hunter_adept_skel_idle_se_02@2x.png`, normalized to 104 pixels
- Trash monster: `art/qa/proof-cycle-actors-source-v1/monster_moss_crawler_idle_se_01@2x.png`
- Cottage: `art/buildings/greybox/bld_bunkhouse_t1_r0@2x.png`
- Tree: `art/qa/trees-source-v1/prp_trees_broadleaf_medium_01@2x.png`
- Barrel: `art/qa/town-props-source-v1/prp_town_basic_barrel_01@2x.png`
- Tile, elite, boss and lighting primitives: exact blocking geometry constructed by `build.mjs` using the approved projection and palette helpers.

Run `node art/generated/gate-sheets-corrected-v2/build.mjs` from the repository root to reproduce all three PNGs byte-for-byte.
