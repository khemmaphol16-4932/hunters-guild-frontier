# Development Log

Append-only. One entry per working session (§126).

---

## 2026-09-09 — Phase 0 + Phase 1

**Goal.** The spec's mandated first deliverable: conflict-audited architecture, implementation plan, and a working core prototype. Scope agreed with the user: stop at the end of Phase 1 (RPG Foundation), before combat and AI.

### Toolchain

Machine had no Node, npm or Python. Installed Node 24.19.0 LTS via winget. Project scaffolded under `hunters-guild/` with its own git repository (DL-001), TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, Vite, Vitest. **Zero runtime dependencies** (DL-002).

The Vite dev server needed a launcher script (`.claude/dev-hunters-guild.cmd`) because Node was installed after this shell's environment was captured, so `npm` is not on the inherited PATH.

### Delivered

- **Phase 0 docs**: DESIGN_BIBLE (350 decisions restated as ~150 testable requirement IDs), SYSTEM_MAP, DEPENDENCY_GRAPH, CONFLICT_AUDIT (11 spec-resolved conflicts + 8 found here), RISK_AUDIT (10 ranked risks), ROADMAP (all 10 phases, MVP scope split), DECISION_LOG, TECH_DEBT.
- **Phase 1 code**: deterministic core (seeded splittable RNG, fixed-timestep clock, typed event bus, branded ids), validated data layer, hunter domain (attributes, levelling, respec, composite potential), class chain, skills (registry, knowledge, books, mastery), personality, condition, **build identity**, chronicle, policy pipeline shape, versioned save with a live migration chain, debug console, build dashboard.
- **160 tests** across 9 suites. Typecheck clean.

### What the tests caught (all fixed at the source, not in the test)

1. **The UI was importing the debug console.** Allocating attributes, advancing a class and respeccing are *player* actions, not debug commands — they were only in DebugConsole because that is where they were written first. Extracted `app/GuildCommands.ts` as the player-intent surface; the dashboard dispatches there and DebugConsole delegates to it, keeping only the genuinely rule-*bypassing* commands of its own. This is the difference between a rule that holds and a rule that holds until someone uses the other path.

2. **Specialising unlocked nothing.** A fresh Adept could learn Ember Lance, Frost Chain and Renewal before choosing anything, and every skill available to a Bulwark was already available to a plain Vanguard. The third stage of the class chain was cosmetic. Gated the elemental and heal-over-time skills behind the Invoker/Mender lines, and moved the ultimate (`last_stand`), the party skill (`rally`) and the counter (`riposte`) above archetype level. Advancing now changes what a hunter can do, which is what REQ-CLS-003 requires.

3. **Mastery in an unusable skill correctly does nothing** — a test assumed otherwise and was wrong. Kept the behavior, fixed the test.

### Calibration recorded rather than tuned away

Class advancement plus retraining moves a build profile by ~0.08 on the 0–1 distance metric; rebuilding a hunter's attributes moves it by more. That is the honest consequence of §16 weighting class at 2 of 10 while a 12-skill content budget gives an advanced class only two skills the archetype lacked. Two thresholds are named in the test file with that reasoning attached, and TECH_DEBT tracks it — the expectation is that this number rises as content grows, and if it ever falls to zero, REQ-BLD-002 has been broken.

### Verified in the browser

Dev server on :5173, no console or build errors. Two Vanguards taken down opposite paths (Sentinel→Bulwark with VIT and 12,000 Taunt mastery; Templar→Crusader with STR and 12,000 Riposte mastery) read as genuinely different hunters — 71% tank / 8% risk posture versus damage-primary / 95% risk posture, profile distance 0.338. Save → full page reload → level, attributes, class chain, mastery and derived build identity all restored.

### Open at the end of this session

The behavioural half of REQ-BLD-003 — different builds producing different AI *decisions* — cannot be tested until combat exists. Everything here is the profile-level proxy. Risk R2 stays open until Phase 4.
