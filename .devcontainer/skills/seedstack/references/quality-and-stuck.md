# Quality Bar And Stuck Index

## Quality Bar

Before presenting, check:

- every seed has acceptance and at least one gate
- every gate names test type and exact command
- every edge is necessary and not transitively redundant
- first dispatchable seed is clear
- every implementation seed owns its closest verification
- broad LLM-generated work has cleanup/review-fix milestones
- no seed depends on docs unless docs are normative
- labels are advisory; no plan relies on labels for enforcement
- shared network label appears in every seed's labels array
- seed boundaries align with natural module boundaries
- flag seeds under 100 LOC as merge candidates unless decision, discovery,
  review, docs-only, or another explicit rationale applies
- LOC estimates present for every seed
- broad implementation, subsystem, or feature plans state a chunking strategy
  and rationale
- broad implementation or subsystem plans include an implementation boundary
  sketch that names expected responsibility boundaries without forcing a
  file-first DAG
- chunking strategy rejects pure file/module DAGs for new behavior unless the
  seed is scaffolding or refactor-only
- broad command/CLI plans include an early mini end-to-end smoke after the
  first mutating happy path, or explicitly waive it
- every skipped alignment question has a visible assumption in plan header
- plan separates "learn what to do" from "do it"
- protocol/version plans separate draft from promotion; no seed silently bumps
  the global spec line as a side effect of adding behavior
- promotion/release seeds include gates for version-source sync, docs/sync
  markers, implementation target drift, and hardening gaps surfaced by review
- final Seedstack review seeds inspect plan intent against landed
  implementation, self-tests, and docs. They must explicitly cover artifact
  layout (`loop/` plus `recovery/rec-####/`), monotonic `loop_iteration`
  allocation and retry non-clobbering, linked-worktree support and same-branch
  duplicate policy, proposal-only manage children, supervisor-applied queue
  mutations with configured `seed-cli`, and residual stale-state/dirty-guard
  risks.
- docs must not recommend new root-level recovery artifact files. Repeated run
  evidence belongs under `loop/`; recovery attempts belong under
  `recovery/rec-####/`.

Before creation, use `plan-review.md` as the normative pre-creation gate:
run the scripted mechanical check, record current manifest/state evidence, and
apply the agent-reviewed safety gate only as described there. This file keeps
the presentation quality bar and stuck-state resolutions; it does not duplicate
pre-creation acceptance checklists.

## Stuck Index

| stuck state | resolution |
| --- | --- |
| can't classify ask size | default to `slice`; do source map, blast-radius, and verification research during planning before adding discovery seeds |
| sources conflict on behavior | add `decision` seed before `spec` |
| user won't answer alignment | proceed with explicit assumptions, mark unconfirmed |
| user rejects draft direction | new research round before revision, do not patch |
| user adjusts assumptions | revise plan, diff review + verify (max 1 round project / 2 program) |
| review agents disagree | planner adjudicates; escalate material disagreements to user |
| estimated LOC wildly uncertain | do sizing research during planning; add discovery seed only if uncertainty remains, and flag as split candidate |
| CLI unavailable for creation | present plan only, skip creation and safety gate |
| review-fix-verify cap hit | record residual risk in plan, dirty bit stays, present with risk callouts |
| fix sub-cap hit | record finding as residual risk for that pass, continue to next pass |
| diff review escalates to full | run full review-fix-verify loop; adjustment already counted |
| verify finds new issues not in review | count toward same pass cap; fix and re-verify |
| safety gate finds issues | fix, re-present; user accepts or rejects (no adjust) |
| assumption check gets structural feedback | treat as rejection; new draft needed |
