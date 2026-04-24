---
name: branch-review
description: Pre-push branch reviewer. Autodetects lint/test commands from AGENTS.md/CLAUDE.md/project files, confirms with the user, runs correctness gates (Pass 0), then walks iteratively through code-cleanup → test-review → docs-review on the branch diff (origin/main...HEAD), stopping for fixes between stages. Use --skip-docs to omit the docs stage, --merged for a single combined punch list, or --code-only / --tests-only / --docs-only for a single-reviewer shortcut. Language-agnostic — works for JS/TS, Python, Go, Rust, anything with a conventional lint+test toolchain.
---

# Branch Review Skill

Pre-push sanity check. Detects the repo's toolchain, runs correctness gates first (Pass 0), then invokes the three reviewers against the branch diff, collects their native outputs. Use before `git push` / PR.

**Do not auto-fix.** Each reviewer refuses to auto-edit; this skill preserves that.

## Invocation modes

Argument parsing (user passes these inline):

- (default) — Pass 0 + iterative: code-cleanup → stop for fixes → test-review → stop for fixes → docs-review → stop for fixes
- `--skip-docs` — stop after test-review (no docs stage)
- `--fast` — skips Pass 0's test run; keeps lint
- `--merged` — run all enabled reviewers back-to-back with no mid-flow fix stops, then emit a single combined punch list + merge-by-file index at the end
- `--code-only` / `--tests-only` / `--docs-only` — single-reviewer shortcut, no Pass 0
- `--base=<ref>` — non-default base (default: `origin/main`)
- `--include-dirty` — also include staged+unstaged working-tree changes in scope
- `--paths=<glob>` — scope to a subtree

For single-reviewer modes, load ONLY `references/code-cleanup.md`, `references/test-review.md`, or `references/docs-review.md` and follow that file verbatim. The rest of this SKILL.md (Setup, Preflight, Pass 0, iterative flow) does not apply.

## Setup — detect toolchain

Before running Pass 0, discover the repo's lint/test conventions. Run detection in this order and stop at the first hit:

1. **Cached config.** If `.claude/branch-review.json` exists in the repo root, load it and skip to Preflight. Fields: `{ "lint": "<cmd>", "test": "<cmd>", "typecheck": "<cmd|null>", "test_globs": ["..."], "doc_globs": ["..."], "skip_globs": ["..."] }`.

2. **Agent entry-points.** Scan `CLAUDE.md` and `AGENTS.md` (if present) for a `## Commands` / `## Scripts` / similar section, or inline code fences. Extract lines matching `lint`, `test`, `typecheck`, `check`. These are usually authoritative — the author wrote them down for a reason.

3. **Project manifests.** Read whichever exists:
   - `package.json` → `scripts.lint`, `scripts.test`, `scripts.typecheck` (prefer `bun run <x>` if `bun.lock` or `bunfig.toml` is present, else `npm run <x>` / `pnpm <x>` / `yarn <x>` based on lockfile).
   - `pyproject.toml` → `[tool.ruff]` → `ruff check .`; `[tool.pytest.ini_options]` → `pytest`; `[tool.mypy]` → `mypy .`.
   - `Cargo.toml` → `cargo clippy -- -D warnings` + `cargo test`.
   - `go.mod` → `go vet ./...` + `go test ./...`.
   - `Makefile` → targets named `lint`, `test`, `check`, `typecheck`.

4. **Test-file globs** — infer from what exists in the tree:
   - JS/TS: `**/*.test.{js,ts,tsx,jsx}`, `**/*.spec.{js,ts}`, `**/__tests__/**`
   - Python: `**/test_*.py`, `**/*_test.py`, `tests/**/*.py`
   - Go: `**/*_test.go`
   - Rust: `**/tests/**/*.rs`, `#[cfg(test)]` modules (can't glob; fall back to `cargo test`)

5. **Doc globs**: `*.md`, `docs/**/*.md` (default).

6. **Skip globs** (silent, no review): `**/*.lock`, `**/*lock.json`, `**/*.lock.yaml`, `dist/**`, `build/**`, `target/**`, `node_modules/**`, `.venv/**`, `__pycache__/**`, `data/**`, `tmp/**`, generated/vendored files the repo flags (look for `.gitattributes` `linguist-generated=true`).

### Confirm detected values

Present what was detected inline and wait for the user. Do **not** proceed silently.

```
Detected toolchain (from <CLAUDE.md | package.json | pyproject.toml | ...>):
  lint:      <cmd>
  test:      <cmd>
  typecheck: <cmd or "(none)">
  tests:     <glob list>
  docs:      <glob list>

Proceed? (y / edit / skip-pass-0)
```

- `y` → continue to Preflight.
- `edit` → accept inline overrides (free-form; re-display and re-confirm).
- `skip-pass-0` → go straight to Partition.

**If detection finds nothing**, say so and ask: *"No lint/test commands detected. Skip Pass 0? (y / specify)"* — warn-and-continue is the default for scratch repos.

### Persistence (opt-in, at end of run)

After a successful full run, ask once: *"Save detected toolchain to `.claude/branch-review.json` so next run skips the confirm step?"* Only write the file on explicit `y`. Do **not** overwrite an existing file without asking.

## Preflight (full-branch modes)

1. **Refresh base.** `git fetch origin main --quiet` (or `<base>`). Stale local `main` re-surfaces upstream-merged commits.
2. **Git state check.** Refuse on detached HEAD or active rebase/merge (`git status --porcelain=2 --branch` → look for `in progress`). Warn if working tree is dirty; suggest `--include-dirty` to add staged+unstaged to the scope, else diff is branch-only.
3. **Compute diff.** `git diff --name-only <base>...HEAD` (+ `git diff --name-only HEAD` if `--include-dirty`).
4. **Scale gate.**
   - Empty diff → exit with "no changes vs base".
   - ≤30 files → proceed as normal.
   - 31–60 files → proceed but force `--fast` and print a "large branch" warning.
   - \>60 files → refuse. Print the partition counts and suggest: narrow base (`--base=<recent-commit>`), scope to subtree (`--paths=<subdir>/**`), or invoke the reviewers directly on a subset.

## Partition

Route changed files by path, using the detected globs:

- **tests** → test-review: files matching the detected test globs
- **code** → code-cleanup: source files not matching test / skip / doc globs
- **docs** → docs-review: files matching the detected doc globs

**Skip silently** (no routing, no findings, no warning): files matching the skip globs above.

**Flag in rollup but do not review** (config/infra — the author should eyeball these): manifest files (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`), lint configs (`eslint.config.*`, `ruff.toml`, `.clippy.toml`), CI (`.github/**`, `.gitlab-ci.yml`), agent configs (`.claude/**`, `.agents/**`), install scripts (`install.sh`, `bootstrap.sh`).

**Renames:** if `git diff -M --name-status` shows `R100` (pure rename, no content delta) → surface as rename, route nothing. `R<100` → route the new path normally.

**Test-orphan detection:** if a source file `<dir>/X.<ext>` changed but its sibling test (`<dir>/__tests__/X.test.<ext>`, `<dir>/X.test.<ext>`, `<dir>/X_test.<ext>`, `tests/<dir>/test_X.py`, etc. — same basename, same-language test glob) did not, include that test file in the test partition. Test-review is sensitive to "code change without test update." Do not extrapolate further.

## Pass 0 — correctness gates (unless `--fast` or `skip-pass-0`)

Run the detected lint + test commands in parallel Bash calls. If a typecheck command was detected, run it alongside.

If any fails, surface at the top of the report as **BLOCKERS** and short-circuit the review: there's no point polishing a branch that doesn't lint or whose tests fail. Author fixes those, then re-runs.

With `--fast`: run lint only; skip test/typecheck.

## Pass 1 — iterative review stages (default)

Run the enabled reviewers **one at a time in this fixed order**, stopping for fixes between stages:

1. **Stage A — code partition** → load `references/code-cleanup.md`, run its full procedure (Pass 1 discovery ×2, Pass 2 verification), present its report, ask for approval, apply approved fixes. Then stop and proceed only when the user says continue (or `skip` to move on without fixes).
2. **Stage B — test partition** → load `references/test-review.md` and run its full procedure on the (now possibly-edited) test partition. Re-compute the test-orphan set against the current working tree, not the original branch diff — Stage A may have deleted code whose tests are now orphans. Present report, approve, fix. Then stop.
3. **Stage C — doc partition** (skip only if `--skip-docs`) → load `references/docs-review.md`, run, approve, fix.

Sequential (not parallel) because each reviewer internally fans out 4–8 Explore subagents; stacking three would risk rate limits / context churn. Fixed order `code → test → docs` because: highest-stakes findings (latent bugs) surface first; test-review runs against post-cleanup code so fewer false flags on code that's been deleted; docs-review runs last so it can catch drift introduced by the earlier fixes.

Iterative (not batched) because a single combined punch list across all three reviewers is too long to triage well, and fixes from earlier stages often obsolete findings in later stages. Tight review→fix loops keep cognitive load manageable and avoid wasted skeptic cycles on findings that would be moot post-fix.

Each reference file contains its own Pass-1/Pass-2 subagent fan-out; within-reviewer concurrency is preserved.

### `--merged` mode (opt-in)

If the user invoked with `--merged`, run all enabled reviewers back-to-back with **no mid-flow fix stops**. Collect the three native outputs verbatim, append a merge-by-file index (author-oriented cross-reference — does NOT re-rank, lists which reviewers flagged which files), and emit a single combined punch list at the end.

Collect the three native outputs **verbatim**. Do not summarize, rewrite, or translate their vocabularies — each reviewer's bucketed structure encodes its calibration. Preserving it lets the author re-use their mental model from direct invocations.

## Output

### Blockers (always first)

If Pass 0 produced failures:

```
## Blockers
- lint: <errors, file:line>
- test: <failing test names>
- typecheck: <errors, file:line>
```

Stop here. Author fixes, then re-runs.

### Iterative mode (default)

Each stage produces its own output, verbatim from the reference file:

```
# Stage A — code-cleanup
<verbatim code-cleanup report>

Reply with which to fix (e.g. "fix latent bugs", "all cleanups", specific items), or "skip" to proceed without fixes.
```

After fixes (or `skip`):

```
# Stage B — test-review
<verbatim test-review report>

Reply with which to fix, or "skip".
```

After fixes (or `skip`, unless `--skip-docs`):

```
# Stage C — docs-review
<verbatim docs-review report>

Reply with which to fix, or "skip".
```

End with a one-line rollup: `code: <N fixes applied / M skipped> · test: <N/M> · docs: <N/M or "--skip-docs">`.

Then (once per repo) the persistence prompt: *"Save detected toolchain to `.claude/branch-review.json`?"*

### `--merged` mode

Combined output at the end only:

```
<verbatim code-cleanup report>
<verbatim test-review report>
<verbatim docs-review report, unless --skip-docs>

## Merge-by-file index
### <file path>
- [cleanup] N findings (X verified, Y needs-judgment)
- [test] <sibling test file>: N delete, M loosen
- [docs] N blocker, M stale
```

End with: `N files reviewed · <cleanup-count> cleanup · <test-count> test · <docs-count> docs · <blocker-count> blockers`.

## Anti-patterns

- **Don't re-verify findings.** Each reviewer runs its own verification pass. Re-auditing here is duplication.
- **Don't re-rank or translate vocabularies.** The reviewers calibrate on their native buckets; flattening to a common severity destroys that signal.
- **Don't expand scope beyond test-orphan detection.**
- **Don't run at repo scope.** Enforce the scale gate.
- **Don't skip Pass 0 outside `--fast` / `skip-pass-0`.** A clean review of unlinted or failing code is worse than useless.
- **Don't re-run immediately after fixes.** Use the reviewers' scoped modes (`<path>` arg) to re-verify just the touched files.
- **Don't silently overwrite `.claude/branch-review.json`.** Always ask before writing or updating.
- **Don't persist detection on first run.** Only offer after a successful full run so the user has seen the detected values actually work.
