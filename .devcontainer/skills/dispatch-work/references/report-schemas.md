# Report Schemas

## Summary Defaults

Parent agents read summaries before artifact bodies.

- report summary: path, lowercase status lines, headings, blockers
  count, gate pass/fail summary
- diff summary: `git diff --stat`, `git diff --name-status`, and scoped hunks
  only for a named finding or conflict
- test summary: command, cwd/env, exit code, pass/fail counts, first failing
  test names, raw log path
- child-run summary: prompt/log/status/report paths, terminal state, exit
  status, timeout/signal flags, report freshness/nonempty/schema-valid result,
  failure capsule path when dirty
- work-order summary: path, contract, missing/unknown critical fields, and
  user-approved assumptions

Full artifact bodies are forbidden by default. Allowed parent excerpts are one
named report section, one failing test block, the first error block, or the
final 40-80 log lines, each with a stated source path and cap.

## Research

- status: `pass`, `risk`, or `block`

| field | cap | notes |
| --- | ---: | --- |
| focus area | - | assigned scope |
| knowledge scout | - | `knowledge-scout.md` records used or intentionally ignored |
| governing sources | - | short clause refs |
| source hints | 12 | `source-hints.json`; advisory only; empty `sources` allowed with note |
| likely files | 10 | reason/confidence |
| acceptance criteria | 10 | mark inferred |
| gate commands | 8 | cwd/env/purpose |
| risks, non-goals, review focus | - | concise |

No copied docs beyond short clause refs.

## Implement

- status: `done` or `failed`
- changed files: path plus one-line purpose
- blockers fixed and cleanup/hardening done, each max 5
- gates: cwd, env or relevant PATH/tool identity, command, pass/fail, exit
  code, final 5 relevant lines only
- note meaningful drift between baseline and final gate outputs, including
  changed totals, target lists, tool versions, runner identity, or inventory
- blockers: ranked, max 5
- risks or follow-ups: max 5
- no patch text, full logs, or search transcript

## Execute

- status: `pass`, `block`, or `risk`
- Implement report path
- Review report paths
- tool preflight path and launch descriptors used
- source hints: used, ignored, or unavailable; include reason when ignored
- gates: cwd, env or relevant PATH/tool identity, command,
  pass/fail/skipped, exit code, reason, final 5 relevant lines only
- scope evidence: changed-file list or diffstat summary, plus known dirty paths
- audit evidence: gate timestamps or round timestamp, and runner identity when
  gate output depends on a rebuilt tool or external inventory
- prompt-contract attestation for spawned Implement/Review prompts: report
  path, scope, dirty baseline, `.seeds/**`, command-wrapper rule, review
  lenses, and peer-finding isolation
- merged Review queue: blockers fixed, cleanup/hardening done,
  cleanup/hardening deferred with rationale and residual risk
- explain meaningful drift between baseline and final gate outputs, including
  changed totals, target lists, tool versions, runner identity, or inventory
- next_action: `done`, `retry`, or `escalate`; include
  `follow_up_proposals[]` separately when needed
- waivers recommended, not granted
- no patch text, full logs, or search transcript

## Review

- status: `pass`, `block`, or `risk`
- blocking findings only, max 5
- each finding: severity, file:line, symptom, acceptance criterion violated,
  minimal fix hint
- cleanup/hardening opportunities, max 5: file:line or area, improvement, why
  it matters, suggested minimal change, and whether it is in-scope for this seed
- pass or risk status includes a concise checklist of acceptance criteria or
  invariants inspected, with source/file refs where useful
- source hints: used, ignored, or unavailable; include reason when ignored
- use concrete evidence refs for nontrivial inspected criteria; `path:line` is
  preferred for code/spec evidence, while command-result summaries need no line
  refs
- nonblocking risks, max 3
- gates inspected, without full output
- no full diffs, copied docs, search transcript, or low-confidence speculation

## Verify

- status: `pass`, `block`, or `risk`
- checked Execute round and artifact paths
- source hints: used, ignored, or unavailable; include reason when ignored
- blocking findings only, max 5
- each finding: severity, artifact or file:line, symptom, missed criterion,
  minimal next Execute instruction
- nonblocking risks, max 3
- cleanup/hardening deferrals inspected: accept as deferred only when the
  Execute report records scope/risk rationale; otherwise classify actionable
  in-scope gaps as `risk` or `block` depending on severity and seed scope
- use concrete evidence refs for nontrivial inspected criteria; artifact
  section refs are acceptable when verifying reports rather than code
- no full diffs, copied docs, search transcript, or low-confidence speculation

## Artifact Validation

Before `gate.md`, Dispatcher validates: required files exist and are nonempty,
latest-round artifacts are exclusive, lowercase role-specific status values are
valid, gate records are present, waivers are present or explicitly absent,
`dirty_guard.v1` is recorded when available, and all accepted dispatch artifact paths from the `## Evidence`
or `## Evidence Paths` table are under repo-root-relative
`tmp/dispatch-work/<work-id>/`. Gate command/result tables are separate evidence
about checks run; their command, cwd, source, and implementation path columns are
not accepted artifact paths. Misplaced parent-root artifacts are rejected or
explicitly ignored, done/escalate terminal outcomes are exclusive, and follow-up
proposals are nonterminal data for `seedstack` manage mode. Dispatcher and gate
outputs use only `done`, `retry`, or `escalate`; `close`, `closed`,
`completed`, and `complete` are legacy/input words and must not be emitted as
desired output.

Round child prompt/report path validation requires the `path_manifest` generated
from `scripts/dispatch-work-paths.ts` before task text. `io_policy`,
`launch_provenance`, `child_artifact_contract`, and task prose path references
must match manifest values byte-for-byte. Derived, shortened, renamed, or
relocated dispatch paths are invalid. `repo_edit_roots`,
`artifact_write_roots`, `dispatch_artifact_roots`, `seedstack_artifact_roots`,
and `gate_artifacts` are validated as typed roots:
`child_writes=report_only` allows only assigned dispatch report writes under
artifact roots; Implement may edit repo files only under `repo_edit_roots`.
Root lists accept whitespace or semicolon separators. Dispatch artifacts
(`tmp/dispatch-work/**`), seedstack artifacts (`tmp/seedstack/**`), and
`.seeds/**` are excluded from implementation-root checks. Legacy
`allowed_write_roots` remains accepted for old artifacts, but typed
`repo_edit_roots` wins when present.
Source refs, commands, gate command paths, research notes, and prose examples
are not edit evidence. Actual changed repo paths from the dirty
snapshot/status must fall under `repo_edit_roots`; out-of-scope prose mentions
alone do not block.

Child run validation also requires: status path exists, launch evidence path
exists, prompt/log/report paths are repo-root-relative under
`tmp/dispatch-work/<work-id>/`, report exists, report is nonempty and schema-valid,
report freshness is consistent with child end status, and any nonzero exit,
signal, timeout, missing report, stale report, malformed report, or unknown
terminal state has a bounded `failure-capsule.md`. Missing or invalid status,
missing launch evidence, missing log path, launcher setup failure, or unknown
terminal state is also a dirty terminal state; if the child cannot write a
capsule, the parent writes an infra failure capsule from available metadata. A
stale heartbeat is dirty only for supervised runs that explicitly produce
heartbeat artifacts.

Invalid child status includes files whose only terminal content is `0`, `pass`,
`risk`, `block`, `verdict`, or `state=<x>`. Status must carry
`contract=child_run_status.v2` or equivalent JSON version plus role, state,
cwd, started_at, updated_at, launcher, attempt, liveness_handle,
`parent_launch_id`, `launch_evidence_path`, prompt path, log path, report path,
and terminal exit/signal/timeout fields when ended. Valid launcher values are
`spawn_agent`, `claude_agent`, `supervisor`, `codex_cli_supervisor`, and
`claude_cli_supervisor`; raw `launcher=codex` is invalid for valid child
runs. Valid liveness handles are
`spawn_agent:<id>`, `claude_agent:<id>`, `session:<id>`,
`supervisor:<run-id>`, `pid:<n>`, or `pgid:<n>` with real non-placeholder IDs.
Fake/self-attested handles such as
`spawn_agent:research-code`, `spawn_agent:*local*`,
`session:codex-current`, or `supervisor:*` without launch evidence are invalid.
Valid terminal states are `completed`, `failed_exit`, `failed_signal`,
`failed_timeout`, `infra_failed`, and `unknown_terminal_state`; `starting` and
`running` are not clean terminal states.

Launch evidence is parent/supervisor-owned JSON at the exact prefix-based path
from `childRunPaths(...)`:
`tmp/dispatch-work/<work-id>/round-<n>/<prefix>-launch-evidence.json`. Examples
include `execute-launch-evidence.json`, `implement-a1-launch-evidence.json`,
`review-r1-a1-launch-evidence.json`, and `verify-1-launch-evidence.json`. Do
not use role-only names, dotted names, or `launch-evidence/` subdirectories.
Launch evidence carries `contract=child_launch_evidence.v1`,
`parent_launch_id`, role, attempt, launcher, liveness handle, prompt path, log
path, status path, report path, and status owner/writer. Clean status must
reference launch evidence whose role/attempt/launcher/handle/paths match the
status artifact.

Validator output contract:

```json
{
  "contract": "dispatch-work-validation.v1",
  "ok": true,
  "blockers": [],
  "warnings": [],
  "summary": {
    "seed": "<work-id>",
    "selectedRound": 1,
    "statuses": { "checked": 4, "clean": 4, "dirty": 0 },
    "reports": { "checked": 4, "execute": 1, "implement": 1, "review": 1, "verify": 1 },
    "gate": { "present": true, "decision": "done", "acceptedPaths": 4 }
  }
}
```

`seedstack` reconciliation accepts only `dispatch-work-validation.v1`.
`blockers` and `warnings` are arrays of `{ code, message, path? }`. A local
done result requires `ok: true`, at least one accepted gate evidence path, and
zero dirty statuses. Legacy validator output may still use
`summary.gate.decision: "close"` as an alias for local done; it never authorizes
queue close and must not be re-emitted by Dispatcher or gate reports.

## Child Run Artifacts

Each child run must produce the artifact set defined by `prompt-contracts.md`.
Role reports must be written atomically via temp file then rename or with an
end marker that proves freshness. `failure-capsule.md` is required for dirty
terminal states.

Child report bytes start with exactly one `## Summary` block. No prose,
frontmatter, title, metadata, or blank intro may precede it, and no second
`## Summary` may appear before detailed sections. Summary markers are lowercase:
`status`, `changed_files`, `tests`, `blockers`, and `next_action`. Uppercase
`Verdict`, `Outcome`, or `Recommendation` are invalid as desired output labels.

Optional supervised wrapper artifacts include `runs/<run-id>/`,
`status.json` with sequence/phase metadata and `heartbeat.jsonl`. They are not
required for native/platform/simple child runs.

Success report/summary target is <=2k chars. Failure capsule target is <=8k
chars and may include command, phase, cwd, duration, exit code/signal/timeout,
last status update or native child state, changed-file summary, first error
block, final bounded log tail, and artifact paths. Reports may reference child
logs and status paths, but must not embed raw transcripts.

Clean success requires terminal success status, exit code `0` when available,
fresh schema-valid report, and no dirty terminal state. Dirty terminal states
include failed exits, signals, timeouts, missing/stale/malformed reports,
missing/invalid status, missing logs, launcher setup failures, unknown terminal
state, and stale heartbeat for heartbeat-enabled supervised runs.

## Gate

`gate.md` records:

- decision: `done`, `retry`, or `escalate` (`close` is accepted only as legacy
  validator input vocabulary for local done; do not output `close`, `closed`,
  `completed`, or `complete`)
- evidence refs: accepted repo-root-relative artifacts and ignored/misplaced
  artifacts
- child run validation summary: status/report/capsule validity for latest
  relevant runs
- gates: command, cwd/env, pass/fail/skipped, inventory drift, waiver or
  boundary-deferred status
- waivers: approver, reason, scope, residual risk, expiry if any
- boundary_deferred assertions: exact assertion id/signature, failed gate,
  why out-of-boundary, later owner work order id, carry-forward gate
- blockers and cleanup/hardening: fixed, waived, deferred with rationale, or
  escalated
- dirty guard result and known dirty paths. New gates use structured
  `dirty_guard.v1` as authority with `baseline_paths`, `actual_impl_paths`,
  `queue_paths`, `unexpected_paths`, and `snapshot_path`; markdown Dirty Guard
  text remains human-readable compatibility only. Placeholder or blank
  implementation paths are invalid. Legacy markdown guards remain accepted only
  when the structured block is absent.
- unresolved risk and final rationale

Done and escalate are terminal and exclusive. Follow-up proposals are
nonterminal data for `seedstack` manage mode.

## Knowledge Capture

`.seeds/knowledge.jsonl` is an append-only knowledge log. It is the only
`.seeds/**` path knowledge capture may dirty, and only by appending records.
Dispatcher, Execute, Implement, Review, Verify, and dispatch children must not
mutate it directly.

`knowledge-scout.md` is pre-work context selection from existing knowledge.
`knowledge-capture.md` is post-work audit and optional recording output at
`tmp/dispatch-work/<work-id>/knowledge-capture.md`.

Research, Review, and Verify reports must include one of:

- a concrete `<!-- KNOWLEDGE: type=<type> | <one-line description> -->`
  candidate marker
- `knowledge: none - <specific reason>`

`knowledge-capture.md` records:

- capture_state:
  `recorded|none_qualified|store_missing|skipped_user_waived`
- existing store count and merge setup check for `.seeds/.gitattributes`
- marker scan result
- candidate records considered
- rejected candidates with recording-gate reason
- accepted records as self-contained JSON without `evidence`
- store count before/after and record command outputs

For `capture_state=none_qualified`, the audit must still include these minimal
fields: existing store count, merge-union check, marker count, artifacts
reviewed, candidate count, rejected count, and an explicit none/rejected
rationale. Prose/status-only `none_qualified` reports are invalid for
close/done.

For `capture_state=recorded`, accepted records must be represented as accepted
IDs already present in the store or as structured `accepted_records` JSON that
the validator can parse. Prose-only accepted-record summaries are invalid.

Final Dispatcher reports include a `Knowledge Capture` block with
`knowledge-capture.md`, capture_state, accepted IDs, rejected count, marker
count, and final store count. If no candidate passes, record
`capture_state=none_qualified` and zero accepted IDs rather than omitting the
block. If the store is absent and not initialized, record
`capture_state=store_missing`. If the user explicitly waives capture, record
`capture_state=skipped_user_waived` with scope and approver.

## Completion Barrier

Before reporting local done, Dispatcher must satisfy Gate Decisions in
`waivers-and-gating.md` and this barrier:

1. Validate latest-round artifacts, status/report freshness, role-specific
   enums, path_manifest byte-for-byte path matches, artifact_write_roots vs
   repo_edit_roots, gate inventory drift, waivers, boundary-deferred records
   when used, dirty guard, and terminal exclusivity.
2. Write `gate.md` and capture path, mtime when available, decision, and
   completion timestamp.
3. Confirm no queue mutation was performed by dispatch-work. `.seeds/**`
   mutations are allowed only when `capture-knowledge` appended
   `.seeds/knowledge.jsonl`.
4. Write `tmp/dispatch-work/<work-id>/events/<seq>-done.json` with artifact
   paths and validation summary before the final Dispatcher report.

If steps fail, write/update `gate.md` with `decision: retry` or
`decision: escalate`; do not report done. If queue state appears mutated,
escalate to seedstack/manual audit instead of attempting repair.

Escalation uses the same event rule:
`tmp/dispatch-work/<work-id>/events/<seq>-escalate.json`, including artifact paths,
reason, dirty state, and next action. Terminal event files are append-only:
write a new event for later resolution instead of editing an old terminal
event.

## Final Dispatcher Report

| area | include |
| --- | --- |
| identity | work order id, round ids, timestamps |
| artifacts | evidence refs, ignored artifacts, terminal event path |
| results | Research, Execute, Implement, Review, Verify |
| gate | decision, waivers, unresolved risk, gate evidence/mtime, completion timestamp |
| queue context | queue id and claim evidence if provided |
| diff ownership | dispatcher CLI changes, implementation changes, pre-existing dirty paths |
| knowledge capture | `knowledge-capture.md`, accepted IDs, rejected count, marker count, final store count |
| routing | prompt-contract attestation, seedstack follow-up proposals |
