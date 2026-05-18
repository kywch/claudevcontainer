---
name: capture-knowledge
description: Use after completing a dispatch work, research phase, review loop, or any workflow that produced non-obvious learnings worth preserving for future sessions.
---

# Capture Knowledge

Record and curate knowledge so future agents don't re-discover what this
session already learned.

## Inputs

- Repo path (prefer `.seeds/`; otherwise use repo-local artifact root from project docs)
- Completed work artifacts (dispatch-work reports, research notes, failed attempts)

## Safety

- Never record secrets, credentials, API keys, or PII.
- Never record verbatim code — describe the insight, not the implementation.
- Never record content from private repos without explicit permission.

## Storage

Single file: `.seeds/knowledge.jsonl` — git-tracked JSONL, one JSON
record per line. Records are added with `record`, removed with `remove`, and
bulk-curated with `rewrite`. Target: **under 80 records**. The entire file is read into
Research phase context — no search infrastructure needed at this scale.

Do not initialize `.seeds/` from this skill. `read` and `count` tolerate a
missing `.seeds/` directory and return an empty store. Mutating commands
(`record`, `remove`, `rewrite`) require `.seeds/` to already exist and fail
with `STORE_NOT_INITIALIZED` when it does not.

The script enforces a hard cap at 80 records — it refuses to add new
records past that and requires curation first. A warning fires at 60.

Tool script: `/workspace/.devcontainer/skills/capture-knowledge/knowledge-store.ts`
(installed path). Invoke it from the target repo root using this absolute path,
or set `KNOWLEDGE_STORE` as shown below.

```bash
KNOWLEDGE_STORE=/workspace/.devcontainer/skills/capture-knowledge/knowledge-store.ts

# Record (JSON arg)
bun "$KNOWLEDGE_STORE" record .seeds/knowledge.jsonl \
  '{"type":"failure","content":"..."}'

# Record (stdin — preferred, avoids shell-escaping issues)
echo '{"type":"failure","content":"don'\''t use process.exit()"}' | \
  bun "$KNOWLEDGE_STORE" record .seeds/knowledge.jsonl --stdin

# Read all
bun "$KNOWLEDGE_STORE" read .seeds/knowledge.jsonl

# Count (with type breakdown)
bun "$KNOWLEDGE_STORE" count .seeds/knowledge.jsonl

# Remove by id
bun "$KNOWLEDGE_STORE" remove .seeds/knowledge.jsonl ex-a1b2c3

# Rewrite (bulk curation — replaces entire file atomically)
echo '[...]' | bun "$KNOWLEDGE_STORE" rewrite .seeds/knowledge.jsonl --stdin
```

All storage paths above are relative to repo root. Commands always write one
JSON envelope to stdout: `{ "ok": boolean, "command": "...", "data": ..., "error": ... }`.
Failures leave stderr empty, exit 1, and set `error.code`.

## Git Setup

Add `merge=union` to prevent merge conflicts on concurrent branches:

```
# .seeds/.gitattributes
knowledge.jsonl merge=union
```

## Record Schema

```jsonc
{
  "id": "ex-a1b2c3",           // auto-generated from type+content hash
  "type": "convention|pattern|failure|decision|reference|guide",
  "content": "...",             // self-contained insight; no artifact lookup required
  "recorded_at": "2026-05-07T..."  // auto-set
}
```

ID is derived from `type:content` hash — recording the same insight twice
upserts (updates timestamp) instead of duplicating.

`rewrite` input must be a JSON array of complete, valid records. Every record
must include `id`, `type`, `content`, and `recorded_at`; missing fields or
invalid shapes are rejected instead of being repaired implicitly.

`content` must stand alone if `tmp/dispatch-work/<seed-id>/**` is deleted. Do
not rely on artifact paths, transcripts, or external evidence to explain what
happened or what to do next. Use this compact shape when possible:

`When <scope>, beware <symptom>. Cause: <why>. Do: <action>. Verify: <gate/test/oracle>. Limit: <when not to apply>.`

### Type Guide

| Type | When to use | Example |
|------|-------------|---------|
| convention | Project-wide rule agents must follow | "JSONL files use merge=union gitattribute" |
| pattern | Reusable approach that worked | "Spawn 2 narrow research agents for file-scoped work" |
| failure | Something broke — capture so it doesn't recur | "process.exit() kills Vitest; use process.exitCode" |
| decision | Architectural choice with rationale | "XML prime format chosen — 40% accuracy gain for Claude" |
| reference | Pointer to stable project resource | "API rate limits are documented in vendor/limits.md" |
| guide | How-to for a non-obvious procedure | "To add a conformance case: edit cases.yaml, run runner" |

## When to Capture

1. **After Gate/Done in dispatch-work** — review artifacts, extract learnings
2. **After a failed Execute round** — capture what went wrong and why
3. **After Research discovers something non-obvious** — file/API gotchas,
   CI quirks, dependency constraints
4. **When a decision has non-obvious rationale** — the "why" behind a choice
   that future agents would get wrong without context

## Recording Gate

Before recording, ask:

1. **Is this non-obvious?** Would an agent waste >5 minutes without it?
2. **Is it specific?** "Be careful with tests" = no. "Ajv strict mode
   requires explicit type:'object' on every schema" = yes.
3. **Is it durable?** Will this still be true next week?
4. **Is it already documented?** Check CLAUDE.md / AGENTS.md first.
5. **Does it duplicate an existing record?** Read the store first.
6. **Is it self-contained?** Would it remain actionable if
   `tmp/dispatch-work/<seed-id>/**` and all supporting artifacts were deleted?

If any answer is "no", don't record. Typical yield: **0-3 records per
session**. If you're recording more, your gate is too loose.

## How to Record

### Step 1 — Read existing knowledge

Read `.seeds/knowledge.jsonl` directly. Review what's already captured.
Do not duplicate.

### Step 2 — Extract candidates via subagents

Spawn subagents to read dispatch artifacts (or other completed work).
Each subagent should:

1. Read all artifacts in its assigned scope (e.g. one dispatch directory).
2. Scan for `<!-- KNOWLEDGE: ... -->` markers left by Research, Review,
   and Verify agents.
3. Also identify **unmarked** non-obvious insights — markers are hints,
   not exhaustive.
4. Apply the recording gate to each candidate.
5. Return only candidates that pass all six gate checks, with type,
   and self-contained content.

Subagent prompt template:

```
Read all artifacts in tmp/dispatch-work/<seed-id>/. Also read .seeds/knowledge.jsonl
for existing records.

Extract knowledge candidates:
- Scan for <!-- KNOWLEDGE: ... --> markers
- Treat `knowledge: none - <specific reason>` as an explicit no-candidate
  assertion for that artifact.
- Identify unmarked non-obvious insights (gotchas, failures, decisions)
- Apply the recording gate: non-obvious? specific? durable? not in docs? not duplicate? self-contained without tmp artifacts?
- Return ONLY candidates that pass all checks as JSON:
  {"type":"...","content":"..."}

Typical yield: 0-3 per dispatch. Return empty list if nothing qualifies.
Do NOT edit any files.
```

### Step 3 — Write capture audit

For each dispatch completion or failed execute round, start
`tmp/dispatch-work/<seed-id>/knowledge-capture.md` before recording and
complete it after record commands finish. Include:

- existing store count and whether `.seeds/.gitattributes` has
  `knowledge.jsonl merge=union`
- marker scan result, including marker count
- artifacts reviewed
- candidates considered, including candidate count
- rejected candidates with gate reason
- accepted records as JSON without `evidence`
- accepted IDs and rejected count
- store count before/after and record command outputs

If no candidate qualifies, set `capture_state=none_qualified` and include:
store count, merge-union check, marker count, artifacts reviewed, candidate
count, rejected count, and an explicit none/rejected rationale.

### Step 4 — Record

For each candidate the subagent returns, record via `--stdin`:

```bash
KNOWLEDGE_STORE=/workspace/.devcontainer/skills/capture-knowledge/knowledge-store.ts
cat <<'EOF' | bun "$KNOWLEDGE_STORE" record .seeds/knowledge.jsonl --stdin
{"type":"failure","content":"When supervising Bun child processes that may spawn grandchildren, beware orphaned work after timeout. Cause: killing only the direct child can leave the process group alive. Do: launch in its own process group and terminate the group with a negative PID when supported. Verify: timeout test confirms child and grandchild exit. Limit: use platform/native cancellation when process groups are unavailable."}
EOF
```

The output includes `data.count` and `data.warning` if curation is needed.
If the command returns `STORE_NOT_INITIALIZED`, do not create `.seeds/` here;
record the skipped capture in the audit and leave repository initialization to
the queue/project owner.

### Knowledge Markers

Dispatch artifacts may contain inline markers:

```markdown
<!-- KNOWLEDGE: type=failure | description here -->
```

These are **hints from artifact-producing agents** (Research, Review,
Verify). They flag something the agent found surprising or non-obvious
during its work. The marker format:

```
<!-- KNOWLEDGE: type=<type> | <one-line description> -->
```

Markers lower the extraction cost — subagents can grep for them — but
the recording gate still applies. A marker does not guarantee recording.

Research, Review, and Verify artifacts should include either a concrete marker
or `knowledge: none - <specific reason>` so capture can audit intentional
non-recording decisions.

### Step 5 — Curate if needed

Check the count:

```bash
KNOWLEDGE_STORE=/workspace/.devcontainer/skills/capture-knowledge/knowledge-store.ts
bun "$KNOWLEDGE_STORE" count .seeds/knowledge.jsonl
```

If count exceeds 60, review and trim:

1. Read all records
2. Identify: duplicates, stale observations, records now in docs
3. Remove individually or rewrite the cleaned set:

```bash
bun "$KNOWLEDGE_STORE" remove .seeds/knowledge.jsonl ex-abc123
```

For rewrite, start from a full valid record array and preserve `id`, `type`,
`content`, and `recorded_at`. Do not rewrite from capture candidates. The prep
example requires `jq`; use equivalent JSON extraction if `jq` is unavailable.

```bash
bun "$KNOWLEDGE_STORE" read .seeds/knowledge.jsonl | jq '.data' > tmp/knowledge-records.json
# edit tmp/knowledge-records.json as a JSON array
bun "$KNOWLEDGE_STORE" rewrite .seeds/knowledge.jsonl --stdin < tmp/knowledge-records.json
```

Target: **under 80 records, ideally 40-60**.

## How to Consume (for other skills)

At the start of Research or any context-gathering phase, spawn a subagent
to read `.seeds/knowledge.jsonl` and write
`tmp/dispatch-work/<seed-id>/knowledge-scout.md`. The scout filters records
relevant to the current work order's domain, files, and acceptance criteria.
Include IDs plus a short applicability reason, and include a brief
"not relevant" section for high-risk ignored records to prevent prompt bloat.
Reference the scout from `packet.md` and Research prompts.

At <80 records (~15-20K tokens), reading the full file is a fraction of
typical research context. No search infrastructure needed — the subagent
reads everything and selects what matters for this task.

## Stuck?

| Problem | Fix |
|---------|-----|
| Lock timeout | Another writer may hold `.seeds/knowledge.jsonl.lock`; mutating commands wait up to 5s. Wait and retry; if the writer died, rerun after lock age exceeds 30s so the next mutating command can clear it. Delete manually only after confirming no writer is running |
| Store not initialized | `.seeds/` is absent. Skip capture or ask the project/queue owner to initialize seed storage; do not create `.seeds/` from this skill |
| Store full (80 records) | Run `count`, then `remove` or `rewrite` to curate below 80 |
| Shell escaping errors | Use `--stdin` instead of passing JSON as argument |
| Corrupt JSONL | `read` and `count` fail with the bad line number; recover by reconstructing complete valid records, then `rewrite` the cleaned JSON array |
| Bun not available | Script requires Bun runtime — install via `curl -fsSL https://bun.sh/install \| bash` |
