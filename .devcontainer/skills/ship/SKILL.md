---
name: ship
description: Orchestrate a coding task end to end — implement with a subagent, verify with an independent other-vendor reviewer (with arch-review), loop on findings, harden with mutation testing, trim tests, then stop before commit with a prepared commit message. Use when the user invokes /ship or $ship, or asks to "implement then verify", "use subagent to implement/fix, then independently verify", or "edit, then review". Not for running a project's build command. Flags --plan, --scratch, --verifier=other|codex|claude, --rounds=N, --no-mutation, --branch=NAME, --no-branch. Never commits.
effort: medium
---

# Ship

Orchestrate; do not implement in the main thread. The main agent owns scope, gates, and the final report. Less code is the goal of every stage.

## Flags

- (default) — implement → verify → fix loop → harden → trim → final verify → report. Stop before commit.
- `--plan` — read-only plan first; wait for an explicit "go". Questions or feedback are not approval.
- `--scratch` — implied for experiment, debug, parity, and profiling code: implement → one verify of measurement validity → report. Skip arch-review and steps 4–5; no new checks, tests, or harness.
- `--verifier=other|codex|claude` — default `other`: the vendor that is not running this skill. If it is unavailable, use a fresh same-vendor top-model verifier and flag `same-vendor` in the report.
- `--rounds=N` — fix→re-verify rounds after the first verification, integer 0–3 (default 2).
- `--no-mutation` — skip hardening. Implied for docs/config-only diffs, repos without a commit, and changes inside submodules.
- `--branch=NAME` — branch to create. Default: `<type>/<slug>` if on the default branch (step 0), else stay.
- `--no-branch` — stay on the current branch.

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

Branch unless `--no-branch`: on the default branch (`origin/HEAD`, else `main`/`master`), `git switch -c <type>/<slug>` (`feat|fix|refactor|docs|chore`, or the repo's prefixes; slug = 2–4 kebab words). Never push.

If a path to edit is already dirty, stop and ask. Restate task, acceptance criteria, and test/lint commands in ≤5 lines. If an existing feature, config change, or deletion already meets the criteria, say so and stop.

**Do not over-engineer.** Criteria are the user's words. No retries, polling, fallbacks, opt-in/dual paths, or old-data compatibility unless asked. Net LOC target ≤0 for fixes, perf work, and refactors. New test lines ≤1/3 of new code lines, except acceptance-criteria tests. Give a net-LOC estimate; if the diff exceeds 2× it, cut or ask before verifying.

With `--plan`: spawn a plan delegate, show the plan, then stop until the user says go.

## 1. Implement

Brief the implementer with:

- task, acceptance criteria, BASE, and dirty paths to leave alone; do not stage or commit;
- "Read `<abs skills-dir>/ponytail/SKILL.md` first and follow it" (delegates don't get skills loaded), plus the step-0 over-engineering limits; reread the diff and cut before returning;
- run the relevant tests/lint; return changed paths, net lines, one line justifying each new function/file/test, commands with results, open doubts.

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

1. Run the relevant tests in `$SCRATCH`; if the baseline fails, stop and report.
2. Mutate only changed logic, ≤10 mutants or 10 minutes (installed tool scoped to changed files, or hand mutants: negate a condition, off-by-one, drop a call/guard, swap a return).
3. Record per mutant: killed (assertion), survived, or error (not a kill), and which tests killed it.
4. Survivors: tighten an existing assertion or add a case to an existing parametrized test; otherwise list it or justify it as equivalent. New tests only for acceptance criteria. Confirm the fix kills the mutant in `$SCRATCH`.
5. Always: `git worktree remove --force <scratch>`.

## 5. Trim tests

For each test added or changed since BASE: delete or merge it if every mutant it killed is killed by a kept test **and** it mirrors the implementation, duplicates a case, or tests framework behavior. Keep acceptance-criteria, regression, and survivor-killing tests. Trim until the 1/3 test limit holds. Re-run the suite.

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

List only task-owned paths as `git status --porcelain` shows them; if anything else ends up staged, stop and ask. Write `<msg-file>` (`mktemp /tmp/ship-commit-XXXXXX.txt`): imperative subject ≤72 chars, blank line, the Plan/Verify/Mutation/Tests lines, and any required attribution trailer. On "commit", re-check `git status`, then use exactly this file and these paths.
