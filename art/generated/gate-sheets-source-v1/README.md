# Gate and hunter reference source batch 01

Generated 2026-09-12 with the built-in image generation tool. Baseline coordination commits: `468e6db` and `100188c`. Source requirements: `art/ART_BIBLE.md` sections 4–13 and `art/prompts/00-reference-sheets.md`.

These are blocking drafts, not approved reference sheets. Do not copy them to `art/reference-sheets/` or use them to approve production assets before cleanup and owner review.

| File | ID | Review |
|---|---|---|
| ref_lighting_ball_draft.png | REF_LIGHTING_BALL | Correct three primitives and upper-left light read. Needs exact panel sizing, exact five-step ramp, binary-alpha validation and manual pixel cleanup. |
| ref_scale_lineup_draft.png | REF_SCALE_LINEUP | Contains all nine subjects in order and gives a useful relative silhouette study. Needs exact target heights and shared-baseline correction. |
| ref_hunter_turnaround_draft.png | REF_HUNTER_TURNAROUND | Three archetypes and four views are recognizable. Fails transparent-background requirement and is too detailed for the final 112px hunter; ranger quiver-side consistency and dimetric angle require correction. |

## Exact prompts

### REF_LIGHTING_BALL

Use case: stylized-concept
Asset type: REF_LIGHTING_BALL blocking reference sheet for Hunter's Guild: Frontier
Primary request: A strict pixel-art lighting reference sheet with exactly three primitive objects arranged left to right: sphere, cube with one corner toward viewer, upright cylinder. Each about equal height and aligned on one shared baseline. Each stands on its own small flat grey 2:1 diamond tile. Neutral five-step grey ramp. Warm key light from upper-left at 45 degrees, faint cool fill from upper-right, very faint warm underside bounce. Hard one-pixel local-dark outline. No cast shadow.
Style/medium: crisp low-resolution hand-placed pixel art, square pixels, limited dithering, true 2:1 dimetric projection at 26.565 degrees
Composition: one horizontal row, three equal panels, evenly spaced, generous transparent margins, each object complete and isolated
Constraints: truly transparent background outside the three small diamond tiles; no labels; no numbers; no UI; no frame; no watermark; hard binary silhouette alpha; no halo; no bloom; no smooth gradients; no antialiasing. This is a blocking draft to be corrected to exact 128x128 panels.

### REF_SCALE_LINEUP

Use case: stylized-concept
Asset type: REF_SCALE_LINEUP blocking reference sheet for Hunter's Guild: Frontier
Primary request: one wide pixel-art scale line-up containing exactly nine complete subjects on a shared baseline, left to right: flat 2:1 ground tile; adult frontier hunter; town service worker; dog-sized moss creature; tall thin elite creature; towering guardian boss on 2x2 footprint; small timber cottage on 2x2 footprint; broadleaf tree; wooden barrel. Use these relative target measurements: tile 128 px wide, hunter 112 px tall, worker 104 px tall, small creature 72 px long, elite 112 px tall, boss 220 px tall, tree 160 px tall, barrel 36 px tall. Keep every subject separate with no overlap.
Style/medium: deliberately plain blocking-pass pixel art, strict square pixel clusters, neutral limited palette, hard silhouettes, true 2:1 dimetric view at 26.565 degrees
Composition: very wide horizontal lineup, shared ground baseline, full subjects, transparent background
Lighting: warm upper-left key, faint cool upper-right fill
Constraints: exactly nine subjects in the listed order; no text, numbers, labels, UI, frame, cast shadows, halo, glow, gradients, antialiasing or background scenery. The output is a draft; dimensions will be corrected by hand.

### REF_HUNTER_TURNAROUND

Use case: stylized-concept
Asset type: REF_HUNTER_TURNAROUND blocking reference sheet for Hunter's Guild: Frontier
Primary request: A strict character turnaround sheet for exactly three adult frontier hunter archetypes, each shown in exactly four matching 2:1 dimetric facings. Arrange 3 rows by 4 columns. Row 1: the identical broad grounded vanguard facing southeast, southwest, northeast, northwest. Row 2: the identical tall attentive adept facing southeast, southwest, northeast, northwest. Row 3: the identical lean asymmetric ranger with quiver fixed on the right hip facing southeast, southwest, northeast, northwest. Neutral standing poses, arms slightly clear of body, practical plain frontier clothing, no weapons except the ranger's simple bow and quiver. Head-to-height ratio exactly 1:6; tiny implied facial features.
Style/medium: handcrafted low-resolution pixel art, crisp square pixel clusters, hard local-dark silhouette edges, restrained natural timber/leather/wool palette, true 2:1 dimetric camera at 26.565 degrees
Composition: 12 isolated full-body figures on one transparent sheet, identical scale, evenly spaced cells, shared foot baseline within each row, ample empty space, no overlap
Lighting: warm directional key from upper-left, faint cool upper-right fill
Constraints: preserve identity, proportions, clothing and equipment across all four views of each archetype. Transparent background, binary alpha, no floor or shadows. No text, labels, grid, UI, border, watermark, glow, halo, blur, smooth painting, 3D render, heroic pose, oversized armor, chibi or anime proportions. Blocking reference only, to be corrected to 128x160 pixel cells and 112px standing height.

## Required next work

1. Claude lane: construct REF_PALETTE_MASTER and REF_GRID_PROJECTION exactly, plus the export/validation tooling already listed on the work board.
2. Codex lane: clean these drafts onto the exact grid, validate silhouettes at 55%, and prepare owner-review candidates.
3. Promote only after all four gate sheets are approved. Production sprite candidates generated earlier remain candidates and do not bypass the gate.

