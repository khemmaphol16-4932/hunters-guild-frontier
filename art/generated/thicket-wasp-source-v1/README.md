# MON_THICKET_WASP source v1

Generated 2026-09-15 with the built-in image generation tool against baseline `7b93bef`.
The Moss Crawler v2 QA sheet was supplied as a style and pixel-density reference only.

**Status: QA-PASSING SOURCE CANDIDATE.** This is not promoted and is not referenced by the runtime. The two
remaining art gates, `REF_LIGHTING_BALL` and `REF_SCALE_LINEUP`, still await owner approval.

| File | Asset | Review |
|---|---|---|
| `thicket_wasp_idle_se_candidate.png` | `MON_THICKET_WASP`, idle SE frame 01 | Strong amber/dark value separation and a clean airborne silhouette. The four wings, tucked legs and body segments remain distinct. Source alpha is soft and requires deterministic normalization before QA. |
| `thicket_wasp_idle_ne_candidate.png` | `MON_THICKET_WASP`, idle NE frame 01 | Back-three-quarter authored facing preserves identity, banding, four wings and tucked legs. Source alpha is soft and requires deterministic normalization before QA. |
| `thicket_wasp_idle_se_frame02_candidate.png` | `MON_THICKET_WASP`, idle SE frame 02 v1 | Rejected after normalization: only three wing shapes remained clearly countable. Preserved for provenance. |
| `thicket_wasp_idle_se_frame02-v2_candidate.png` | `MON_THICKET_WASP`, idle SE frame 02 v2 | Corrected downstroke with four separately readable wing shapes. |

## Exact prompt

```text
Use case: stylized-concept.
Asset type: source candidate for MON_THICKET_WASP, a P0 game creature sprite for Hunter's Guild: Frontier.
Input image: style and scale-density reference only (the existing Moss Crawler QA sheet); do not copy its creature anatomy or make a composite.
Primary request: Create one isolated Thicket Wasp, a wasp the size of a small bird, amber with dark bands, two pairs of flat translucent wings drawn as 2–3 simple pixel clusters per wing pair, legs tucked, hovering. The swarm read matters: keep the silhouette exceptionally clean so three overlapping copies can still be counted at 55% game zoom.
Style/medium: premium hand-crafted isometric pixel art; crisp hand-placed pixels on a strict grid; hard local-dark one-pixel outer outline; limited deliberate dithering; restrained palette; no anti-aliasing on the silhouette.
Composition/framing: one subject only, centered on a transparent 128×128-style square canvas; true 2:1 dimetric projection viewed from above at 26.565 degrees; facing south-east; neutral idle mid-wing-beat pose; approximately 60 source pixels across after normalization; body hovering 20 source pixels above ground pivot; leave clear transparent margin on all sides.
Lighting/mood: warm key light from upper-left, subtle cool fill; grounded frontier fantasy, common nuisance rather than cute or terrifying.
Color palette: honey amber, muted ochre, very dark brown-charcoal bands and outline, pale desaturated translucent wings; strong value separation against Verdant Reach olive grass.
Constraints: exactly one wasp; exactly two pairs of wings; readable abdomen/head/thorax separation; legs tucked; no cast shadow or ground plate; genuinely transparent background; clean hard alpha; no text, UI, border, watermark, signature, halo, glow, scenery, flowers, nest, honeycomb, multiple creatures, sprite sheet, photorealism, 3D render, smooth vector art, anime, mascot, kawaii, Pokemon styling, gore, excessive eyes or teeth, armor, spikes, neon, full-frame flashing effect.
```

## Exact north-east edit prompt

```text
Use case: precise-object-edit.
Asset type: MON_THICKET_WASP north-east authored facing source for Hunter's Guild: Frontier.
Input image: exact edit target and identity reference—the QA-passing south-east idle candidate.
Primary request: redraw the identical Thicket Wasp from the north-east back three-quarter direction. Change only the facing and necessary perspective/occlusion. Show more of the back of the head and thorax while keeping the same wasp identity.
Invariants: preserve exact anatomy, relative body proportions, honey-amber and dark band pattern, four distinct flat translucent wings, tucked legs, neutral mid-wing-beat hover pose, crisp pixel density, one-pixel local-dark outline, restrained 24-color feeling, upper-left lighting, and body hovering above the ground point. Maintain a clean countable silhouette for a three-wasp swarm at 55% zoom.
Composition: exactly one isolated subject, centered with generous transparent margin, true 2:1 dimetric projection viewed from above at 26.565 degrees, facing north-east, intended normalization to about 60 pixels across on 128×128 @2x canvas.
Constraints: genuinely transparent background and hard clean alpha; no cast shadow, floor, ground plate, halo, glow, scenery, nest, honeycomb, extra wasps, sprite sheet, text, UI, watermark, smooth painting, 3D render, vector art, cute mascot styling, gore, armor, spikes, or additional wings.
```

## Exact frame-02 edit prompt

```text
Use case: precise-object-edit.
Asset type: MON_THICKET_WASP idle animation frame 02 source for Hunter's Guild: Frontier.
Input image: exact edit target and identity reference—the normalized south-east idle frame 01.
Primary request: create the next frame of a subtle four-frame hovering idle loop. Change only the wing beat and vertical hover: rotate/fold both pairs of wings slightly downward and backward into a clear mid-downstroke, and raise the entire body by a very small amount. Keep the abdomen, thorax, head, band pattern, tucked legs, facing and perspective identical. This is a restrained adjacent animation frame, not a new pose.
Invariants: identical Thicket Wasp identity and proportions; exactly two pairs of wings; south-east facing; crisp hand-placed pixel art; hard local-dark outline; same honey amber, ochre, dark brown-charcoal and pale wing palette; same upper-left light; true 2:1 dimetric view at 26.565 degrees; countable in a three-wasp swarm at 55% zoom.
Composition: exactly one isolated subject centered with generous transparent margin, intended normalization to about 60 pixels across on 128×128 @2x canvas, hovering 20–22 pixels above the ground pivot.
Constraints: genuinely transparent background; no shadow, floor, halo, glow, motion blur, wing duplicates, extra creature, scenery, sprite sheet, text, UI, watermark, smooth painting, 3D render, cute mascot styling, or anatomy changes.
```

## Exact frame-02 correction prompt

```text
Use case: precise-object-edit.
Asset type: corrected MON_THICKET_WASP idle south-east frame 02 source.
Input image: edit target—the current normalized frame 02, whose identity, downstroke pose and palette must be preserved.
Primary request: correct only the wing readability. The wasp must show exactly four individually countable wing shapes (two anatomical pairs) in this south-east downstroke: one large near forewing, one smaller near hindwing, one large far forewing, one smaller far hindwing. Separate their silhouettes by at least a narrow dark pixel gap or overlap boundary so all four remain countable after reduction to about 60 pixels wide. Do not add more than four wings.
Invariants: keep the head, thorax, abdomen, antennae, tucked legs, amber/dark bands, body proportions, south-east facing, true 2:1 dimetric perspective, upper-left lighting, hover height and restrained crisp pixel-art style unchanged. Preserve the subtle down-and-back wing angle of animation frame 02.
Composition: one isolated wasp centered on a genuinely transparent square canvas with generous margin; intended 128×128 @2x normalization and 55% gameplay readability.
Constraints: change only wing separation/readability; no anatomy drift, body recolor, extra legs, extra creature, shadow, floor, glow, halo, motion blur, scenery, sprite sheet, text, UI, watermark, smooth painting, 3D render, or cute mascot styling.
```

## Source inspection

- Canvas: 1254 × 1254.
- Alpha: 1,370,724 transparent pixels; 1,091 opaque pixels; 200,701 partial-alpha pixels.
- The deterministic build passes canvas, binary-alpha, 24-colour-cap, pure-black/white and exact
  half-size checks. Codex visually passes the normalized sprite both singly and as a three-wasp
  overlap at 55% zoom. Owner review and the two blocking reference gates remain outstanding.
