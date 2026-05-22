# Subagent Orchestration

## Agent Counts

| agent | default | scale up when |
| --- | ---: | --- |
| Research | 2: code/context and gates/spec | broad, unknown, security, concurrency, storage, migration, conformance |
| Review | 1 narrow low-risk, 2 normal code/test | broad, cross-cutting, high-risk, conformance repair |
| Verify | 2 normal rounds | 3 for broad/security/concurrency/storage/spec; 4 when gates skipped/waived or diff spans subsystems |

Use 1 Research only for narrow docs-only seeds.

When `review_lenses` includes `deslop`, assign that lens to one Review agent
within the planned Review count. Add a Review agent only when the planned count
cannot cover both required default review coverage and the lens. When
`verify_lenses` includes `thermo-nuclear`, assign that lens to one Verify agent
within the planned Verify count; add a Verify agent only when default Verify
coverage would otherwise be displaced.

Lens reports use the same `pass|risk|block` schema and the same done-gate
rules as standard Review/Verify reports. A lens is extra required focus, not an
advisory side channel or a waiver from validator preconditions.

## Launchers

Codex environments use the native `spawn_agent` launcher for Implement, Review,
and Verify child roles. Claude Code environments use the native `Agent` tool
(`launcher=claude_agent`). The parent records a launch descriptor with
`parent_launch_id`, role, seed, round, attempt, prompt path, log path, status
path, report path, launcher, native child id, and `launch_evidence_path`. The
parent owns liveness, writes `child_run_status.v2`, waits on the native child,
and writes terminal status only after the child reaches a terminal API state.
Children write reports, not status/liveness self-attestation. A nonterminal
`role+attempt` status blocks relaunch until the parent cancels, times out, or
records a dirty terminal state for that same attempt.

Canonical child paths are computed only by
`scripts/dispatch-work-paths.ts`. Dispatcher/Execute must call
`childRunPaths(...)` for each child run and paste the full returned 5-path
`path_manifest` into the child prompt before launch:

```text
path_manifest:
  prompt: tmp/dispatch-work/<work-id>/round-<n>/<prefix>-prompt.md
  log: tmp/dispatch-work/<work-id>/round-<n>/<prefix>.log
  status: tmp/dispatch-work/<work-id>/round-<n>/<prefix>.status
  launch_evidence: tmp/dispatch-work/<work-id>/round-<n>/<prefix>-launch-evidence.json
  report: tmp/dispatch-work/<work-id>/round-<n>/<role-report>
```

Do not hand-derive alternate child names. Prompt and launch evidence use
prefix-hyphen names. Log and status use prefix-dot names.

Required status fields for `spawn_agent` children:

```text
launcher=spawn_agent
attempt=<n>
liveness_handle=spawn_agent:<agent-id>
parent_launch_id=<parent-created-launch-id>
launch_evidence_path=tmp/dispatch-work/<work-id>/round-<n>/<prefix>-launch-evidence.json
```

Required status fields for `claude_agent` children (Claude Code environments):

```text
launcher=claude_agent
attempt=<n>
liveness_handle=claude_agent:<agent-id>
parent_launch_id=<parent-created-launch-id>
launch_evidence_path=tmp/dispatch-work/<work-id>/round-<n>/<prefix>-launch-evidence.json
```

`spawn_agent` children still receive prompt, status, report, and bounded log or
log-summary artifact paths, but parent/supervisor writes status and launch
evidence. If the host API does not provide a raw stdout/stderr stream, the log
artifact records launch id, prompt path, report path, terminal state, and a
concise action summary.

### Non-Codex Runner Record

When Codex `spawn_agent` is unavailable or intentionally not used, the dispatch
may use a supervised CLI runner instead of raw foreground `codex exec`. This is
a valid nested launcher when recorded in `tool-preflight.md`; report
`nested_subagents_unavailable` only when neither `spawn_agent` nor supervised
CLI launch is available. Record fallback child status with:

```text
launcher=codex_cli_supervisor|claude_cli_supervisor|supervisor
liveness_handle=pid:<n>|pgid:<n>|session:<id>|supervisor:<run-id>
parent_launch_id=<parent-created-launch-id>
launch_evidence_path=tmp/dispatch-work/<work-id>/round-<n>/<prefix>-launch-evidence.json
```

The supervisor owns PID/PGID capture, heartbeat, log redirection, timeout,
signal cleanup, launch evidence, and atomic terminal status. Parent relaunch is
forbidden while the supervisor says the run is active. If the supervisor dies
while the child may still live, attach or record `unknown_terminal_state`; do
not launch a second child for the same `role+attempt` until the old run is
resolved.

Raw unsupervised `codex exec` is not a valid launcher for Implement, Review, or
Verify. It may be used only for an explicitly manual diagnostic outside the
valid dispatch contract.

## Spawned Process IO

Spawned child stdout/stderr must not stream into parent context. For child
processes launched through Codex CLI, write the prompt to a prompt artifact and
launch with stdin from that file and stdout/stderr redirected to a log under
`tmp/dispatch-work/<work-id>/...`.

Non-Codex supervised runner shape:

```bash
# Codex supervised runner:
codex -C "$PWD" -s danger-full-access -a never exec - \
  < tmp/dispatch-work/<work-id>/round-<n>/<prefix>-prompt.md \
  > tmp/dispatch-work/<work-id>/round-<n>/<prefix>.log 2>&1

# Claude Code supervised runner:
claude --dangerously-skip-permissions -p \
  < tmp/dispatch-work/<work-id>/round-<n>/<prefix>-prompt.md \
  > tmp/dispatch-work/<work-id>/round-<n>/<prefix>.log 2>&1
```

Run that command through a launcher or supervisor, not as a foreground parent
PTY command. For simple CLI wrappers, create prompt, log, status, launch
evidence, and report paths before suppressing stdout/stderr; capture at least
one durable liveness handle; write parent-owned launch evidence and running
status before spawn; wait/trap the child; then atomically write terminal
status. Durable liveness handle means pid/process group, native child/session
id, or supervisor status sequence. If none can be captured, classify launcher
setup as a dirty terminal state and write an infra failure capsule.

Spawned round child prompts must include the full `path_manifest` from
`childRunPaths(...)` plus either the compact `child_artifact_contract` tag or
the legacy literal child artifact contract from `prompt-contracts.md`; a bare
contract id without the required critical-rule attributes is not enough.

Minimum child artifacts are exactly 5 per child run. All 5 must come from the
same `childRunPaths(...)` call, share the exact same prefix where prefix applies,
and live in the same dispatch root or same `round-<n>/` directory:

- `<same-dir>/<prefix>-prompt.md`: exact child input
- `<same-dir>/<prefix>.log`: full stdout/stderr on disk only
- `<same-dir>/<prefix>.status`: parent/supervisor-owned liveness and terminal
  state.
- `<same-dir>/<prefix>-launch-evidence.json`: parent/supervisor-owned launch
  provenance.
- `<same-dir>/<role-report>`: bounded role report written freshly for the child
  run with a summary-first block near the top containing `status`,
  `changed_files`, `tests`, `blockers`, and `next_action`

Invalid child artifact paths:

- `round-1/prompts/execute-prompt.md`
- `round-1/children/execute.status`
- `round-1/logs/execute.log`
- `round-1/launch-evidence/execute-launch-evidence.json`
- `round-1/execute.prompt.md`
- `round-1/execute.launch-evidence.json`
- `round-1/execute-prompt.md` paired with `round-2/execute.log`
- `round-1/execute-prompt.md` paired with `round-1/review-r1-a1.status`

Rich `runs/<run-id>/`, `status.json`, and `heartbeat.jsonl` are optional
supervisor features. A stale heartbeat only dirties a run that explicitly opted
into supervised heartbeat output.

Parent polling reads status/process/native child metadata only, not live logs. A
running child may be surfaced as one parent-generated `.` or one terse status
line about every 30s. Child stdout progress is never used for parent liveness.
The 10m silent probe checks pid/child state, status mtime, report existence, and
log byte count only.

On completion, parent validates exit status, report freshness, status contract,
and required report summary keys before reading the bounded report summary.
Parent may read log content
only after nonzero exit, signal, timeout, missing/stale/malformed report, or
explicit user request. Failure excerpts are bounded to the generated
`failure-capsule.md` or at most the first error block plus final 40-80 log
lines within the configured cap.

## Final Result Write

When Dispatch Work runs under Seedstack supervision, the Seedstack child result
must be written only after all required dispatch artifacts, child statuses,
launch evidence, `gate.md`, and `dispatcher-report.md` are present. Write the
result with a temp file in the same directory followed by an atomic rename.

If finalization fails after substantive artifacts were produced, do not rely on
chat transcript text as completion evidence. Record a bounded failure capsule
and write a Seedstack child result with `decision: "crashed"` or
`decision: "escalated"` when possible. Seedstack may synthesize a recovered
closed result only when strict dispatch artifacts validate and dirty evidence is
clean; missing result plus dirty or incomplete artifacts blocks recovery.

## Retry And Timeout

| item | default |
| --- | --- |
| Execute rounds | 3 |
| Implement attempts per round | 3 |
| infrastructure respawn per failed agent | 1 |
| poll spawned work | about 30s, status-only |
| user-visible status | about 60s or state change |
| silent probe | 10m |
| timeout | 20m silent or 60m total |

If timeout hits, mark the child status as `failed_timeout`, record status when
possible, collect partial artifacts without reading the full transcript, and
generate or read a bounded `failure-capsule.md`. Spend one
infrastructure retry if available, else escalate. On retry budget
exhaustion, write `gate.md`, escalate, do not close. When a process group is
available, timeout should send TERM, wait a short grace period, then KILL if
needed, recording signal/timeout status. If no process group is available,
attempt the native/session cancel or kill path, record cleanup uncertainty, and
keep the run dirty until terminal state is known or escalation is recorded.

An infrastructure respawn is only for tooling/environment failure before
substantive seed work. It must keep the same task and scope, consume the single
infra retry, and record failure mode, respawn count, command/mode, and any
sandbox or capability delta. If capability changes materially, Verify must
inspect that evidence.

## Execute Requirements

- First verify nested launcher access: Codex `spawn_agent` or supervised CLI
  fallback. If neither is available, report `nested_subagents_unavailable` and
  stop.
- Read `tmp/dispatch-work/<work-id>/tool-preflight.md` before spawning nested agents.
  If absent or stale, stop and ask Dispatcher to write it.
- Read `tmp/dispatch-work/<work-id>/source-hints.json` if valid, ignore it if
  missing or malformed, and pass the path to Implement and Review prompts.
  Verify source-hint claims against current files before relying on them.
- Record the launch descriptor used to spawn Implement and Review agents.
  In Codex environments this is `launcher=spawn_agent` and native child ids.
  In non-Codex environments, this is the supervised CLI command. For Codex CLI
  fallback: `codex -C "$PWD" -s danger-full-access -a never exec -` from repo
  root. For Claude Code CLI fallback: `claude --dangerously-skip-permissions -p`
  from repo root, reading the prompt from stdin.
- Spawn one Implement subagent.
- Spawn independent Review subagents using Agent Counts.
- For normal or higher-risk rounds, split Review lenses explicitly, such as
  behavior/spec and tests/storage/invariants.
- Do not give reviewers each other's findings.
- Ensure round artifacts exist and are nonempty:
  - `round-<n>/implement-a<m>-report.md`
  - `round-<n>/review-r<i>-a<m>.md`
  - `round-<n>/executor-report.md`
- Keep process edits separate from seed implementation.
- Implement must not edit after Review starts. If fixes are needed, dispatch a
  follow-up Implement with exact findings.
- After each Implement retry, spawn fresh Review agents on current diff.
- Execute must merge Review findings into two queues: correctness blockers and
  scoped cleanup/hardening opportunities. Fix blockers first, then dispatch
  in-scope cleanup and hardening improvements while retry budget remains. Do not
  treat "nonblocking" as "ignore"; defer only with a recorded reason such as
  out-of-scope, disproportionate blast radius, conflict with a higher source,
  or need for user/product direction.
- Cleanup/hardening opportunities include stronger edge coverage, sharper
  oracles, representative-to-exhaustive matrix expansion for protocol-visible
  behavior, deterministic ordering checks, negative cases, drift guards, simpler
  or less brittle code paths, and removal of redundant code/tests touched by the
  current slice.
- Cleanup is not permission for opportunistic refactors, style churn, module
  reshaping, broad rewrites, or new abstractions. Add an abstraction only when
  required by the current slice or when it removes concrete duplication in
  touched code.
- Pass/risk Reviews must list the acceptance criteria or invariants checked;
  a bare "reviewed diff" note is not enough for audit.
- Execute reports must include scope evidence and explain meaningful gate-output
  drift between baseline and final runs. Drift means changed totals, target
  lists, tool versions, runner identity, or any inventory that affects what a
  gate checked.
- Execute reports must attest that spawned prompts carried required scope,
  dirty-path, `.seeds/**`, command-wrapper, review-lens, and peer-isolation
  rules.
- Execute reports must include tool-preflight path and child launch descriptors
  used.
- Do not recommend `pass` unless work context is valid, Implement report exists,
  latest Reviews have no blocking findings or documented waivers, in-scope
  cleanup/hardening opportunities have been fixed or explicitly deferred with
  rationale, gates passed or have user waivers, and Execute `next_action`
  exists.
- When `review_lenses` includes `deslop`, assign the deslop checklist as
  required focus for one Review agent. That agent checks the branch diff for:
  unnecessary comments, defensive checks abnormal for trusted paths, `any`
  casts, deeply nested code, and patterns inconsistent with surrounding
  codebase. Behavior must stay unchanged; prefer minimal edits.

## Verify Requirements

- Dispatcher spawns Verify after every Execute report.
- Verify checks false pass, missed criteria, incomplete gates, ignored Review
  findings, and out-of-scope changes.
- Verify may inspect seed record, packet, Execute artifacts, gate outputs,
  source hints, `git diff --stat`, and `git diff --name-only`.
- Verify reads `tmp/dispatch-work/<work-id>/source-hints.json` if valid, ignores it
  if missing or malformed, and verifies any hint claim against current files.
- Verify may read full changed files only to substantiate a named finding.
- Verify reports under `round-<n>/verify-<i>.md`.
- Dispatcher must not report local done unless latest round has passing Verify
  reports or explicit user waivers. Dispatch-work never closes queue records.
- Before stage transitions, Dispatcher or Execute verifies required artifacts
  for current stage exist and are nonempty.
- When `verify_lenses` includes `thermo-nuclear`, assign the thermo-nuclear
  checklist as the focus for one Verify agent. That agent applies the
  Non-Negotiable Standards and Approval Bar: flag file-size explosions past
  1k lines, spaghetti-growth conditionals, missed code-judo simplifications,
  unnecessary abstractions, wrapper/cast/optionality churn, and wrong-layer
  logic as blocking or risk.
- When packet `testable_claims` is non-empty, at least one Verify prompt must
  carry each claim verbatim and one Verify report must record a per-claim
  `VERIFIED|NOT VERIFIED|INCONCLUSIVE` verdict with `Claim:`, `Evidence:`,
  and `Reasoning:` fields. Inconclusive results require explanation but do not
  force block.
