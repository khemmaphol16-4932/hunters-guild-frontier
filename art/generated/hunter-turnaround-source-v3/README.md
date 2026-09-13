# Hunter turnaround source v3

Generated with built-in ImageGen against baseline `6197150`, using the three optimized source rigs in `art/generated/proof-cycle-rigs-source-v2/` as identity/style references. These are source sheets. Deterministic normalized cells and owner-review sheets are written to `art/qa/hunter-turnaround-source-v3/` by `build.mjs`.

**Status: SOURCE CANDIDATES.** Do not animate or promote before owner approval of `REF_HUNTER_TURNAROUND`.

## Exact shared prompt

> Use case: stylized-concept. Asset type: REF_HUNTER_TURNAROUND archetype source sheet for Hunter's Guild: Frontier. Input image: exact identity, pixel style, neutral grey paper-doll base, proportions and south-east pose reference. Create exactly four isolated full-body views of the identical bald adult base rig in one horizontal row, ordered left to right: south-east front three-quarter, south-west front three-quarter, north-east back three-quarter, north-west back three-quarter. Soft cute-chibi adult proportion about 1:4.5 head-to-height; capable grounded body, slightly enlarged head and hands. Strict true 2:1 dimetric camera viewed from above at 26.565 degrees. Preserve identical head size, body mass, neutral-grey featureless close-fitting cloth undergarment, skin tone, palette, lighting from upper-left, hard local-dark outline and pixel density in every view. Arms slightly away from torso; empty hands. Back views show only the back of the bald head with no face. Fully transparent background with binary-looking hard alpha. Arrange on four equal 128x160 intended cells, identical 112px intended standing height and shared foot baseline, generous separation, no overlap. No hair, outfit, tunic, coat, robe, belt, footwear layer, armor, weapon, shield, staff, bow, quiver, accessory, shadow, floor, scenery, labels, grid, text, frame, halo, glow, antialiasing, smooth painting, detailed face, anime eyes, baby anatomy, extreme 1:3 mascot, 3D render, duplicate facing or mixed identities.

## Archetype suffixes

### Vanguard

> Archetype: VANGUARD. Preserve the reference's broad shoulders, compact torso, low centered weight, sturdy shins and slightly wide planted stance. Every facing must read broad and grounded without muscular anatomy. Keep the silhouette bilaterally stable across matching views.

`vanguard_turnaround_raw.png` contains a painted checkerboard despite the transparency request. `build.mjs` removes only high-value near-neutral pixels before sampling; the failed ImageGen background-extraction retry was discarded because it also painted the checkerboard.

### Adept

> Archetype: ADEPT. Preserve the reference's narrow shoulders, tall vertical torso, close balanced feet, attentive upright posture and forearms held slightly forward with hands visible. Every facing must read narrow and vertical without robes, staff or magic.

### Ranger

> Archetype: RANGER. Preserve the reference's lean asymmetric body, forward weight, lower right shoulder and one foot half a step ahead. The asymmetry stays attached to the same anatomical side in all four drawings; author south-west and north-west fresh, never mirror. Every facing must read mobile and alert without bow or quiver.

## Build and review

Run `node art/generated/hunter-turnaround-source-v3/build.mjs` from the repository root. The build divides each source into four ordered bands, isolates the subject, normalizes it to 112 pixels on a 128×160 cell at pivot 64,144, limits it to 32 colors, creates exact-half `@1x` files, and writes 100% and 55% review sheets. Originals are never overwritten.
