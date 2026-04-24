# Docs Review Reviewer

Review the repo's documentation against the current codebase and surface a punch list. **Do not auto-fix.** Report findings; let the user approve edits.

## Scope

- Default: full review across all in-scope docs
- With a path arg: single doc (e.g. `docs/design.md`)
- With `--drift`: fast subset: drift-vs-code + stale refs only
- When invoked by `branch-review`: the doc partition (changed `*.md` / `docs/**/*.md`)

## In-scope docs

### Full review (all seven checks)

- Architecture / design docs — typically `docs/design.md`, `docs/ARCHITECTURE.md`, or whatever the repo treats as its deep reference
- Schema / format docs — anything describing a wire protocol, DB schema, or data contract
- Outward-facing overview — `README.md` if present
- Agent entry-points — `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.windsurfrules`, etc.
- Dataset / API consumption guides — `GUIDE.md`, `API.md`, or equivalent

### Light-touch (checks 1, 2, 6 only — drift, stale refs, link integrity)

- Anything under `docs/` not listed above (supporting material)
- Skill READMEs / `.claude/skills/*/SKILL.md` / `.agents/skills/*/*.md` when changed

### Skipped entirely

- `docs/archive/**` and anything matching `*-archive.md` — immutable. Do not flag or edit.
- `tmp/`, `scratch/` — gitignored scratchpads.
- `data/`, `fixtures/` — not documentation.
- Auto-generated docs (check for `linguist-generated` / `DO NOT EDIT` headers).

## Checks

### 1. Drift vs. code

Project-structure trees, module one-liners, command names, env var names. Cross-check:
- Actual source-tree listing (`ls <source-dir>/`) against any tree diagrams in architecture docs and the "Repository map" / "Key modules" blocks in agent entry-points.
- Module descriptions — does `<module>` still own what the doc claims? Spot-check the first ~10 lines of each named module.
- Manifest scripts mentioned in docs (`npm run <x>`, `bun run <x>`, `cargo <x>`, `make <x>`) — still defined in `package.json` / `Cargo.toml` / `Makefile`?
- Env vars mentioned in docs — still referenced in the source?

### 2. Stale references

Grep each doc for file paths, function names, command names. For each hit, verify it resolves in the current tree:
- File paths → `ls`
- Function/variable names → `grep` / `rg` in the source tree
- Command names → check in `package.json` `scripts`, `Makefile`, `Cargo.toml` `[package.metadata.scripts]`, etc.
- Data paths → match the actual layout

### 3. Status-language rot

Grep for implementation-tracking words: `CURRENT`, `NEXT`, `shipped`, `Phase \d`, `proposed`, `planned`, `not started`, `TODO`, `TBD`, `WIP`, `FIXME`.

For each hit, ask: is this describing the *design* (stays true) or *in-flight work* (rots)? In-flight language belongs in commit messages, PR descriptions, or scratch planning docs — not reference docs.

**Suppress** for forward-looking idea docs where status language is the whole point (e.g. under `docs/idea/`, `docs/rfc/`, `proposals/`).

### 4. Duplication

Any fact stated in ≥2 docs that could be a link instead? Common offenders:
- Repository map / project-structure trees (belongs only in one doc — the deep architecture reference)
- Module description lists
- Command tables
- Configuration / allowlist explanations
- Pipeline or request-flow step descriptions

Target state: one doc owns each fact; others link to it. Multiple agent entry-points (`CLAUDE.md` ↔ `AGENTS.md` ↔ `.cursorrules`) serving different tools is **allowed duplication by design** — flag only if they've drifted from each other.

### 5. Cross-doc alignment

- Architecture doc's pipeline / request-flow steps ↔ actual source layout and command names.
- API/schema doc's shape ↔ actual output produced by the code.
- Agent entry-points ↔ each other (same facts, allowed to differ in tone).
- Cross-references between docs — does each `[text](other-doc.md)` link still point at a section that exists?

### 6. Link integrity

All markdown links resolve:
- `[text](path)` → file exists
- `[text](path#Lnum)` → line exists (file has ≥ N lines)
- `[text](#heading)` → heading exists in the same doc
- `[text](../foo.md)` → relative path resolves

### 7. Doc-role violations

- **README.md** (if present): outward-facing only. No detailed internals tree (use a short "Key modules" + link). No deep implementation rationale.
- **Agent entry-points** (`CLAUDE.md`, `AGENTS.md`, etc.): stay compact (~150 lines max — they're always loaded into the agent's context). Link to the architecture doc rather than inlining.
- **Architecture doc** (`docs/design.md` or equivalent): the sole deep reference. All module descriptions, full repo map, design guardrails live here.
- **API / consumption guides**: describe schema + invariants, not pipeline internals.
- **Schema docs**: describe shape, not pipeline status.

## Execution

For a full review:

1. **Dispatch in parallel.** Spawn one Explore agent per full-review doc. Each agent gets: the doc path, the seven checks, "report ≤ 250 words, concrete file:line references only, no prose rewrites." Light-touch docs get a trimmed prompt (checks 1, 2, 6 only).

2. **Synthesize.** Merge agent findings into a single punch list. Group by severity:

   - **Blocker** — broken link, flat-out wrong fact, dead file reference. Reader will be misled.
   - **Stale** — outdated but currently harmless (old phase names, settled open questions, retired status labels).
   - **Polish** — duplication, doc-role creep, language smells.

   Each item: `<severity> · <doc>:<line> — <one-line description>`.

3. **Ask for approval.** Present the punch list. Do NOT start editing. Wait for "fix 1-4", "ignore 5, it's intentional", "all", or similar.

4. **Apply fixes.** Edit only what was approved. After edits, re-verify the specific items you touched (don't re-run the full review).

## Anti-patterns

- **Don't auto-fix.** Surface findings; let the user decide.
- **Don't false-positive on quoted history.** A doc can mention a retired file inside a "here's what we replaced" sentence without being stale. Verify each hit reads as a *current* reference, not a historical one, before flagging.
- **Don't rewrite for style.** Scope is factual drift and structure, not prose quality or tone.
- **Don't grow scope.** If a check isn't in the seven above, don't add it mid-review. File a suggestion in the punch list instead.
- **Don't touch archives.** `docs/archive/` and `*-archive.md` are read-only.
- **Don't flag agent-entry-point divergence as duplication.** `CLAUDE.md` vs `AGENTS.md` vs `.cursorrules` serve different agents; light divergence is expected. Only flag if the facts have drifted apart (e.g., one says `src/tag.ts` and another says `src/tag-articles.ts`).

## Example output

```
Docs review punch list (2 blocker, 3 stale, 2 polish)

Blockers:
- docs/design.md:60 — lists src/tools.ts, but code has src/tools/ folder
- CLAUDE.md:14 — references `npm run tag` which has no matching package.json script

Stale:
- docs/design.md:96 — "Phase 3 — CURRENT" language; phase shipped
- GUIDE.md:132 — example schema missing `quality` field added in src/build-index.ts
- README.md:71 — TODO comment left from initial drafting

Polish:
- README.md:156-193 — full src/ tree duplicates docs/design.md
- CLAUDE.md:8-25 — module list longer than necessary; consider link to docs/design.md

Reply with which to fix, or "all".
```
