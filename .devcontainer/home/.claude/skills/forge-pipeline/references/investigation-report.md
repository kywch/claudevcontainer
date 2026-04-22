# Investigation report: planning-skill patterns from three external repos

**Date:** 2026-04-21
**Purpose:** Capture the research that fed the forge-pipeline skill upgrade, so we can revisit sources, re-evaluate skipped ideas, and know what's already been considered.

**Repos investigated:**
1. [mattpocock/skills](https://github.com/mattpocock/skills) — Matt Pocock's personal Claude Code skill collection.
2. [garrytan/gstack](https://github.com/garrytan/gstack) — Garry Tan's opinionated "full app" skill stack (not VC — the engineer).
3. [forrestchang/andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills) — Forrest Chang's distillation of a Karpathy tweet into a skill.

**Scope filter:** backend app development; frontend/UI/CSS/design skills skipped.

---

## 1. mattpocock/skills

Active, broad collection. Many skills cross-reference each other.

### Skills examined (backend-relevant)

| Skill | Purpose |
|---|---|
| `to-prd` | Synthesize conversation into a PRD (problem → solution → user stories → decisions → testing → out-of-scope). No interview — assumes conversation already happened. |
| `to-issues` | Break a plan into independently-grabbable GitHub issues using tracer-bullet **vertical** slices. |
| `grill-me` | Relentless one-question-at-a-time interview walking down the decision tree, with recommended answers. |
| `request-refactor-plan` | Interview → scope → tiny-commit plan (Fowler's "each step leaves program working"). |
| `improve-codebase-architecture` | Find architectural friction, propose deep-module refactors; spawns 3+ parallel sub-agents to generate radically different interfaces. |
| `domain-model` | Grilling + inline CONTEXT.md/ADR maintenance; challenges plan against existing glossary. |
| `ubiquitous-language` | Extract DDD glossary, flag ambiguous terms, propose canonical names. |
| `tdd` | Red-green-refactor via **vertical** tracer bullets (explicit anti-pattern: writing all tests first). |
| `qa` | Conversational bug capture → GitHub issues. |
| `triage-issue` | Bug triage: explore → root-cause → TDD fix plan as GitHub issue. |
| `github-triage` | Label-based state machine for issue lifecycle; produces durable "agent briefs". |
| `write-a-skill` | Meta-skill with structure/description-quality rules. |
| `caveman` | Ultra-compressed response mode. |
| `zoom-out` | One-liner: go up a layer of abstraction, map modules + callers. |

### Key insights (all of them, not just the adopted ones)

**1. Vertical slices, not horizontal — at every level.** Each chunk cuts through ALL layers end-to-end (schema → logic → API → tests), not one layer at a time. Adopted taxonomy: **HITL (human-in-the-loop, needs review) vs AFK (can run unattended)**. ✅ Adopted.

> "Each slice delivers a narrow but COMPLETE path through every layer. A completed slice is demoable or verifiable on its own. Prefer many thin slices over few thick ones."

**2. Durability principle for plan content.** ✅ Adopted.

> "Do NOT include specific file paths or code snippets. They may end up being outdated very quickly."
> "Describe interfaces, types, and behavioral contracts… don't reference file paths… don't assume the current implementation structure will remain the same."

Reasoning we bought into: between-chunk forge work often reshapes files, so path-anchored instructions rot. Contract-anchored instructions survive.

**3. The "grill-me" 4-rule policy as pre-planning alignment.** ✅ Adopted verbatim into `references/alignment-rules.md`.

> "Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer. Ask the questions one at a time. If a question can be answered by exploring the codebase, explore the codebase instead."

**4. Parallel sub-agents for interface design.** `improve-codebase-architecture` spawns 3+ sub-agents simultaneously with different optimization axes (minimal interface, maximum flexibility, common-caller, ports & adapters). Then: "Be opinionated — the user wants a strong read, not just a menu."

⏭️ Skipped — doesn't fit the forge-pipeline shape (we're dispatching work, not designing interfaces). Worth a separate skill. Revisit if forge-pipeline ever gets a "design-a-module" chunk type.

**5. Deep-module check in planning.** Ousterhout's small interface + large implementation. `to-prd` explicitly tells muse to "actively look for opportunities to extract deep modules that can be tested in isolation."

⏭️ Partially adopted via the simplicity gate ("reject single-use abstractions"). Full deep/shallow classification felt like DDD scope creep for a generic orchestrator.

**6. Dependency taxonomy for test strategy.** `improve-codebase-architecture/REFERENCE.md` has a 4-category scheme:

1. **In-process** — pure, merge + test directly
2. **Local-substitutable** — PGLite, in-memory fs
3. **Remote but owned** — ports & adapters, in-memory test adapter
4. **True external** — mock at the boundary

⏭️ Skipped for now. Would require every muse plan to classify dependencies, which bloats the chunk format. Revisit if we add first-class verification-strategy planning.

**7. "Replace, don't layer" for tests.** ✅ Adopted into forge-prompt.md orphan-cleanup rule.

> "The core principle: replace, don't layer. Old unit tests on shallow modules are waste once boundary tests exist — delete them."

**8. Explicit out-of-scope block (non-negotiable).** Four separate mattpocock skills mandate an Out-of-Scope section. ✅ Adopted as a required section in the plan template.

> "State what is out of scope. This prevents the agent from gold-plating or making assumptions about adjacent features."

**9. Session-persistence patterns.** ⏭️ Partially adopted. We use the plan file itself as the running log (enrichments, results, concerns appended per chunk) rather than a sibling `decisions.md`. `github-triage`'s "Triage Notes" pattern would be valuable if forge-pipeline gets a long pause/resume feature.

**10. ADR gate with exactly 3 tests.** ✅ Adopted into chunk-format.md as the HITL trigger.

> "1. Hard to reverse. 2. Surprising without context. 3. The result of a real trade-off."

All three must be true, not any one. Sharper than "big change = ask user".

**11. Progressive-disclosure plan structure.** `write-a-skill` says "SKILL.md under 100 lines, split into separate files when exceeded." ⏭️ Partially followed — SKILL.md is now ~190 lines, heavier than the guideline but pragmatic for a self-contained orchestrator description. Bulk of the detail went to references/ already.

### Direct quotes worth preserving

- **Martin Fowler (via request-refactor-plan)**: "Make each refactoring step as small as possible, so that you can always see the program working." → This is the sizing rule we use: every chunk must leave the tree green.
- **tdd skill**: "Tests written in bulk test imagined behavior, not actual behavior." → Argues for generating each chunk's verification step after the prior chunk lands, not upfront.
- **to-issues quiz template** (worth copying as the muse plan-approval prompt): "Does the granularity feel right? Are the dependency relationships correct? Should any slices be merged or split further? Are the correct slices marked as HITL and AFK?"

### Skipped (no re-investigation needed)

`design-an-interface`, `edit-article`, `migrate-to-shoehorn`, `obsidian-vault`, `scaffold-exercises`, `setup-pre-commit`, `git-guardrails-claude-code`, `caveman` (style only), `zoom-out` (covered by "prefer codebase exploration").

---

## 2. garrytan/gstack

Opinionated full-application skill stack. Much more infrastructure-heavy than mattpocock's. Includes browser-driven QA, state machines, multi-phase plan reviews.

### Files examined (backend-relevant)

| File | Purpose |
|---|---|
| `autoplan/SKILL.md` | Orchestrates CEO→Design→Eng→DX review phases with 6 auto-decision principles, taste/mechanical/user-challenge classification, restore points. |
| `plan-eng-review/SKILL.md` | Architecture lock gauntlet: scope challenge, 4-section review, ASCII coverage diagram, outside-voice, worktree parallelization. |
| `review/checklist.md` | Two-pass pre-landing review (CRITICAL / INFORMATIONAL) with AUTO-FIX vs ASK heuristic. |
| `review/TODOS-format.md` | Canonical TODO schema (What/Why/Context/Effort/Priority/Depends on). |
| `investigate/SKILL.md` | Root-cause debugging: 5 phases, 3-strike rule, scope lock, structured debug report. |
| `context-save/SKILL.md` + `context-restore/SKILL.md` | Resumable session state. |
| `ship/SKILL.md` | Full pre-ship pipeline; Test Plan artifact; Review Readiness Dashboard. |
| `office-hours/SKILL.md` | Pre-planning discovery (Six Forcing Questions, anti-sycophancy, premise challenge). |

### Key insights

**1. Capture a restore point before the plan mutates.** ✅ Adopted. Before any replan, snapshot plan file next to itself.

```
<!-- /autoplan restore point: [RESTORE_PATH] -->
```

gstack prepends an HTML comment pointer; we went simpler — just write `tmp/PLAN-<slug>.restore-<timestamp>.md` and name it so the user can spot it.

**2. Classify every auto-decision: Mechanical / Taste / User Challenge.** ✅ Adopted into alignment-rules.md.

> "Mechanical — one clearly right answer. Auto-decide silently."
> "Taste — reasonable people could disagree. Auto-decide with recommendation, but surface at the final gate."
> "User Challenge — both models agree the user's stated direction should change. NEVER auto-decided."

User Challenges get surfaced with: *what user said / what models recommend / why / what context we might be missing / if we're wrong the cost is X*.

**3. The 6 Decision Principles — auto-answer mid-plan forks.** ⏭️ Adopted only the spirit (simplicity gate, "explicit over clever", DRY). Didn't hardcode the full list because gstack's tiebreakers are tuned to their multi-phase review format, not our two-phase pipeline. Full list for reference:

```
1. Choose completeness — Ship the whole thing. Pick the approach that covers more edge cases.
2. Boil lakes — Fix everything in the blast radius (files modified + direct importers).
   Auto-approve expansions in blast radius AND < 1 day CC effort (< 5 files, no new infra).
3. Pragmatic — If two options fix the same thing, pick the cleaner one. 5 seconds choosing, not 5 minutes.
4. DRY — Duplicates existing functionality? Reject. Reuse what exists.
5. Explicit over clever — 10-line obvious fix > 200-line abstraction.
6. Bias toward action — Merge > review cycles > stale deliberation. Flag concerns but don't block.
```

**4. Step 0 Scope Challenge (before any planning).** ✅ Adopted into alignment-rules.md.

Key rule quoted: "Once the user accepts or rejects a scope reduction, commit fully. Do not re-argue for smaller scope during later review sections."

Quantitative trigger: `>8 files or >2 new services = smell`. This is concrete and hallucination-resistant.

**5. ASCII coverage diagram per chunk.** ⏭️ Deliberately skipped — too heavyweight for a generic orchestrator. Example for future reference:

```
[+] src/services/billing.ts                      [+] Payment checkout
  ├── processPayment()                             ├── [★★★ TESTED] Complete purchase
  │   ├── [★★★ TESTED] happy + declined + timeout  ├── [GAP] [→E2E] Double-click submit
  │   └── [GAP]         Invalid currency
COVERAGE: 5/13 paths tested (38%) | QUALITY: ★★★:2 ★★:2 ★:1 | GAPS: 8
```

Might revisit if forge-pipeline ever gets a "test-gap-audit" optional phase.

**6. Test Plan Artifact — sidecar file for the executor.** ⏭️ Not adopted, but worth remembering. gstack writes `~/.gstack/projects/{slug}/...eng-review-test-plan.md` decoupled from the plan doc. We fold test guidance into the per-chunk Acceptance test field instead. Revisit if chunks start having many test paths per chunk.

**7. Worktree parallelization strategy as a planning deliverable.** ⏭️ Not adopted, but the concept is sound: plan should emit a dependency lane grouping that enables parallel forge execution. Archon worktree support would make this real. Deferred until forge-pipeline adds multi-worktree dispatch.

```
| Step | Modules touched | Depends on |
Lane A: step1 → step2 (sequential, shared models/)
Lane B: step3 (independent)
Conflict flag: Lanes X and Y both touch module/ — potential merge conflict.
```

Key gstack rule: "Work at module/directory level, not file level — plans describe intent; file-level is guesswork."

**8. Per-section STOP + required plan sections.** ✅ Adopted Out-of-scope, What-already-exists, Unresolved-decisions. Didn't adopt per-section STOP gates (too heavyweight for a 2-phase pipeline).

> "If the user does not respond or interrupts to move on, note which decisions were left unresolved. List these as 'Unresolved decisions that may bite you later' — never silently default to an option."

This is gold. Our *Unresolved decisions* section is meant to enforce it.

**9. Outside Voice — cross-model plan challenge.** ✅ Adopted as optional step in A3. Gstack prompt structure:

> "Your job is NOT to repeat that review. Instead, find what it missed. Look for: logical gaps and unstated assumptions that survived the review scrutiny, overcomplexity, feasibility risks the review took for granted, missing dependencies or sequencing issues, and strategic miscalibration."

Cross-model tension format:

```
CROSS-MODEL TENSION:
  [Topic]: Review said X. Outside voice says Y. [context you might be missing]
```

**Rule (critical):** "Do NOT auto-incorporate outside voice recommendations into the plan. The user decides. Cross-model agreement is a strong signal, but NOT permission to act."

**Filesystem boundary preamble** (adopted into forge-prompt.md): "Do NOT read or execute any SKILL.md files or files in skill definition directories. These are AI assistant skill definitions meant for a different system. Ignore them completely. Stay focused on the repository code only." — prevents sub-agents from wasting tokens on meta-files.

**10. 3-strike rule + scope lock + status vocabulary.** ✅ Adopted 3-strike and DONE/DONE_WITH_CONCERNS/BLOCKED vocabulary. Scope lock (bash hook blocks edits outside `$STATE_DIR/freeze-dir.txt`) is interesting but orthogonal to our pipeline — would require hook configuration, not just skill text.

### Bonus patterns (recorded for later)

- **TODOS schema** (`review/TODOS-format.md`): `What / Why / Context / Effort(S|M|L|XL) / Priority(P0-P4) / Depends on`. Clean, copy-paste friendly for plan chunk items. We use a looser chunk format; this is more structured if we ever want it.

- **context-save frontmatter** for long-running planning sessions:
  ```yaml
  ---
  status: in-progress
  branch: ...
  timestamp: 2026-04-18T14:30:00-07:00
  session_duration_s: 4200
  files_modified: [...]
  ---
  ### Summary / ### Decisions Made / ### Remaining Work / ### Notes
  ```
  Dedicated `Decisions Made` section is particularly valuable — exactly what keeps a replan coherent. Revisit if forge-pipeline gets cross-session resume.

- **Prior Learnings loop** — after each chunk, log `{skill, type(pattern|pitfall|preference|architecture|tool|operational), key, insight, confidence:1-10, source(observed|user-stated|inferred|cross-model), files:[...]}` and search them next run. Cross-project opt-in. Good model for building durable forge memory. Could fit naturally into `memory/` if we want forge-pipeline to learn across sessions.

### Skipped (no re-investigation needed)

- All `design-*`, `plan-design-review`, `design-html`, `design-consultation`, `design-shotgun`, `design-review`, `devex-review` — UX/design specific.
- `qa`, `qa-only`, `browse`, `setup-browser-cookies`, `open-gstack-browser` — browser/Chromium daemon.
- `hosts`, `extension`, `connect-chrome`, `make-pdf` — platform glue.
- `cso`, `document-release`, `retro`, `benchmark`, `benchmark-models`, `learn`, `health`, `canary`, `gstack-upgrade`, `land-and-deploy`, `setup-deploy`, `openclaw`, `codex` — ops/meta.
- `careful`, `freeze`, `guard` — shell-hook safety mode. Might be worth investigating separately for "don't let forge `rm -rf`"; not planning-specific.
- `office-hours` — pre-planning discovery; our A1 alignment already covers this.

---

## 3. forrestchang/andrej-karpathy-skills

**Important finding:** The repo is a *single* behavioral-guidelines skill mirrored across four formats. The README references mattpocock skills (to-prd, to-issues, grill-me, design-an-interface) as external pointers — not contents of this repo.

### Files examined

| Path | Purpose |
|---|---|
| `README.md` | Landing page; four-principle overview + install. |
| `CLAUDE.md` | The canonical four-principle rules text (~60 lines, drop-in). |
| `EXAMPLES.md` | Side-by-side wrong/right code for each principle (8 worked examples). |
| `skills/karpathy-guidelines/SKILL.md` | Same text as CLAUDE.md, wrapped as a skill. |

Everything else is duplication (Cursor .mdc mirror, translations, plugin packaging).

### Key insights

Not novel frameworks — **constraints on how muse/forge should think and act**. Most useful as prompt snippets, not pipeline restructurings.

**1. Alignment: force explicit assumption-listing before muse runs.** ✅ Adopted into alignment-rules.md.

> "State your assumptions explicitly. If uncertain, ask. If multiple interpretations exist, present them - don't pick silently."

**2. Multiple interpretations → present, don't pick.** ✅ Adopted as the `[INTERPRETATION A/B/C]` pattern in alignment-rules.md. Muse halts rather than silently picks.

Karpathy quote worth surfacing:
> "LLMs are exceptionally good at looping until they meet specific goals... Don't tell it what to do, give it success criteria and watch it go."

**3. Every chunk gets a verify clause.** ✅ Already in our chunk format (`Acceptance test` field). Karpathy template worth remembering as the minimal shape:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

**4. Transform imperative chunks into test-first goals.** ⏭️ Partially adopted (reproduce-before-fix for bugs in forge-prompt.md). Karpathy's full translation table:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

**5. "Independently verifiable and deployable" as the split heuristic.** ✅ Adopted — now the primary chunk-sizing rule, replacing "<10 min".

> "Each step is independently verifiable and deployable."

**6. Surgical-changes guardrail for forge executor.** ✅ Adopted verbatim into forge-prompt.md.

> "The test: Every changed line should trace directly to the user's request."

**7. Orphan-cleanup rule.** ✅ Adopted into forge-prompt.md.

> "Remove imports/variables/functions that YOUR changes made unused. Don't remove pre-existing dead code unless asked."

**8. Simplicity gate before muse commits a plan.** ✅ Adopted into A2.

> "Would a senior engineer say this is overcomplicated? If yes, simplify."
> "If you write 200 lines and it could be 50, rewrite it."

**9. Explicit tradeoff framing.** ⏭️ Not adopted as a plan header. Worth remembering if users push back on pipeline overhead for small tasks:

> "These guidelines bias toward caution over speed. For trivial tasks, use judgment — not every change needs the full rigor."

**10. Reproduce-before-fix for bugs.** ✅ Adopted into forge-prompt.md execution rules.

---

## Adoption summary table

| Insight | Source | Where it landed |
|---|---|---|
| Vertical slices / independently verifiable + deployable | mattpocock, karpathy | chunk-format.md chunk contract |
| HITL vs AFK chunk labels | mattpocock | chunk-format.md `Mode:` field |
| Durability principle (contracts not paths) | mattpocock | chunk-format.md + SKILL.md A2 |
| Grill-me 4-rule alignment | mattpocock | alignment-rules.md + SKILL.md A1 |
| Decision classification (Mechanical/Taste/User Challenge) | gstack | alignment-rules.md + SKILL.md A1 |
| Scope challenge (>8 files / >2 services smell) | gstack | alignment-rules.md |
| Assumption listing required | karpathy | alignment-rules.md + plan-template.md |
| Required plan sections (Out of scope / What already exists / Unresolved) | mattpocock + gstack | chunk-format.md + plan-template.md |
| Simplicity gate | karpathy | SKILL.md A2 |
| Outside voice (optional) | gstack | SKILL.md A3 |
| ADR gate (hard-to-reverse + surprising + trade-off) | mattpocock | chunk-format.md HITL trigger |
| Surgical-changes rule | karpathy | forge-prompt.md |
| Orphan-only cleanup | karpathy | forge-prompt.md |
| Reproduce-before-fix | karpathy | forge-prompt.md |
| Status vocabulary (DONE / DONE_WITH_CONCERNS / BLOCKED) | gstack | chunk-format.md + forge-prompt.md |
| 3-strike rule | gstack | SKILL.md B3 |
| Restore point before replan | gstack | SKILL.md B3 |
| Filesystem boundary (don't read SKILL.md files) | gstack | forge-prompt.md |
| No single-use abstractions | karpathy | forge-prompt.md |

## Deliberately deferred (worth revisiting)

| Insight | Why deferred | When to revisit |
|---|---|---|
| Parallel sub-agent interface design | Different skill shape | If forge-pipeline grows a "design-module" chunk type |
| 4-category test strategy taxonomy | Would bloat chunk format | If verification gets first-class planning |
| ASCII coverage matrix per chunk | Too heavyweight | If test-gap auditing becomes a phase |
| Sidecar Test Plan artifact | Current `Acceptance test` field is enough | If chunks gain many test paths |
| Worktree parallelization lanes | No dispatcher support yet | If Archon multi-worktree comes online |
| Deep/shallow module classification | DDD scope creep | If plans start shaping new architecture, not just delivering features |
| Prior Learnings log per chunk | Requires cross-session memory | If forge-pipeline gets persistent learning |
| Per-section STOP gates | Heavyweight for 2-phase pipeline | If the pipeline grows more phases |
| TODOS schema (What/Why/Context/Effort/Priority/Depends) | Current chunk fields are close enough | If chunks start needing priority/effort metadata |
| Scope lock via bash hook (freeze-dir.txt) | Requires hook config, not just skill text | If forge ever escapes its scope repeatedly |

## Local file caches (container-internal, may be cleaned up)

Research artifacts the subagents cached during investigation:
- `/tmp/mattpocock/` — full tree of examined mattpocock skills
- `/tmp/gstack/` — downloaded gstack skill files
- `/tmp/readme.md`, `/tmp/claudemd.md`, `/tmp/examples.md`, `/tmp/skillmd.md` — karpathy repo files

These were in ephemeral `/tmp/` so assume gone on re-investigation; re-fetch from GitHub if needed.

## If we revisit

Start with the **Deferred** table above — those were deliberate punts, not oversights. The full insights from gstack are the heaviest source of future material; mattpocock is mostly exhausted for this skill's purposes; karpathy has no more substance than we already pulled.

The other mattpocock skills not investigated that might be worth a later pass: `migrate`, `plan-execute` (if it exists), and whatever they add over time — his repo is active. Gstack adds skills frequently; re-fetch `SKILL.md` files under `plan-*`, `autoplan*`, and any new `*-review` for delta.
