# MON_THICKET_WASP source v1

Generated 2026-09-15 with the built-in image generation tool against baseline `7b93bef`.
The Moss Crawler v2 QA sheet was supplied as a style and pixel-density reference only.

**Status: QA-PASSING SOURCE CANDIDATE.** This is not promoted and is not referenced by the runtime. The two
remaining art gates, `REF_LIGHTING_BALL` and `REF_SCALE_LINEUP`, still await owner approval.

| File | Asset | Review |
|---|---|---|
| `thicket_wasp_idle_se_candidate.png` | `MON_THICKET_WASP`, idle SE frame 01 | Strong amber/dark value separation and a clean airborne silhouette. The four wings, tucked legs and body segments remain distinct. Source alpha is soft and requires deterministic normalization before QA. |

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

## Source inspection

- Canvas: 1254 × 1254.
- Alpha: 1,370,724 transparent pixels; 1,091 opaque pixels; 200,701 partial-alpha pixels.
- The deterministic build passes canvas, binary-alpha, 24-colour-cap, pure-black/white and exact
  half-size checks. Codex visually passes the normalized sprite both singly and as a three-wasp
  overlap at 55% zoom. Owner review and the two blocking reference gates remain outstanding.
