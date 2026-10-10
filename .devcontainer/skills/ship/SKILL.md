---
name: ship
description: Orchestrate a coding task end to end — implement with a subagent, verify with an independent other-vendor reviewer (with arch-review), loop on findings, harden with mutation testing, trim tests, then stop before commit with a prepared commit message. Use when the user invokes /ship or $ship, or asks to "implement then verify", "use subagent to implement/fix, then independently verify", or "edit, then review". Not for running a project's build command. Flags --plan, --scratch, --verifier=other|codex|claude, --rounds=N, --no-mutation, --branch=NAME, --no-branch. Never commits.
effort: medium
---

# Ship

Orchestrate; do not implement in the main thread. The main agent owns scope, gates, and the final report. Less code is the goal of every stage.

## Flags

- (default) — implement → verify → fix loop → harden → trim → final verify → report. Stop before commit.
- `--plan` — read-only plan first; wait for an explicit "go"/"implement". Questions or feedback are **not** approval. Without `--plan`, still honor any earlier "do not edit yet" in the conversation.
- `--scratch` — implied for experiment, debug, parity, and profiling code: implement → one verify of measurement validity → report. Skip arch-review and steps 4–5; the verifier may not request new checks, tests, or harness.
- `--verifier=other|codex|claude` — default `other`: the vendor that is not running this skill. If it is unavailable, use a fresh same-vendor top-model verifier and flag `same-vendor` in the report.
- `--rounds=N` — fix→re-verify rounds after the first verification, integer 0–3 (default 2).
- `--no-mutation` — skip hardening. Implied for docs/config-only diffs, repos without a commit, and changes inside submodules.
- `--branch=NAME` — branch name to create. Default: on the default branch, create `<type>/<slug>` (step 0); on any other branch, stay.
- `--no-branch` — work on the current branch, even if it is the default branch.

## Host mapping

| Concept | Claude Code | Codex |
|---|---|---|
| Spawn delegate | Agent tool, `general-purpose` (`Plan` for plans) | spawn a subagent |
| Continue same delegate | SendMessage to its ID | send to the same subagent |
| Default / hard / mechanical tier | `sonnet` / `opus` / `haiku` | configured default / top model / lowest tier, low effort |
| Effort | inherited from this skill's `effort: medium` | pass medium reasoning effort |
| Other-vendor verifier | `codex exec -s read-only -c approval_policy=never -c model_reasoning_effort=medium -C <repo> - < <brief>` | `claude -p --permission-mode plan --model opus --effort medium < <brief>` |

Use the mechanical tier only for renames, config lines, and doc sync — never for verification or judgment. Every coding delegate gets the ponytail brief below.

## 0. Scope

From the repo root (`cd "$(git rev-parse --show-toplevel)"`), record before any edit:

```bash
git rev-parse HEAD          # BASE
git status --porcelain      # pre-existing dirty/staged paths: never stage, never "fix"
```

Branch before editing unless `--no-branch`: if the current branch is the default branch (`git symbolic-ref --short refs/remotes/origin/HEAD`, minus the `origin/` prefix; else `main`/`master`), `git switch -c <type>/<slug>` — `<type>` is `feat`, `fix`, `refactor`, `docs`, or `chore` (follow the repo's existing prefixes if they differ), `<slug>` is 2–4 kebab-case words from the task. Use `--branch=NAME` verbatim if given. Never push.

If a path to edit is already dirty, stop and ask. Restate the task, acceptance criteria, and test/lint commands (from AGENTS.md/CLAUDE.md or manifests) in ≤5 lines. If an existing feature, a config change, or a deletion already meets the criteria, say so and stop.

Criteria are the user's words. Add no retries, polling, fallbacks, opt-in/dual paths, or compatibility with old data unless asked. Give a net-LOC estimate; if the diff exceeds 2× it, cut or ask before verifying.

With `--plan`: spawn a plan delegate, show the plan, then stop until the user says go.

## 1. Implement

Brief the implementer with:

- task, acceptance criteria, BASE, and dirty paths to leave alone; do not stage or commit;
- "Read `<abs skills-dir>/ponytail/SKILL.md` first and follow it" — delegates do not get skills loaded. Less code is the main rule: reuse, extend, or delete before adding; reread the diff and cut before returning;
- run the relevant tests/lint; return changed paths, net lines (+/−), one line justifying each new function/file/test, commands with results, and open doubts.

Keep the delegate; fix rounds go back to it.

## 2. Verify

Write the brief to `mktemp /tmp/ship-verify-XXXXXX.md`: task, acceptance criteria, BASE, task-owned paths, and the instruction to read `<abs skills-dir>/arch-review/SKILL.md` and apply it in `--mode=bug` to those paths (skip for docs/config-only diffs). Required output:

```text
VERDICT: PASS | FAIL
FINDINGS: [{id, severity: blocker|major|minor, file:line, problem, evidence}]   # arch-review Defects only; Design risks are minor
CHECKS RUN: commands/reads actually performed, with results; commands blocked by the sandbox
FALSIFICATION: ≥1 concrete attempt to break the change and its outcome
SURPLUS: [{file:line-range, why removable}]
```

SURPLUS is added code deletable without failing acceptance criteria: duplicates an existing helper, unrequested abstraction or option, guard for an impossible state, comment restating code, new file where an existing one fits. Each SURPLUS item is a `major` finding.

The main agent runs any sandbox-blocked commands and appends results. Malformed output, or a PASS with empty CHECKS RUN or FALSIFICATION, counts as FAIL.

## 3. Fix loop

On FAIL, triage: send a finding (id + evidence) to the implementer only if it shows a reachable failure of the acceptance criteria. Fixes needing a new guard, option, test file, or >20 lines, and anything about future or legacy cases, go to the report as follow-ups. Re-verify scoped to those ids, the hunks changed since the last round, and their callers — no new scope. When `--rounds` is exhausted with open blocker/major findings, stop: skip steps 4–5 and report BLOCKED. Minor findings: fix if trivial, else list.

## 4. Harden — mutation testing

Mutate before trimming: the kill matrix is the evidence for trimming. Delegate (default tier, ponytail brief) to work in a scratch copy, never the real tree:

```bash
SCRATCH=$(mktemp -d /tmp/ship-mut-XXXXXX) && echo "$SCRATCH"   # shell state does not persist: note the path
REF=$(git stash create) &&               # empty on a clean tree
git worktree add --detach "$SCRATCH" "${REF:-HEAD}" &&
git ls-files --others --exclude-standard -z | rsync -a --from0 --files-from=- ./ "$SCRATCH"/
```

1. Run the relevant tests in `$SCRATCH` first; if the baseline fails, stop and report.
2. Mutate only changed logic, at most 10 mutants or 10 minutes: an installed tool scoped to changed files (`mutmut`, `cargo-mutants`, Stryker, `go-mutesting`) or hand mutants — negate a condition, off-by-one a bound, drop a call or guard, swap a return, remove an error path.
3. Per mutant, record killed (assertion failure), survived, or error (crash/timeout, not a kill), and which tests killed it.
4. For each survivor, in the real tree: tighten an existing assertion or add a case to an existing parametrized test; otherwise list the survivor in the report — add a new test only for an acceptance criterion — or justify it as equivalent. Re-apply the mutant in `$SCRATCH` to confirm the new check kills it.
5. Always finish, including after failure: `git worktree remove --force <scratch>`.

## 5. Trim tests

Go through tests added or changed since BASE one at a time. Delete or merge a test only if:

- every mutant it killed is also killed by a test being kept, **and**
- it mirrors the implementation, duplicates another test's case, or tests framework/library behavior.

Never delete acceptance-criteria, bug-regression, or survivor-killing tests from step 4. Re-run the suite.

## 6. Final verify

If steps 4–5 changed anything, run one scoped verify of the hunks changed since the last PASS. READY requires this PASS, passing checks, and no open blocker/major findings.

## 7. Report and stop

Never stage, commit, or push. Revisit the plan — the `--plan` output, a plan agreed earlier in the conversation, or the step-0 criteria — and mark each item. ≤15 lines; group plan items when more than 5:

```text
Ship: <task, ≤10 words> — READY | BLOCKED · branch <name> (new | existing)
Plan: <n>/<m> done
  ✓ <item>
  ~ <item> — changed: <how and why>
  ✗ <item> — dropped/blocked: <why>
Diff: <files> files, +<a>/-<d>, net <±n>; surplus removed: <lines>; code vs tests: +<c>/+<t>
Verify: <vendor[, same-vendor]> <PASS|FAIL>, <r> round(s); open: <ids or none>
Mutation: <killed>/<total> killed, <e> errors; survivors: <id — fixed | equivalent: why> | skipped: <why>
Tests: +<added> −<trimmed> (<reason per trim group>)
Checks: <commands> → <pass|fail|not run: why>
Note: <devpod-rebuild needed | follow-ups | none>
Commit: git add -A -- <paths> && git diff --cached --name-only && git commit -F <msg-file>
```

`git add -A` records deletions and renames (a pathspec on `git commit` fails for deleted paths). Before committing, the staged list must be exactly the task-owned paths; if anything else is staged, stop and ask. List only task-owned paths, as `git status --porcelain` shows them (for a rename already staged by `git mv`, the new path).

Write `<msg-file>` (`mktemp /tmp/ship-commit-XXXXXX.txt`): an imperative subject ≤72 chars, a blank line, then the Plan, Verify, Mutation, and Tests lines as the body, plus any attribution trailer the session requires. When the user later says "commit", re-check `git status` against the listed paths, then use exactly this file and these paths.
