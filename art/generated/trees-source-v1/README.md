# Tree source generations — 2026-09-12

GitHub baseline: `437d731` (origin/main fetched successfully). Local category-05 spec additions were also consulted and preserved.

Generated using the built-in image generation tool. Status: SOURCE CANDIDATES, NOT SHIPPING SPRITES. Visual review finds soft halos and inconsistent pixel density; transparency, palette cap, target dimensions and zoom readability have not passed production QA. No runtime references added.

Files: broadleaf.png, conifer.png, birch.png. IDs: PRP_TREES_BROADLEAF_MEDIUM, PRP_TREES_CONIFER_MEDIUM, PRP_TREES_BIRCH_MEDIUM.

Intended target: 96x128 @1x / 192x256 @2x; medium tree 80px @1x; bottom-centre ground-contact pivot to be measured after cleanup; 1x1 footprint. Follow ART_BIBLE sections 4–9 and specs/05-props.md. Remove halos, produce binary alpha, establish a consistent pixel grid and <=24 colours, measure pivot, then test at 0.55 zoom before promotion. These generations do not approve pending architecture decisions or replace the modular production plan.

## Exact prompts

### Broadleaf

Use case: stylized-concept. Asset: PRP_TREES_BROADLEAF_MEDIUM source sprite for Hunter's Guild: Frontier, per art/ART_DIRECTION.md and art/specs/05-props.md citing ART_BIBLE sections 4-9. Generate ONE isolated medium broadleaf frontier tree with a rounded irregular canopy, sturdy short visible trunk, clear readable silhouette. Premium pixel art with crisp square pixel clusters, low-resolution sprite appearance, no smooth painting, no 3D. Fixed 2:1 dimetric view from above 26.565 degrees, warm upper-left daylight, cool slate shadows. Restrained 24-color appearance: canopy #4e6b45, grass-green #82905b, moss #6f7f4e, timber #8a5c3b and #54382a, shadow #3e4a5c. Intended eventual canvas 192x256 @2x (96x128 @1x), tree 160 px high at target @2x, bottom ground-contact pivot with transparent padding. Portrait composition. Truly transparent background, no floor, ground island, cast shadow, scenery, text, labels, border or watermark. Single tree only. No neon, functional blue/purple/red accents. This is a source sprite candidate, preserve simple chunky pixel clusters suitable for pixel cleanup.

### Conifer

Use case: stylized-concept. Asset: PRP_TREES_CONIFER_MEDIUM source sprite for Hunter's Guild: Frontier, per art/ART_DIRECTION.md and art/specs/05-props.md citing ART_BIBLE sections 4-9. Generate ONE isolated medium conifer frontier tree with a narrow triangular layered evergreen silhouette and a visible short trunk, clear readable silhouette. Premium pixel art with crisp square pixel clusters, low-resolution sprite appearance, no smooth painting, no 3D. Fixed 2:1 dimetric view from above 26.565 degrees, warm upper-left daylight, cool slate shadows. Restrained 24-color appearance: canopy #4e6b45, grass-green #82905b, moss #6f7f4e, timber #8a5c3b and #54382a, shadow #3e4a5c. Intended eventual canvas 192x256 @2x (96x128 @1x), tree 160 px high at target @2x, bottom ground-contact pivot with transparent padding. Portrait composition. Truly transparent background, no floor, ground island, cast shadow, scenery, text, labels, border or watermark. Single tree only. No neon, functional blue/purple/red accents. This is a source sprite candidate, preserve simple chunky pixel clusters suitable for pixel cleanup. CRITICAL: hard crisp outer silhouette with NO HALO, no glow, no bloom, no soft gradient around the tree; all space outside tree must be alpha zero.

### Birch

Use case: stylized-concept. Asset: PRP_TREES_BIRCH_MEDIUM source sprite for Hunter's Guild: Frontier, per art/ART_DIRECTION.md and art/specs/05-props.md citing ART_BIBLE sections 4-9. Generate ONE isolated medium birch frontier tree with a slender pale warm-grey bark trunk with dark horizontal markings and a sparse airy rounded green canopy, clear readable silhouette. Premium pixel art with crisp square pixel clusters, low-resolution sprite appearance, no smooth painting, no 3D. Fixed 2:1 dimetric view from above 26.565 degrees, warm upper-left daylight, cool slate shadows. Restrained 24-color appearance: canopy #4e6b45, grass-green #82905b, moss #6f7f4e, timber #8a5c3b and #54382a, shadow #3e4a5c. Intended eventual canvas 192x256 @2x (96x128 @1x), tree 160 px high at target @2x, bottom ground-contact pivot with transparent padding. Portrait composition. Truly transparent background, no floor, ground island, cast shadow, scenery, text, labels, border or watermark. Single tree only. No neon, functional blue/purple/red accents. This is a source sprite candidate, preserve simple chunky pixel clusters suitable for pixel cleanup. CRITICAL: hard crisp outer silhouette with NO HALO, no glow, no bloom, no soft gradient around the tree; all space outside tree must be alpha zero.

