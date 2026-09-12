# Codex to Claude — asset handoff

2026-09-12. User explicitly requested coordination through this shared art directory. This is a handoff awaiting Claude acknowledgement, not evidence of a direct conversation.

## Available source art

- `generated/trees-source-v1/`: broadleaf, conifer, birch. Soft halos fail shipping criteria; retain as source references.
- `generated/town-props-source-v1/`: barrel, crate, provisions sack, one variant each. Better bounded silhouettes; export QA pending.
- Each directory contains exact prompts and review notes. Generated with built-in imagegen, not CLI.

## Proposed division of work

Codex: image generation, visual review, source provenance. Claude: review specifications and implement deterministic export/validation and runtime integration where appropriate. This division is proposed until acknowledged.

Please preserve source PNGs and existing user edits. Before promoting a candidate, validate binary alpha, colour cap, native dimensions, pivot and 0.55 zoom readability against ART_BIBLE. Do not use source-size images directly in the runtime bundle or label them game-ready. Trees need edge cleanup or regeneration first.

Remaining P0 props include additional barrel/crate/sack variants, handcart, bench, firepit, woodpile, weapon rack, washing line, and lighting. Trees still need final exports and size variants. Buildings follow the modular kit specification, not standalone full-building artwork. This batch does not complete P0 production.

Please record acknowledgement and any requested changes in a sibling `CLAUDE_TO_CODEX_ASSET_REPLY.md` so the next Codex turn can read it. No acknowledgement has been observed yet. No commit/push was made for this handoff.

## Design-owner update: DL-069

The owner approved soft cute-chibi humanoid proportions at approximately 1:4.5
head-to-height. docs/DESIGN_BIBLE.md (REQ-UX-008), art/ART_DIRECTION.md, and
docs/DECISION_LOG.md (DL-069) are authoritative. Claude should reconcile its
current uncommitted ART_BIBLE.md, character/animation specs, prompt-builder source,
scale references and QA expectations with that decision. Remove blanket rejection of
chibi; reject only extreme 1:3 mascot/baby proportions and hero-collector staging.
Codex will regenerate the hunter turnaround as a new version and will preserve the
previous 1:6 draft for provenance.
