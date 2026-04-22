# Plan file + chunk format contract

Plan file layout and chunk skeleton: see [`../assets/plan-template.md`](../assets/plan-template.md). This file defines field semantics, constraints, and the rules muse must follow — content the template can't enforce.

## Durability principle (muse must follow)

Chunk `Description` fields name **contracts, types, and behaviors** — not file paths or line numbers (paths rot across chunks; contracts don't). `Files to touch` is the only place for paths.

- Good: "Add an `ExtractLimit` option to the daily-run API; default to env `DAILY_EXTRACT_TOPIC_LIMIT` or 50."
- Bad: "Edit line 47 of scripts/daily.js to add `--extract-limit`."

## Chunk contract

Every chunk must be:

- **Self-contained** — a fresh forge call with no prior context can execute it from the chunk text alone.
- **Independently verifiable and deployable** — shipping only this chunk leaves the tree green. If chunk N requires N+1 to be useful, merge them.
- **Vertical slice** — cut through all layers (schema → logic → API → test) for one narrow feature, not "all schemas" then "all APIs" (horizontal slices look done before they work).

Required fields (see template for shape):

- `Mode` — HITL or AFK (see ADR gate below).
- `Files to touch` — explicit list; forge must not touch others.
- `Depends on` — prior chunk numbers, or "none". Enables reordering.
- `Description` — work in contract terms (see durability principle). Include exact strings/schemas where ambiguity would bite.
- `Scope guardrails` — negative constraints.
- `Acceptance test` — exact shell command(s). Must fail before, pass after.
- `Status` — see vocabulary below.

### ADR gate — when to mark HITL

Mark HITL only if **all three** are true:

1. **Hard to reverse** — migration, API contract change, deletion.
2. **Surprising without context** — a reader of the diff would wonder "why this way?"
3. **Real trade-off** — a genuine alternative the user should weigh in on.

Otherwise AFK. Don't cry wolf.

## Status vocabulary

Canonical list (forge-prompt.md references this):

- `planned` — muse wrote it, not yet dispatched.
- `in-progress` — forge call open.
- `done` — forge returned DONE; verification passed.
- `done_with_concerns` — forge returned DONE_WITH_CONCERNS, or verification flagged adjacent issues. Requires `**Concerns:**`.
- `blocked` — forge returned BLOCKED, or verification failed and retry didn't help. Requires `**Blocker:**`.
- `failed` — three retry attempts exhausted (3-strike rule in SKILL.md).
- `skipped` — user elected to skip.
- `superseded` — replaced by a replan.

## Phase B annotations

During execution, Phase B writes these inline under each chunk:

- `**Enrichment:**` — context Claude added during B1 review.
- `**Result:**` — what forge produced, surprises.
- `**Concerns:**` — for `done_with_concerns`.
- `**Blocker:**` — for `blocked`.
- `**Status:**` — updated as work progresses.

The plan file becomes a running log. When resuming, Claude scans `Status:` lines.

## What muse must NOT do

- No "iterate until it works" chunks — forge has no planning loop.
- No "refactor X" chunks without specific outcomes — too vague.
- No chunks needing human judgment mid-execution — split as HITL stop-point.
- No frontmatter-only plans. All template sections required.
- No file paths or line numbers inside `Description` (durability principle); `Files to touch` is the exception.
