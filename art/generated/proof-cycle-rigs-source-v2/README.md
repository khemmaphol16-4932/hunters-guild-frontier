# Optimized hunter rig source batch v2

Generated against `42ef42d` after Claude's review of the first chibi proportion proof. These files correct the two reported rig failures: each archetype now has a distinct body silhouette, and hair/outfits have been removed so the images can serve as paper-doll animation bases.

**Status:** source candidates. The originals are preserved here; deterministic runtime-size derivatives and QA sheets live in `art/qa/proof-cycle-rigs-source-v2/`. Nothing is approved or promoted to production.

## Exact prompt construction

Each built-in ImageGen call used the following shared block verbatim, followed by one archetype block verbatim.

### Shared block

> Hand-crafted isometric pixel art for a 2.5D management RPG. Crisp square pixel clusters on a strict grid, clean readable silhouette first, no anti-aliasing on the outer edge. True 2:1 dimetric projection, fixed camera viewed from above at 26.565 degrees. Grounded warm frontier fantasy, restrained palette, strong value separation. Single full-body subject, centred. Soft cute-chibi adult proportions about 1:4.5 head-to-height, slightly enlarged head and hands on a capable grounded body, standing 112 pixels tall in the intended 128 by 160 pixel @2x runtime canvas, feet meeting the ground at pivot 64,144. South-east three-quarter facing. Bald neutral base head because hair is a separate paper-doll layer. Only tiny two-pixel eyes; no other facial details. Skin visible only at head and hands. Featureless close-fitting neutral grey cloth base undergarment covering torso, hips, arms and legs; it must read as an animation rig layer, not an outfit. Empty hands, arms separated from torso for clean compositing. Fully transparent background, no shadow or ground. No hair, tunic, coat, robe, skirt, belt, boots, armor, weapon, jewelry, accessories, modern sportswear, exposed midriff, anatomical definition, muscles, gendered curves, heroic pose, action pose, anime face, mascot anatomy, glow, scenery, text, UI, frame, smooth painting or 3D render.

### `HUN_SKEL_VANGUARD`

> Use case: stylized-concept. Asset type: optimized HUN_SKEL_VANGUARD idle southeast base-rig source for Hunter's Guild: Frontier. [SHARED BLOCK] Archetype silhouette requirement: unmistakably broad shoulders, compact torso, weight low and centered, slightly wide planted feet, sturdy shins; a practical heavy-worker body that promises holds ground, without bodybuilding. Keep the stance symmetrical and stable. This silhouette must remain recognizably wider and lower than the adept and ranger even when all three use identical grey.

Visual review: broad, low, planted silhouette reads clearly. Candidate for machine QA and owner silhouette review.

### `HUN_SKEL_ADEPT`

> Use case: stylized-concept. Asset type: optimized HUN_SKEL_ADEPT idle southeast base-rig source for Hunter's Guild: Frontier. [SHARED BLOCK] Archetype silhouette requirement: unmistakably narrow shoulders, tall vertical torso line, feet close but balanced, upright attentive posture, forearms angled slightly forward with both hands clearly visible; a scholar who walks into dangerous country. No robe or staff: the narrow vertical body rig alone must distinguish the adept from the ranger and vanguard when all three use identical grey.

Visual review: narrow and vertical silhouette reads clearly. Source includes a dark low-alpha surround; the QA manifest requests deterministic dark-matte removal. Candidate only if the cleaned 0.55 sheet remains readable.

### `HUN_SKEL_RANGER`

> Use case: stylized-concept. Asset type: optimized HUN_SKEL_RANGER idle southeast base-rig source for Hunter's Guild: Frontier. [SHARED BLOCK] Archetype silhouette requirement: unmistakably lean and asymmetric, weight forward on the balls of the feet, one shoulder visibly lower, one foot half a step ahead, compact mobile stance that promises reads the ground. No bow or quiver yet: body posture alone must distinguish the ranger. Preserve intentional asymmetry so later facings can be authored rather than mirrored.

Visual review: lean, forward and asymmetric silhouette reads clearly without equipment. Candidate for machine QA and owner silhouette review.

## Optimization boundary

- Export at 128×160 `@2x`, pivot 64,144 and 112-pixel subject height.
- Generate exact-half 64×80 `@1x` with the repository exporter.
- Enforce binary alpha, no pure black/white and at most 32 colours.
- Do not promote, animate or derive other facings before owner approval of the turnaround/silhouette gate.
- Build hair, body variation, outfits and equipment as separate layers after the base rig passes.

## Local QA result

The deterministic export passes every machine gate for all three rigs. `art/qa/proof-cycle-rigs-source-v2/archetype_role_lineup.png` compares Vanguard, Adept and Ranger at 100% and 55% on Verdant grass. The width progression (54 / 36 / 45 pixels), stance and posture remain distinct at the reduced view. This is a Codex visual pass for review, not owner approval.
