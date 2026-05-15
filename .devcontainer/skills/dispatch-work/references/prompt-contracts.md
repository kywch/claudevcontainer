# Prompt Contracts

Every spawned prompt includes the common contract fields that apply to its role:

```xml
<contract id="dispatch-work" version="" />
<work order id="" title="" assignee="" />
<packet path="tmp/dispatch-work/<work-id>/packet.md" summary_max_bullets="8" />
<tool_preflight path="tmp/dispatch-work/<work-id>/tool-preflight.md" />
<source_hints path="tmp/dispatch-work/<work-id>/source-hints.json"
  contract="dispatch_source_hints.v1" />
<io_policy prompt_path="" log_path="" status_path=""
  launch_evidence_path="" report_path="" no_parent_transcript_polling="true" />
<rules>
  <no_seed_mutation path=".seeds/**" />
  <preserve_dirty_paths dirty_baseline="" allowed_write_roots=""
    dispatcher_owned_seed_state="cli_only" />
  <commands obey_repo_wrappers="true"
    no_unavailable_aliases_or_parent_only_tools="true" />
</rules>
<launch_provenance parent_launch_id="" launch_evidence_path=""
  status_owner="parent_or_supervisor" />
<child_artifact_contract ref="dispatch-child-artifact.v2" report_path=""
  status_owner="parent_or_supervisor" child_writes="report_only"
  no_seed_mutation=".seeds/**" command_wrapper="repo-native"
  no_parent_transcript_polling="true" preserve_dirty_paths="required"
  dirty_baseline="" allowed_write_roots=""
  dispatcher_owned_seed_state="cli_only" />
<budget execute_rounds="3" implement_attempts="3" infra_respawns="1" />
<report path="" schema="summary-first.v1" />
```

| role | prefix | report name | add fields |
| --- | --- | --- | --- |
| Research | `research-<i>` | `research-<i>.md` | focus, source precedence, requested outputs, source-hint candidate section |
| Execute | `execute` | `executor-report.md` | round id, artifact dir, source hints path, nested access check, launch descriptor, exact Implement prompt, exact Review prompt, scope evidence, gate-output drift check |
| Implement | `implement-a<m>` | `implement-a<m>-report.md` | edit scope, non-goals, dirty paths, gates with cwd/env, criteria, source hints path, no edits after Review starts |
| Review | `review-r<i>-a<m>` | `review-r<i>-a<m>.md` | changed-file list or diff summary, criteria checklist, gates to inspect, focus/lens, source hints path, no peer findings |
| Verify | `verify-<i>` | `verify-<i>.md` | Execute report path, all round artifacts, diff summary, gate outputs, waiver rules, focus, source hints path, no peer findings |

All `io_policy` paths (`prompt_path`, `log_path`, `status_path`,
`launch_evidence_path`, `report_path`) are computed by the orchestrator from
`scripts/dispatch-work-paths.ts` and passed as concrete values. Agents write to the
exact `report_path` they receive. Do not construct file names.

## Source Hints

Research reports source-hint candidates for the current seed. Dispatcher
compiles those candidates into `tmp/dispatch-work/<work-id>/source-hints.json`
before Execute starts. If Research coverage exists but no candidate is useful as
a hint, Dispatcher still writes the file with an empty `sources` array and a
short note. Later Execute, Implement, Review, and Verify prompts receive the
path and read it before source discovery; if the file is missing, malformed,
wrong contract, or otherwise invalid, they ignore it and continue from
packet/source files. Hints are advisory prompt context only; source files remain
authoritative, and reports must cite real source files rather than this hint
artifact. Source hints are process-required but not mechanically close-gating.

Shape:

```json
{
  "contract": "dispatch_source_hints.v1",
  "sources": [
    { "path": "relative/source/path", "lines": [1, 2], "why": "short reason" }
  ],
  "notes": []
}
```

Constraints: max 12 sources; each `path` is repo-relative, not absolute and not
`..`; `lines` contains positive integers; `why` is concise, <=200 chars, and
does not copy spec text. Children may use hints to choose files to inspect, but
must verify against current files before reporting.

Every child report starts with a small summary block before detailed findings or
long evidence. Required keys, in this order:

```markdown
## Summary
status: pass|risk|block|done|failed
changed_files: <none|repo paths or count>
tests: <command/result summary or not run>
blockers: <none|count plus short label>
next_action: <done|retry|escalate|follow-up>
```

Keep values concise. Put detail, excerpts, and rationale below the summary.
Strict validation blocks missing summary blocks, missing keys, wrong key order,
or invalid `status`/`next_action` values; loop policy may soften report-summary
shape issues so `seedstack` can ask for follow-up instead of hard-stopping.

Prefer the compact child artifact contract tag above. It is equivalent to the
legacy literal child artifact contract below and avoids repeated Markdown bloat.
Legacy prompt artifacts that include the literal block remain valid.

Compact form requirements:

- `ref="dispatch-child-artifact.v2"`
- `report_path` exactly matches the assigned report path
- `status_owner="parent_or_supervisor"`
- `child_writes="report_only"`
- `no_seed_mutation=".seeds/**"`
- `command_wrapper="repo-native"`
- `no_parent_transcript_polling="true"`
- `preserve_dirty_paths="required"`
- `dirty_baseline` records the baseline source or id used for dirty guarding
- `allowed_write_roots` records the assigned writable roots
- `dispatcher_owned_seed_state="cli_only"`

Legacy form:

```text
Child artifact contract:
- Parent/supervisor writes status_path as key=value lines or JSON. Children
  write report_path only; do not self-attest liveness/status. Required status
  keys:
  contract=child_run_status.v2 role state cwd started_at updated_at
  launcher attempt liveness_handle parent_launch_id launch_evidence_path
  prompt_path log_path report_path. On terminal also set ended_at exit_code
  signal timeout.
- launch_evidence_path points to parent-owned JSON:
  contract=child_launch_evidence.v1 parent_launch_id role attempt launcher
  liveness_handle prompt_path log_path status_path report_path status_writer.
  Its role/attempt/launcher/handle/paths must match status_path.
- Preferred Codex child roles use `launcher=spawn_agent` and
  `liveness_handle=spawn_agent:<agent-id>`. Claude Code children use
  `launcher=claude_agent` and `liveness_handle=claude_agent:<agent-id>`.
  Non-native supervised environments may use `launcher=supervisor`,
  `launcher=codex_cli_supervisor`, or `launcher=claude_cli_supervisor` with
  `liveness_handle=supervisor:<run-id>` or a real `pid:<n>`, `pgid:<n>`, or
  `session:<id>` captured before stdout/stderr suppression.
- state enum: starting|running|completed|failed_exit|failed_signal|
  failed_timeout|infra_failed|unknown_terminal_state.
- If no durable liveness_handle can be captured before spawn, do not run child:
  parent/supervisor writes state=infra_failed plus failure-capsule.md.
- Do not create artifact indexes. Do not compute bytes or sha256 for dispatch
  bookkeeping.
- Bare files containing only `0`, `pass`, `risk`, `block`, `verdict`, or
  `state=<x>` are invalid status artifacts.
- Placeholder artifacts containing only `TODO`, `TBD`, `placeholder`, or
  `not run` are invalid. Prompt artifacts must include the compact
  `child_artifact_contract` tag or this legacy literal child artifact contract,
  plus the `.seeds/**` mutation rule, the command-wrapper rule, launch
  provenance fields, and the assigned report path.
- Final child reply: `<report_path> <verdict_or_outcome>`.
```

Reports from Dispatcher/Execute should attest that spawned prompts included the
applicable contract fields: report path, IO policy paths, allowed write/read
scope, dirty baseline, `.seeds/**` rule, command-wrapper rule, review lens
split, compact or legacy child artifact contract, and no peer findings where
relevant.

`status_path` may point to simple key/value text or JSON. A launcher that
explicitly supports heartbeat output may add a
supervisor heartbeat path; native/platform/simple child runs must not fail
solely because no heartbeat exists.

Contract ids are labels for audit and future tooling. The compact
`child_artifact_contract` tag is tooling-enforced because it carries the critical
rules as attributes; other prompt sections must still carry literal critical
rules such as dirty baseline, allowed roots, report path, and command-wrapper
expectations.
