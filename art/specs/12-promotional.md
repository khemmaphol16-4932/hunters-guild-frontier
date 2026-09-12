# Category 12 — Loading and Promotional Art

**Status:** PROPOSED, 2026-09-12
**Requires:** `art/ART_BIBLE.md`, `art/ART_DIRECTION.md` (MVP asset sequence)
**Scope:** Title and dashboard art, region vistas, key art, web/share images, app icons
**Output style:** Full compositions — the one category that is not tile-bound

---

## 0. The two existing anchors, and what they teach

`ART_DIRECTION.md` names six MVP pieces. Two exist in `art/generated/`:

| File | Size | On disk | Used by |
|---|---|---|---|
| `guild-town-overview-v1.png` | 1672 × 940, 24-bit | **2.93 MB** | `style.css:192` |
| `verdant-reach-vista-v1.png` | 1672 × 941, 24-bit | **2.84 MB** | `style.css:261`, `style.css:364` |

Both are good **mood references** and stay in `generated/` as such. Neither is final art:

- **Not on a pixel grid.** 1672 × 940 is not an integer multiple of any native pixel resolution,
  so the "pixels" are painted, not placed. Next to real sprites they will look like a different
  game — the exact failure `ART_BIBLE.md` AR-1 exists to prevent.
- **Too heavy for the web.** Together they exceed the whole 4 MB art budget (O-11).

**Rule P-1 — author small, upscale by integers.** Promotional pixel art is authored at a native
resolution and upscaled by nearest-neighbour at an integer factor:

| Native | ×2 | ×3 | ×4 |
|---|---|---|---|
| 480 × 270 | 960 × 540 | 1440 × 810 | **1920 × 1080** |

A 480 × 270 pixel-art composition at ≤ 64 colours compresses to roughly 60–120 KB as PNG-8, and
**ship the native file**, letting CSS upscale with `image-rendering: pixelated`. That is the whole
fix for the 5.6 MB problem, and it makes the promo art consistent with the sprites by construction.

---

## 1. Assets

| ID | Native | Priority | Brief | Source |
|---|---|---|---|---|
| `PRM_TOWN_OVERVIEW` | 480 × 270 | P1 | Re-author `guild-town-overview-v1` on the grid: golden-hour town, Guild Hall upper-middle, a five-hunter party returning through the gate, quiet sky upper-left for overlays | `ART_DIRECTION.md` asset 01 |
| `PRM_VERDANT_VISTA` | 480 × 270 | P1 | Re-author `verdant-reach-vista-v1`: road out of town into the moss-green valley, trail markers and a camp showing Guild knowledge | asset 04 |
| `PRM_GUILD_HALL_EXTERIOR` | 480 × 270 | P2 | The Great Hall at T3, lived-in, trophy over the door, hunters coming and going | asset 02 |
| `PRM_BLACK_ZONE_VISTA` | 480 × 270 | P2 | Ashfall Barrows: burial terraces under warm ash — real danger, *"without horror excess"* | asset 05 |
| `PRM_TITLE` | 480 × 270 | P2 | A composite of the town edge and the frontier beyond — *"a world worth living in, and a frontier worth risking it for"* in one frame. Title text is rendered by the UI, not baked | north star |
| `PRM_REGION_CARD_<ID>` | 240 × 135 | P3 | One per region, shown at a region hard-cut (`REQ-CW-004`). Carries the region's own `description` from `regions.json`, rendered as UI text | `regions.json` |
| `PRM_EQUIPMENT_REVEAL` | 240 × 135 | P3 | A high-value item turning in lantern light — see boss cards in `specs/06` | asset 06 |
| `PRM_SHARE_IMAGE` | 400 × 210 → ×3 = 1200 × 630 | P2 | Open Graph / social preview crop of `PRM_TITLE` | web |
| `PRM_APP_ICON` | 32 × 32 → 192, 512 | P2 | The guild pennant from `ICO_CONTROL` `guild_affairs`, for favicon and a PWA manifest | web |

**No tips on loading cards.** `REQ-UX-001` teaches through play, with nothing explained before it
matters. Region cards carry place and mood, never gameplay instructions.

---

## 2. Shared rules

| Field | Rule |
|---|---|
| Palette | `ART_BIBLE.md` §6.2, ≤ 64 colours per composition |
| Light | §7 rig — the vistas are the rig at landscape scale, golden-hour leaning |
| Projection | Vistas may use a higher, wider camera than gameplay, but **buildings and hunters in them keep the 2:1 dimetric angle** so they are recognisably the same objects |
| Scale | A hunter in a vista is never larger than 2× gameplay scale — this is the same world, seen from further up |
| Composition | 16:9; keep the upper-left third quiet for UI overlays, per `ART_DIRECTION.md` |
| Text | None baked in. Ever |
| Delivery | Native-resolution PNG-8, CSS-upscaled; lazy-loaded; never in the eager atlases |

**Acceptance**
- [ ] Integer upscale only; pixels square and uniform at every display size
- [ ] ≤ 150 KB per native file
- [ ] Buildings and hunters recognisable as the in-game sprites
- [ ] No player avatar (`ART_DIRECTION.md`: *"the player is never shown as an avatar"*)
- [ ] No baked text, logo or watermark

**Prompt template**
```
<MASTER STYLE PROMPT>
Pixel-art landscape composition at a native resolution of 480 by 270 pixels, every pixel
hand-placed on a strict grid, for a frontier hunters' guild management game: <BRIEF>.
Elevated three-quarter view; buildings and people drawn in the same 2:1 dimetric angle as
the game's sprites. Golden-hour light from the upper left. Keep the upper-left third of the
frame calm and open for interface overlays. Warm inhabited town palette against cooler
wilderness. At most 64 colours. No text, no logo, no player character, no UI.
<MASTER NEGATIVE PROMPT> + painterly, digital painting, high resolution illustration,
smooth gradients, depth of field, bokeh
```

---

## 3. Order

1. **Now, no new art:** re-export the two existing PNGs as sized WebP (O-11) so they stop costing
   5.6 MB — they remain until P1 replacements land
2. `PRM_TOWN_OVERVIEW`, `PRM_VERDANT_VISTA` re-authored at 480 × 270 — replace the generated files
   in `style.css`
3. `PRM_TITLE`, `PRM_SHARE_IMAGE`, `PRM_APP_ICON`
4. `PRM_GUILD_HALL_EXTERIOR`, `PRM_BLACK_ZONE_VISTA`
5. Region cards, equipment reveal
