# Master art overview v1

**Status: REVIEW BASELINE — static art first; animation deferred.**

Run `node art/qa/master-overview-v1/build.mjs` from the repository root. The deterministic board
contains only existing QA outputs; it does not promote or modify source art.

## Board map

- Upper left: the current town composition. Ground is a flat palette field and therefore exposes
  the missing P0 terrain/road/edge art.
- Upper right: current building category and Guild Hall tier greyboxes. These are scale/layout
  references, not finished art.
- Lower strip, left to right: Vanguard, Adept, Ranger, Moss Crawler, Thicket Wasp, three tree
  species, barrel, crate, handcart, firepit, lantern post.

## Static-art gap order

1. `ENV_TOWN_GROUND`, `ENV_ROAD`, `ENV_TOWN_EDGE`, `ENV_VERDANT_REACH`.
2. T1 static sprites for the six P0 buildings.
3. Hunter body/outfit/pack/equipment layers over the three approved silhouettes.
4. Remaining P0 props, resource icons, world drops, UI icons and map markers.
5. Rebuild this board as the proof-cycle scene, then begin animation only after visual approval.

The overview deliberately retains greyboxes so progress cannot be mistaken for finished art.
