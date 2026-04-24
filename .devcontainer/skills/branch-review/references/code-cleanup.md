# Code Cleanup Reviewer

Find quick refactoring wins (dead code, duplication, stale comments, latent bugs hiding as style) via parallel subagents, then **verify each finding in a second pass before presenting**. Most value comes from the verification pass: single-pass sweeps routinely produce plausible-but-wrong suggestions, and a polluted punch list is worse than none.

**Do not auto-fix.** Report verified findings; let the user approve edits.

**Every fix must not grow the file.** A cleanup that adds net lines has failed the intent — dead code deletion, dedup via shared helper, trimming verbose comments, and header additions should all come out flat or negative in LOC. Header additions (Cat 7) are the only cleanup that adds lines; they are capped at one line + optional section markers. If a proposed fix would net-increase a file, drop it or reframe as a refactor request for the user, not a cleanup.

## Scope

- Default: the repo's primary source directory (infer from toolchain — e.g. `src/`, `scripts/`, `lib/`, `pkg/`), split across 3–4 parallel agents
- With a path arg: single file or subtree under the source dir
- With `--recent`: files changed in the last ~20 commits
- When invoked by `branch-review`: the code partition (changed source files, excluding tests)

## In-scope categories

Only these. If a candidate doesn't fit one of these, drop it.

1. **Dead code** — unused exports, orphan files, no-op functions, unreachable branches
2. **Duplicated logic** — same snippet in ≥2 sites with an obvious shared extraction
3. **Stale comments** — comment contradicts the code, or just restates the *what*
4. **Over-defensive checks** — validation for cases earlier guards already rule out
5. **Dependency hygiene** — imports with no matching manifest entry (transitive-by-accident), or manifest entries with zero import sites
6. **Latent bugs disguised as style** — unawaited promises / missing `.await`, silent catches swallowing real errors, fire-and-forget where sync is expected, missing `await` in an async chain, mis-destructured responses, ignored `Result`/`error` returns in Go/Rust
7. **Orientation headers** — every non-test source file gets a one-line top-of-file comment stating its responsibility (≤ ~110 chars, concrete domain language, no restating the filename). Files >250 LOC with ≥3 loosely-related export groups also get section markers (`// ── <section> ──` or language-appropriate equivalent). Co-located beats a central architecture doc because it drifts less. This is the one exception to the usual "no WHAT comments" rule — file-level role is architectural, not line-level. Skip files that already have a meaningful role comment. **Honor the existing header style** if the repo already has a convention (e.g. "list related files with relative paths") — match it rather than imposing a new shape.
8. **Verbose comments** — multi-line blocks that restate the *what* of the next statement, or docstrings whose `@param`/`@returns` / `:param:` / `///` lines add nothing beyond the function signature. Trim to one line or delete — never expand. **Strong bias to keep:** any comment encoding rationale, invariants, workarounds, cross-module intent, or non-obvious "why" is load-bearing even if long. When in doubt, leave it. Orientation headers (Cat 7) are exempt.

## Out of scope (drop without mentioning)

- Renames, reorganizations, new abstractions — not quick wins
- "Add error handling for X" suggestions — violates the usual "don't add error handling for scenarios that can't happen" rule
- Style nits without behavioral benefit (the linter handles these)
- Public API changes
- Anything estimated medium+ effort — only trivial/small qualify

## Execution

### Pass 1 — discovery (run twice, union)

Discovery is unstable run-to-run: two passes over the same code with the same prompts routinely surface disjoint findings. A single sweep misses roughly half the real wins. Run discovery **twice** and union the results before verification — cheaper and more complete than over-slicing one run.

Each discovery run spawns 2–4 `Explore` subagents in parallel, each covering a disjoint slice of the scope. Each agent prompt includes:

- Exact file list for that slice
- The in-scope categories verbatim
- The out-of-scope list verbatim
- "Rank by value/effort; drop anything medium+; cite file:line; under 400 words"
- "Each finding must include a verbatim code excerpt (≤3 lines) — Pass 2 verifies against this, not your paraphrase"
- "Every proposed fix must keep the file's LOC flat or shrink it. Cat 7 headers are the one allowed exception (one line + optional section markers)."

Each returns a ranked list with `file:line | excerpt | one-line change | effort (trivial/small)`.

Union the two runs' findings (dedup by file:line + category), then hand the combined list to Pass 2.

### Pass 2 — verification

Spawn one `Explore` subagent per discovery agent's output. Prompt:

> "Verify each claim against the actual code at <repo>. For each, quote the relevant code (file:line), run grep where needed, and return a verdict: **real / false positive / nuanced**. Include one-sentence justification and an updated effort estimate."

This pass typically kills 30–50% of Pass 1 findings. That is the point — do not skip it.

### Synthesize

Present only **verified-real** findings, grouped by bucket:

- **Latent bugs** — do now, separate commit (category 6)
- **Trivial cleanups** — batch into one "janitor" commit (categories 1, 3, 8)
- **Small cleanups** — second commit if user wants (categories 2, 4, 5, 7)
- **Needs judgment** — Pass 2 verdicts of "nuanced"; surface the caveat and let the user decide
- **Rejected** — list briefly with one-line reason, so user sees what was checked and excluded (builds trust; avoids re-surfacing next sweep)

### Ask for approval

Present the list. Do NOT edit. Wait for "fix 1-4", "all", "skip 3", "just the latent bugs", or similar. Apply only what's approved. After edits, re-verify only what you touched.

## Anti-patterns

- **Don't skip Pass 2.** The verification pass is the reviewer's whole value.
- **Don't suggest out-of-scope items.** Note a tempting rename/reorg as a rejected finding, don't smuggle it in.
- **Don't batch bug-fixes with cleanups.** Latent bugs go in their own commit so bisect stays useful.
- **Don't auto-fix**, even for "obvious" trivia. User approves.
- **Don't grow the category list.** If a finding doesn't fit the in-scope categories, it's not a quick win by definition.
- **Don't expand comments.** Trimming verbose comments (Cat 8) is in scope; *adding* explanatory comments to clarify confusing code is not — that's a refactor request.

## Example output

```
Code-cleanup sweep — 5 verified real (2 latent bugs, 3 trivial), 5 rejected

Latent bugs (separate commit):
- src/lib/manifest.ts:142 — appendEntry not awaited; race on concurrent runs
- src/poll.ts:88 — silent catch swallows fetch errors; caller sees success

Trivial cleanups (janitor commit):
- src/lib/html-to-md.ts:97-102 — extractH1 has zero references; delete
- src/a.ts:40 + src/b.ts:60 — identical URL-normalize snippet; extract shared util
- src/lib/fetcher.ts:1 — no role comment; add 1-line header (Cat 7)

Rejected (checked, not real):
- src/build-index.ts:49 — null check is for array elements, not parsed; necessary
- src/lib/quality.ts:24 — comment accurately flags hardcoded threshold
- src/lib/extract-links.ts:301 — silent catch is correct for non-critical progress counter

Reply with which to fix, or "all".
```
