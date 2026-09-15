# QA — Thicket Wasp source v1

Sources: `art/generated/thicket-wasp-source-v1/thicket_wasp_idle_se_candidate.png`, `art/generated/thicket-wasp-source-v1/thicket_wasp_idle_ne_candidate.png` · deterministic batch-local normalization using `art/tools/sprite.mjs`.

| | |
|---|---|
| SE output | subject 60×54 on 128×128 |
| SE frame 02 | subject 60×48 on 128×128 |
| SE frame 03 | subject 72×39 on 128×128 |
| SE frame 04 | subject 55×55 on 128×128 |
| NE output | subject 60×50 on 128×128 |
| NE frames 02–04 | 60×39, 72×46, 55×42 |
| Hover | sprite bottom y=92; ground pivot `(64,112)`; 20 px @2x offset |
| Palette | SE frames 24/24/24/24; NE frames 24/24/24/24 colors |
| Machine checks | **PASS** — complete SE loop and NE frame 01 |
| Human review | Codex: **SE LOOP PASS; NE FRAMES 02–04 REJECTED.** The SE four-frame wingbeat reads at 55% and mirrors safely to SW. The generated NE intermediates rotate/resize the body, so they remain provenance candidates only and are not assembled into a shipping strip. |
| Promoted | no |

- ✅ SE canvas size — 128 × 128 (spec 128 × 128)
- ✅ SE binary alpha — every pixel is 0 or 255
- ✅ SE colour cap — 24 colours (cap 32)
- ✅ SE no pure black or white — none
- ✅ SE @1x is exactly half — 64 × 64
- ✅ SE-02 canvas size — 128 × 128 (spec 128 × 128)
- ✅ SE-02 binary alpha — every pixel is 0 or 255
- ✅ SE-02 colour cap — 24 colours (cap 32)
- ✅ SE-02 no pure black or white — none
- ✅ SE-02 @1x is exactly half — 64 × 64
- ✅ SE-03 canvas size — 128 × 128 (spec 128 × 128)
- ✅ SE-03 binary alpha — every pixel is 0 or 255
- ✅ SE-03 colour cap — 23 colours (cap 32)
- ✅ SE-03 no pure black or white — none
- ✅ SE-03 @1x is exactly half — 64 × 64
- ✅ SE-04 canvas size — 128 × 128 (spec 128 × 128)
- ✅ SE-04 binary alpha — every pixel is 0 or 255
- ✅ SE-04 colour cap — 24 colours (cap 32)
- ✅ SE-04 no pure black or white — none
- ✅ SE-04 @1x is exactly half — 64 × 64
- ✅ NE canvas size — 128 × 128 (spec 128 × 128)
- ✅ NE binary alpha — every pixel is 0 or 255
- ✅ NE colour cap — 24 colours (cap 32)
- ✅ NE no pure black or white — none
- ✅ NE @1x is exactly half — 64 × 64

- ✅ NE-02 canvas size — 128 × 128 (spec 128 × 128)
- ✅ NE-02 binary alpha — every pixel is 0 or 255
- ✅ NE-02 colour cap — 24 colours (cap 32)
- ✅ NE-02 no pure black or white — none
- ✅ NE-02 @1x is exactly half — 64 × 64
- ✅ NE-03 canvas size — 128 × 128 (spec 128 × 128)
- ✅ NE-03 binary alpha — every pixel is 0 or 255
- ✅ NE-03 colour cap — 24 colours (cap 32)
- ✅ NE-03 no pure black or white — none
- ✅ NE-03 @1x is exactly half — 64 × 64
- ✅ NE-04 canvas size — 128 × 128 (spec 128 × 128)
- ✅ NE-04 binary alpha — every pixel is 0 or 255
- ✅ NE-04 colour cap — 23 colours (cap 32)
- ✅ NE-04 no pure black or white — none
- ✅ NE-04 @1x is exactly half — 64 × 64

![QA sheet](monster_thicket_wasp_idle_facings_qa.png)

Sheet order: SE frames 01–04 and strip at 55%, NE frames 01–04 and strip at 55%, three-wasp SE overlap at 100% and 55%.
