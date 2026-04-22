---
name: forge-pipeline
description: Plan-then-chunked-execute orchestration for non-trivial implementation work delegated to the Forge CLI. Two phases — (A) alignment + muse planning that produces a plan file under tmp/, (B) execute the plan file chunk-by-chunk through forge with verification and user check-ins between chunks. Use when a task is too large for a single forge call (>10 min estimated), when the user wants mid-build check-in points instead of a 20-minute blackout, or when the user says "plan then execute", "muse then forge", "chunked forge", "forge-pipeline plan <goal>", or "forge-pipeline execute <plan-file>".
---

# forge-pipeline

Two-phase wrapper over `muse` + `forge`: plan (A) → plan file in `tmp/` → chunked execute (B). The plan file is the durable handoff between phases and Phase B's live state store.

## When to use (and when not)

Use when: task >10 min of forge time, touches multiple files/phases, user wants mid-build check-ins, or explicit invocation. Skip for single-file fixes (use `forge` direct), pure planning/research (use `muse` direct), or work the user wants to Edit themselves.

Phase A → `muse` once → `tmp/PLAN-<slug>.md`. Phase B → `forge` once per chunk → code + updated plan. Phase B requires a plan file; if missing, run Phase A first and stop before B.

## Phase A — Plan

### A1. Align with the user (no dispatch yet)

Align in-conversation first — muse gets one shot with no user access. Follow the four grill rules in [references/alignment-rules.md](references/alignment-rules.md): one question at a time, always recommend an answer, walk the tree in dep order (scope → approach → split → verification), prefer codebase exploration over asking.

Classify each fork as **mechanical** (auto-silent), **taste** (auto + note in plan's Assumptions), or **user challenge** (never auto; surface explicitly). Run the scope challenge in alignment-rules.md before committing to a plan that needs >8 files or >2 new services.

Compose a **plan brief** (3–8 sentences: goal + scope + constraints + non-goals + assumptions). It opens the muse prompt. If the goal is trivially clear, skip clarifying.

### A2. Dispatch muse

One foreground `muse` call. Prompt structure:

1. The plan brief from A1.
2. Repo context (paths, conventions, related files muse should read — muse auto-invokes `sage`, so give pointers not excerpts).
3. The chunk format contract — inline the spec from [references/chunk-format.md](references/chunk-format.md) so muse produces a parseable plan.
4. Explicit instruction to return a complete plan body matching the layout in [assets/plan-template.md](assets/plan-template.md). Claude saves it as-is.
5. **Durability rule** + **Simplicity gate**: chunk descriptions describe contracts/types/behaviors (paths rot, contracts don't); muse self-reviews for overcomplication and rejects single-use abstractions.

### A3. Save the plan file

Write muse's output to `tmp/PLAN-<slug>.md` (slug from goal; append `-2` on collision). Sanity-check before reporting: required sections present, chunks are vertical slices (each independently verifiable + deployable), HITL/AFK marks look right, no paths/line numbers sneaking into `Description`. Fix inline or surface as concerns.

Report to the user: plan file path, chunk count, AFK/HITL breakdown, estimated total time, any taste decisions auto-resolved (so they can flip them), any issues spotted. **Stop here.** Do not proceed to Phase B unless the user asks.

Optional — **outside voice**: for high-stakes plans, dispatch a second subagent (different model where possible) prompted to find gaps/overcomplexity/unstated assumptions. Surface tensions; don't auto-merge.

## Phase B — Execute

### B1. Load + review

Read the named plan file (or the most recent `tmp/PLAN-*.md`). Flag problems before starting:

- Oversized chunks (>4 files or >~150 LOC estimated).
- Missing or vague acceptance tests.
- Circular or unclear `Depends on` entries.

Offer the user a chance to edit the plan or approve as-is. **Enrich chunks** with context muse didn't have (recent conversation, prior-chunk decisions) as `**Enrichment:**` lines inline under each chunk. The plan file is the **live state store** — update it as work proceeds.

### B2. Per-chunk dispatch loop

For each chunk in plan order:

1. **Brief forge** using the skeleton in [references/forge-prompt.md](references/forge-prompt.md): 2–3 sentence project overview, running log of prior chunks (maintained in the plan file — forge has no memory), the chunk text verbatim, and the execution rules block.
2. **Dispatch foreground.** Set `**Status:** in-progress` before dispatch. Never background forge (see gotchas).
3. **Verify**, in order: the chunk's acceptance test → project-standard lint + test (e.g. `bun run lint`, `bun test`) → read the diff, confirm scope held.
4. **Record outcome** in the plan file. Map forge's DONE / DONE_WITH_CONCERNS / BLOCKED to chunk statuses per [references/chunk-format.md](references/chunk-format.md) §Status vocabulary. Surface concerns to the user; stop the loop on BLOCKED. Verification failure → retry candidate (see B3).
5. **Check in** per cadence — default: after each HITL chunk; batch AFK between check-ins. HITL always stops for sign-off before the next dispatch.

### B3. Replan vs soldier-through

**3-strike rule**: no chunk gets more than 3 dispatch attempts across retries and replans; after strike 3, stop and ask.

- **Retry (one attempt)** — single failure with obvious corrective brief (wrong path, off-by-one, missed import), or chunk benignly overshoots.
- **Replan** — two consecutive chunks fail verification (plan's mental model is wrong); a chunk invalidates later chunks' scope; user interrupts with new constraints.

**Restore point before replan.** Copy the current plan to `tmp/PLAN-<slug>.restore-<timestamp>.md` before mutating it, so "undo my last replan" is possible.

Replan = mark remaining chunks `superseded`, dispatch muse again from current repo state, save as `tmp/PLAN-<slug>-replan-N.md`, restart Phase B on that one.

**Stop-and-ask triggers:** strike 3 on any chunk, forge returned BLOCKED, replan #2 for the same slug.

### B4. Closeout

Run full project verification one more time (chunk N can silently break chunk N-2). Write a summary block at the bottom of the plan file: chunks completed, files touched, LOC delta, deferred items. Report the same to the user. **Do not commit** unless asked. Prompt the user to archive: rename to `tmp/PLAN-<slug>.done.md` or move to `tmp/archive/`.

## Defaults, gotchas, overrides

**Critical gotchas** (state at start of Phase B):

- You can't message mid-forge-call — each foreground dispatch blocks the session. Interrupting kills the work in progress.
- Each chunk should be <15 min of forge time. Overshoot = plan too coarse; split before dispatching.
- **Background forge is broken** — silently substitutes the dispatcher subagent's answer. Foreground only.
- Chunks can't share context — each forge call is fresh; re-brief from the plan file every time.

**Defaults** (override if user specifies):

- **Chunking**: vertical slices, each independently verifiable + deployable.
- **Chunk mode**: AFK unless ADR gate triggers (hard-to-reverse + surprising + real trade-off).
- **Check-in cadence**: after each HITL; batch AFK between.
- **Autonomy**: retry-once allowed; replan requires asking; 3-strike hard stop.
- **Verification**: project-standard lint + test + read diff.

**Customization phrases:**

- "Run through without stopping" → auto-proceed; still stop on verification failure and at closeout.
- "Check in every 3 chunks" → batch the B2.5 reports.
- "Skip lint, tests only" → reduce verification.
- "Group the small chunks" → merge adjacent trivial chunks in the plan file during B1 before dispatching.
- "Re-plan after chunk N" → stop after N; dispatch new muse; splice into remaining.

## Related files

- [references/alignment-rules.md](references/alignment-rules.md) — grill rules, decision classification, scope challenge (Phase A1).
- [references/chunk-format.md](references/chunk-format.md) — chunk contract, status vocabulary, durability principle (inline into muse's prompt in A2).
- [references/forge-prompt.md](references/forge-prompt.md) — per-chunk forge prompt skeleton and execution rules (Phase B2).
- [assets/plan-template.md](assets/plan-template.md) — fill-in template for the plan file.
- [references/investigation-report.md](references/investigation-report.md) — 2026-04-21 research into mattpocock/skills, gstack, karpathy-skills; source attribution.
