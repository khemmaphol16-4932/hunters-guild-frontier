# Proof-cycle actor source batch v1

Generated against baseline `16ca3bc` for visual-direction review. These are oversized source images, not runtime sprites. Nothing in this folder is approved for production or referenced by the game.

## `vanguard_idle_se_rejected.png`

**Status:** Rejected source reference.

The silhouette is too muscular and hero-specific, the face is too detailed, and the clothing reads as modern sportswear. It is retained to document the failed direction and must not be promoted.

**Exact generation prompt**

> Use case: stylized-concept. Asset type: HUN_SKEL_VANGUARD idle southeast source candidate for Hunter's Guild: Frontier. One cute but capable adult human vanguard, soft chibi 1:4.5 head-to-height proportion, broad shoulders, compact planted body, weight low and centered, practical neutral-grey fitted undergarment only for paper-doll layering, arms slightly away from torso, empty hands, no equipment, no armor. True 2:1 dimetric southeast facing, same persistent world scale for town, road and combat. Handcrafted low-resolution pixel art, crisp square pixel clusters, hard local-dark outline, restrained <=32-color intent, warm upper-left light, faint cool fill. Intended 128x160 @2x canvas, standing height 112px, feet aligned to bottom-center pivot 64,144. Fully transparent background, no floor or shadow. No text, UI, card frame, halo, glow, anime eyes, baby anatomy, extreme 1:3 mascot, hero pose, weapons, cape, detailed face, smooth painting or 3D render.

## `vanguard_idle_se_candidate.png`

**Status:** Source candidate for Claude QA and later manual pixel cleanup.

The second pass restores a modest frontier under-layer, quiet face, compact adult chibi proportion, and equipment-safe silhouette. Before any runtime use it still needs strict 2:1 camera verification, reduction to the authored canvas, palette enforcement, alpha cleanup, pivot validation, and an owner-approved gate comparison.

**Exact generation prompt**

> Use case: stylized-concept. Asset type: HUN_SKEL_VANGUARD idle southeast source candidate for Hunter's Guild: Frontier. One adult androgynous frontier vanguard base rig for modular paper-doll equipment, soft cute-chibi proportion exactly about 1:4.5 head-to-height. Compact sturdy silhouette with broad shoulders and planted stance, but no visible muscle definition and no heroic posing. Wear only a simple modest sleeveless neutral-grey knee-length frontier under-tunic over close plain trousers and soft boots; no exposed midriff, no modern sportswear, no armor, no weapons, no accessories. Plain short hair, tiny two-pixel eyes, nearly featureless calm face, no makeup or personality-specific markings. Arms held slightly away from torso, empty hands visible. Strict true 2:1 dimetric three-quarter southeast view, body axis aligned to the shared town/road/combat camera, weight low and centered. Handcrafted low-resolution pixel art, crisp square pixel clusters, hard local-dark outline, restrained <=32-color intent, warm upper-left light and faint cool fill. Intended 128x160 @2x canvas, standing height about 112px, feet aligned to bottom-center pivot 64,144. Fully transparent background, no floor, no shadow, no scenery. No text, UI, card frame, halo, glow, anime eyes, baby anatomy, extreme 1:3 mascot proportions, exaggerated curves, detailed face, smooth painting, antialiasing or 3D render.

## `moss_crawler_idle_se_candidate.png`

**Status:** Source candidate for Claude QA and later manual pixel cleanup.

The low six-legged silhouette, stone back, and moss mass read well at a glance. Before runtime use it needs camera and leg-count checks, reduction to the authored canvas, palette enforcement, alpha cleanup, pivot validation, and an owner-approved gate comparison.

**Exact generation prompt**

> Use case: stylized-concept. Asset type: MON_MOSS_CRAWLER idle southeast source candidate for Hunter's Guild: Frontier. One dog-sized low moss crawler from the safe Verdant Reach: squat six-legged forest scavenger with a broad stone-like back covered in clumped moss, small alert head, sturdy short legs, friendly-readable silhouette but clearly a wild combat creature. No horns, skull face or gore. True 2:1 dimetric southeast facing, same world camera used for town and combat. Handcrafted low-resolution pixel art, crisp square pixel clusters, hard local-dark outline, restrained <=32-color intent, Verdant greens #4e6b45 and #82905b, stone #8d8a80, slate shadow #3e4a5c, warm upper-left light. Intended 128x128 @2x canvas, about 72px long, bottom-center ground pivot. Fully transparent background, no ground, shadow, scenery, text, UI, halo, glow, particles, smooth painting, chibi mascot face or 3D render.

## Promotion rules

- Treat every PNG here as source material only.
- Do not add these files to runtime manifests.
- Preserve the rejected file as negative-direction evidence.
- Build cleaned derivatives in a new folder; never overwrite these originals.
- Require the repository art gates and explicit approval before promotion.
