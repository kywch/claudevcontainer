---
name: make-pr
description: Draft a pull request title and body from the branch diff, then open it on OK — `module: imperative` title that pinpoints the module touched, a problem/background opening, then key changed files as bullets. No tests/review section unless asked. Matches the repo's existing PR conventions and language. Drafts only; opens or edits the PR only on an explicit OK. Use when the user asks to "draft pr", "pr message", "write the pr description", "create pr", "update the pr body", or invokes /make-pr.
---

# Make PR

Write for a reviewer who has the diff open and lacks your context. The body gives what the diff cannot show: why, decisions, risk. Short, plain, factual.

## 1. Gather

From the repo root:

```bash
gh pr view --json number,title,body,baseRefName 2>/dev/null   # existing PR: update, don't redraft
BASE=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || echo main)
git fetch origin "$BASE"
git log --oneline "origin/$BASE..HEAD"
git diff --stat "origin/$BASE...HEAD"
git diff "origin/$BASE...HEAD"
gh pr list --state merged --limit 10 --json number,title,body   # repo convention
ls .github/pull_request_template.md .github/PULL_REQUEST_TEMPLATE* 2>/dev/null
```

If the branch was cut from another feature branch (commits in the log that aren't this PR's), use that branch as `BASE` and `--base`, and add `Depends on #N` to the body.

Also collect from the conversation: the motivation, decisions made with the user, and anything deferred.

## 2. Title

Format: `<module>: <Imperative summary>`, ≤ ~70 chars.

- `<module>` pinpoints the unit the PR works on, so titles stay scannable in monorepo-like repos. Pick, in order:
  1. A name recent merged titles already use for these paths (`bundle-fact`), unless it is coarser than step 2 gives (`dag` for one DAG).
  2. Else the deepest meaningful unit (package, service, DAG, skill, CLI) holding the changes, ignoring tests, lockfiles, and generated files. The unit's own tests, docs, and config ride along.
  3. Write its short name, not a path: `ship` for `.devcontainer/skills/ship/`, `ckid` for `examples/checkpoint-content-id-v1/`. Add one parent only if the name repeats in the repo (`dags/utils`).
- Unit is the repo's main package: name the subsystem or feature instead (`amp`, `env`). Root/config-only: `ci`, `deps`, `docs`, `devcontainer`.
- Two units: `a, b: ...`, more non-test lines first. Three or more: their shared parent if it is still a unit (`exp_track`), else suggest splitting.
- Keep the repo's module syntax (`[bundle-fact] ...` if titles use brackets). Mixed styles: use the most common one in the last 10 merged titles; on a tie, `module:`. In Korean titles the module and code identifiers stay untranslated: `[bundle-fact] 활성 HF 선언을 보존한다`.
- Summary: imperative, sentence case, specific: `exp_track: Trim tests to table-driven units`, `ckid: Make checkpoint-content-id-v1 pip-installable`, `train: Replace wandb with local Aim tracking`.
- Two related changes may be joined with `;`: `amp: Make the pipeline work; off by default`.
- If the repo uses Conventional Commits (recent merged titles do), put the module in the scope: `feat(slurm): ...`, copy the summary casing recent titles use (usually lowercase, which commitlint enforces), and mark breaking changes with `!`. Otherwise no `feat:`/`fix:` type prefix.
- Not vague: no `Fix bug`, `Update code`, `Phase 1`.
- Match the language of recent PRs and of the user in this session (e.g. Korean repos: Korean title and body).

## 3. Body

Default shape, no headers:

```text
<Problem/background: 1–3 sentences on the situation that motivates the PR — what is broken, missing, or costly today, and any context a reviewer outside the work lacks.>

<What this PR does about it: 1–2 sentences.>

- `<key file or dir>`: <what changed there and why, one line>
- `<key file or dir>`: <...>
- <decision, trade-off, breaking change, migration, or rollout step, if any>
- <where to look / what is risky, if not obvious>
```

- Open with the problem, not the solution. Background states facts (incident, limitation, request, numbers), not selling.
- Key-file bullets: only files a reviewer should open first — entry points, behavior changes, new modules, config/schema. Skip lockfiles, generated files, tests, and mechanical follow-on edits; fold small related files into one bullet (`docs + README`). Usually 2–6 bullets. Each bullet says what changed in that file at the reviewer's level, not a line-by-line diff.
- Scale to the change. Small PR: one background sentence, one action sentence, 1–3 bullets. Behavior changes, ops prerequisites, or multi-feature PRs: self-contained detail — problem, fix, behavior changes, results/numbers, validation, rollout, "Not done yet". Use the detailed form when the user asks for it ("in detail").
- No tests, review, or verification section by default: passing tests and agent reviews (Opus/Codex/mutation) are expected and add nothing for the reviewer. Include only when the user asks, the repo template requires it, or the check is something a reviewer cannot rerun and needs to trust (benchmark numbers, a manual run on hardware, a deploy dry-run) — then state the exact command and real result.
- Reviewer guidance: for large PRs separate mechanical from real changes ("Most of the diff is the rename; logic changes are in `X`"). If the approach is non-obvious, one line on the alternative rejected and any known shortcoming.
- If the repo has a PR template, fill it but delete sections that would be empty or boilerplate.
- Link issues and PRs as real references: `Closes #N`, `owner/repo#N` for cross-repo. Never plain text like "deepops PR 112".
- Note deferred work explicitly, e.g. "enforce switch goes in a separate PR".
- UI changes: say a screenshot is needed if you cannot attach one.

## 4. Honesty checks

Before showing the draft:

- Every claim maps to a hunk in the diff. Remove changes that were planned but not made.
- If a tests/results line is included, it lists only commands run in this session (or reported by the user) with their actual outcomes. No checkbox test plans.
- No selling words (`robust`, `comprehensive`, `seamless`), no emoji, no `## Summary` headers, no hunk-by-hunk narration (key-file bullets summarize, they do not walk the diff).
- No `🤖 Generated with Claude Code` line, no `Co-Authored-By` trailers — unless the repo's CONTRIBUTING or PR template requires AI disclosure; then tell the user and follow it.
- Where you lack context a reviewer needs (risk, why an alternative was rejected), ask the user rather than invent it.

## 5. Show, then open on OK

Show the title and body in chat. Do not push, open, or edit the PR until the user says so for this action ("create pr", "open it"). Then:

```bash
git push -u origin HEAD
# write the body to the scratchpad, not the repo
gh pr create --title "<title>" --body-file <scratchpad>/pr-body.md [--draft] [--base <base>]
gh pr edit <n> --body-file <scratchpad>/pr-body.md   # for updates
```

Use `--draft` when the user asks or the repo's workflow uses drafts. When later commits change the PR, offer to update the body: rewrite it to describe the final state, as if written fresh (with squash-merge it becomes the commit message). The title becomes the squash commit subject, so it must stand alone. Append an `Added in <sha>:` section only if the user asks; a "since last review" note goes in a PR comment, which needs its own OK. Report the PR URL.
