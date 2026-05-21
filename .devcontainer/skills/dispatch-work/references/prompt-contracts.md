# Prompt Contracts

Every spawned round child prompt starts with a five-entry `path_manifest`
generated from `scripts/dispatch-work-paths.ts`, before any task prose. All
prompt prose and contract fields must copy paths from that manifest
byte-for-byte. Do not derive, shorten, rename, normalize, relocate, or invent
dispatch paths.

```xml
<path_manifest source="scripts/dispatch-work-paths.ts">
  <prompt path="" />
  <log path="" />
  <status path="" />
  <launch_evidence path="" />
  <report path="" />
</path_manifest>
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
  <preserve_dirty_paths dirty_baseline="" artifact_write_roots=""
    dispatch_artifact_roots="" seedstack_artifact_roots=""
    gate_artifacts="" repo_edit_roots=""
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
  dirty_baseline="" artifact_write_roots="" dispatch_artifact_roots=""
  seedstack_artifact_roots="" gate_artifacts="" repo_edit_roots=""
  dispatcher_owned_seed_state="cli_only" />
<budget execute_rounds="3" implement_attempts="3" infra_respawns="1" />
<report path="" schema="summary-first.v1" />
```

| role | prefix | prompt/log/status/launch evidence | report name | add fields |
| --- | --- | --- | --- | --- |
| Research | `research-<i>` | root-level role artifact, no child run metadata unless spawned | `research-<i>.md` | focus, source precedence, requested outputs, source-hint candidate section |
| Execute | `execute` | `execute-prompt.md`, `execute.log`, `execute.status`, `execute-launch-evidence.json` | `executor-report.md` | round id, artifact dir, source hints path, nested access check, launch descriptor, exact Implement prompt, exact Review prompt, scope evidence, gate-output drift check |
| Implement | `implement-a<m>` | `implement-a<m>-prompt.md`, `implement-a<m>.log`, `implement-a<m>.status`, `implement-a<m>-launch-evidence.json` | `implement-a<m>-report.md` | edit scope, non-goals, dirty paths, gates with cwd/env, criteria, source hints path, no edits after Review starts |
| Review | `review-r<i>-a<m>` | `review-r<i>-a<m>-prompt.md`, `review-r<i>-a<m>.log`, `review-r<i>-a<m>.status`, `review-r<i>-a<m>-launch-evidence.json` | `review-r<i>-a<m>.md` | changed-file list or diff summary, criteria checklist, gates to inspect, focus/lens, source hints path, no peer findings |
| Verify | `verify-<i>` | `verify-<i>-prompt.md`, `verify-<i>.log`, `verify-<i>.status`, `verify-<i>-launch-evidence.json` | `verify-<i>.md` | Execute report path, all round artifacts, diff summary, gate outputs, waiver rules, focus, source hints path, no peer findings |

Prompt construction order is fixed: `path_manifest`, contracts, then task text.
`io_policy`, `launch_provenance`, and `child_artifact_contract` path attributes,
plus any task prose path references, must match the `path_manifest`
byte-for-byte. All path values are computed by the orchestrator from
`scripts/dispatch-work-paths.ts` and passed as concrete values. Agents write to
the exact `report_path` they receive. Do not construct file names.

`repo_edit_roots`, `artifact_write_roots`, `dispatch_artifact_roots`,
`seedstack_artifact_roots`, and `gate_artifacts` are distinct typed roots.
Research, Execute, Review, and Verify children use `child_writes="report_only"`:
they may write only their assigned dispatch report under artifact roots.
Implement reports are still dispatch artifacts, but Implement may also edit
files only under `repo_edit_roots` and only for assigned task scope.
For Seedstack work orders, `repo_edit_roots` is the union of behavior `area`
and optional `support_area`; `support_area` is limited to gate, harness,
wrapper, or report wiring and does not widen behavior ownership.
Root lists may be whitespace- or semicolon-separated and are normalized before
validation. `tmp/dispatch-work/**`, `tmp/seedstack/**`, and `.seeds/**` are
artifact/queue roots, never implementation roots. Legacy prompts may still use
`allowed_write_roots`; validators treat it as implementation scope only when
`repo_edit_roots` is absent.
Source refs, commands, research notes, gate commands, and prose examples do not
define edit scope. Validation checks actual dirty repo paths from the dirty
snapshot/status against `repo_edit_roots`.

All role markers and enum values are lowercase only. Desired output must not
ask children or Dispatcher to emit `close`, `closed`, `completed`, `complete`,
`Verdict`, `Outcome`, or `Recommendation`. Gate and Dispatcher output values
are only `done`, `retry`, or `escalate`; `close` is legacy input vocabulary, not
new output.

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
artifact. Source hints are process-required but not mechanically done-gating.

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
long evidence. The first bytes of the report are exactly the heading below:
no prose, title, metadata, blank intro, or second `## Summary` before it.
Required keys, in this order:

```markdown
## Summary
status: <role enum>
changed_files: <none|repo paths or count>
tests: <command/result summary or not run>
blockers: <none|count plus short label>
next_action: <done|retry|escalate|follow-up>
```

Role-specific `status` enums:

- Research, Review, Verify: `pass|risk|block`
- Execute: `pass|risk|block`
- Implement: `done|failed`

Keep values concise. Put detail, excerpts, and rationale below the summary.
Strict validation blocks missing summary blocks, missing keys, wrong key order,
multiple Summary blocks, any bytes before Summary, uppercase markers, or
invalid `status`/`next_action` values. Loop policy may soften report-summary
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
- `artifact_write_roots` records dispatch artifact writable roots
- `dispatch_artifact_roots`, `seedstack_artifact_roots`, and `gate_artifacts`
  may further split artifact roots when caller tracks them separately
- `repo_edit_roots` records repo roots Implement may edit; empty for read-only
  roles
- legacy `allowed_write_roots` is accepted only for old artifacts that lack
  typed write-root attrs
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
- Final child reply: `<report_path> <lowercase-status>`.
```

Reports from Dispatcher/Execute should attest that spawned prompts included the
applicable contract fields: path manifest, report path, IO policy paths,
artifact write roots, repo edit roots, dirty baseline, `.seeds/**` rule,
command-wrapper rule, review lens split, compact or legacy child artifact
contract, lowercase role enums, and no peer findings where relevant.

`status_path` may point to simple key/value text or JSON. A launcher that
explicitly supports heartbeat output may add a
supervisor heartbeat path; native/platform/simple child runs must not fail
solely because no heartbeat exists.

Contract ids are labels for audit and future tooling. The compact
`child_artifact_contract` tag is tooling-enforced because it carries the critical
rules as attributes; other prompt sections must still carry literal critical
rules such as dirty baseline, allowed roots, report path, and command-wrapper
expectations.
