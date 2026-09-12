# Agents working on this repository

Two AI agents work here for one design owner, often in **the same working tree**:

| Agent | Tool | Lane |
|---|---|---|
| **Claude** | Claude Code | Code, build pipeline, specs, the prompt library, docs, integration |
| **Codex** | OpenAI Codex | Art generation and pixel cleanup |
| **Design owner** | human | Every design decision. Only the owner approves a `PENDING APPROVAL` item |

Lanes are defaults, not walls. Either agent may cross one by **claiming the item on the work board
below first**.

---

## Rules for a shared working tree

1. **Start with `git fetch` and `git status`.** Any uncommitted change you did not make belongs to
   the other agent or the owner. Do not stage, edit, revert, stash, or delete it.
2. **Stage by explicit path, never `git add -A` or `git add .`** — that sweeps up the other agent's
   work in progress.
3. **Commit small, push soon.** If a push is rejected, `git pull --rebase` and retry. Never force-push
   `main`.
4. **Claim before you start.** Put your name in the work board's Owner column in its own small commit
   and push it, so the other agent sees the claim before duplicating the work.
5. **Leave a trail.** A batch of generated art gets a `README.md` beside it with the exact prompts,
   the baseline commit, and its QA status — the format of `art/generated/trees-source-v1/README.md`
   is the model. Code and design changes get a `docs/DEVLOG.md` entry.
6. **Line endings are LF** (`.gitattributes`).
7. **Git ownership.** This folder was created by another OS user, so git may refuse with "dubious
   ownership". Use `git -c safe.directory=* <command>` rather than changing global config.
8. **Commit under your own name.** The repository's local git identity is `Claude
   <noreply@anthropic.com>`, so an agent that does not override it is recorded as Claude. Codex
   commits with `git -c user.name=Codex -c user.email=noreply@openai.com commit …`; Claude's
   commits carry a `Co-Authored-By: Claude` trailer.

## Sources of truth, in order

1. `docs/DESIGN_BIBLE.md` and `docs/CONTINUOUS_WORLD_ARCHITECTURE.md` — locked requirements
2. `docs/DECISION_LOG.md` — every decision, and which are still `PENDING APPROVAL`
3. `art/ART_BIBLE.md` — how art is made; `art/specs/` — per-category specs; `art/ASSET_REGISTRY.md`
4. `art/prompts/` — **generated**. Never edit by hand: change `art/prompts/src/`, the Art Bible or a
   spec, then run `npm run art:prompts`

If two sources disagree, the higher one wins and the conflict is logged, not silently fixed.

## Art pipeline

```
art/prompts/<category>.md  →  generate  →  art/generated/<batch>/  (candidates + README)
                                                   │  cleanup in Aseprite against art/reference-sheets/
                                                   ▼  and the spec's acceptance checklist
                                           art/<category>/…  (production, ID and filename per ART_BIBLE §9)
```

- A candidate is **promoted** only when it passes `ART_BIBLE.md` §13 and its spec's checklist:
  binary alpha, no halo, the colour cap, pivot measured, and the 0.55-zoom test.
- Asset IDs must match `art/prompts/` exactly, e.g. `PRP_TREES_BROADLEAF_MEDIUM`.
- The gate reference sheets (`ART_BIBLE.md` §11) come before any production asset.

## Checks before any push

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run art:prompts -- --check
```

---

## Work board

Status: ⬜ open · 🔨 claimed · ✅ done · ⛔ blocked on the owner. Claim by writing your name in Owner.

### Now — unblocked

| # | Item | Lane | Owner | Status |
|---|---|---|---|---|
| 1 | Gate sheets: `REF_LIGHTING_BALL`, `REF_SCALE_LINEUP` (generate, then correct by hand) | Art | Codex | 🔨 |
| 2 | Gate sheets: `REF_PALETTE_MASTER`, `REF_GRID_PROJECTION` (constructed exactly, not generated) | Code | Claude | ✅ approved by the owner 2026-09-12 |
| 3 | Clean up and QA the tree candidates in `art/generated/trees-source-v1/`, then promote | Art | Codex | 🔨 |
| 4 | Build pipeline: `@1x` from `@2x` and contact shadows from alpha (O-1, O-2) | Code | Claude | ✅ `npm run art:export` |
| 4a | Deterministic export + validation of candidates (`art/tools/`, reports in `art/qa/`) | Code | Claude | ✅ six candidates pass — promotion waits on the gates |
| 5 | Building kit: `src/data/town/building-art.json` schema and bake step (O-6) | Code | Claude | ✅ `npm run art:bake` — greybox for all 37 tiers × 4 rotations; kit parts next (Art) |
| 6 | P0 art for the proof cycle — 107 P0 prompts in `art/prompts/`, starting with `REF_HUNTER_TURNAROUND` | Art | Codex | 🔨 |
| 7 | Canvas world renderer and paper-doll cache (O-9, O-10); atlas packing (O-8) | Code | Claude | ✅ buildings on canvas, redrawn only on layout change; paper-doll cache waits for promoted hunters |
| 8 | Verify the restored hints, the 2:1 projection and the building canvas in a browser — `npm.cmd run dev` from this folder (PowerShell blocks `npm.ps1`) | Code | Claude | ⛔ needs a running dev server |

### Game — the continuous-world migration

`CONTINUOUS_WORLD_ARCHITECTURE.md` §Migration. REQ-CW-001 to 005 are not yet satisfied: expeditions
still resolve synchronously into a replay.

| # | Item | Lane | Owner | Status |
|---|---|---|---|---|
| 9 | Persistent journey/activity state owned by the simulation | Code | | ⬜ |
| 10 | Travel, encounter, combat, return, recovery and selling advance on fixed ticks | Code | | ⬜ |
| 11 | Region loading and camera observation as consumers of that state | Code | | ⬜ |
| 12 | Keep seeded combat facts and the audit trail for off-screen fidelity | Code | | ⬜ |
| 13 | Live observation primary; reports for history and missed events | Code | | ⬜ |
| 14 | Phase 9 remainder: presentation while town hunts and defenses run; production audio | Code | | ⬜ |
| 15 | Phase 10: technical hardening (`docs/ROADMAP.md`) | Code | | ⬜ |

The first proof is one cycle: service → road → Blue field → combat in place → immediate personal
loot → physical return → sale to Guild → recovery. Art item 6 and code items 9–13 meet there.

### Waiting on the design owner

| # | Decision | Where |
|---|---|---|
| 16 | "A wolf pack at the treeline" spawns `moss_crawler`: change the text or add a wolf | `town/threats.json`, `specs/03` |
| 17 | `emberheart_card` names a boss that does not exist | `items/cards.json`, `specs/06` |
| 18 | The ten-step absence threshold for the live clock | DL-066 |
| 19 | Add `sharp` as a dev dependency to re-export the two 3 MB PNGs (saves ~5.6 MB) | O-11 |
| 20 | World-boss henchmen content | `world/worldBoss.json`, REQ-CW-013 |

### Recently decided

- **DL-068 approved (2026-09-12):** pixel art, not painterly; a true 2:1, 64 × 32 tile. The world
  scene now projects at `32`/`16`.
- **DL-065:** no Pause — time runs at 1×, 2× or 4×.
