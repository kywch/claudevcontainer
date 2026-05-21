import {
  dispatchRoot,
  packetPath,
  gatePath,
  sourceHintsPath,
  toolPreflightPath,
  dispatcherReportPath,
  researchPaths,
  knowledgeScoutPaths,
  terminalEventPath,
  eventsDir,
} from "../../dispatch-work/scripts/dispatch-work-paths.ts";
import {
  VALID_NONE_QUALIFIED_KNOWLEDGE_CAPTURE,
  validateKnowledgeCaptureText,
} from "../../dispatch-work/scripts/knowledge-capture-validation.ts";

export function buildDispatchPrompt(repo: string, seed: string, resultFile: string): string {
  const validNoneQualified = validateKnowledgeCaptureText(VALID_NONE_QUALIFIED_KNOWLEDGE_CAPTURE);
  if (!validNoneQualified.ok) {
    throw new Error(`invalid built-in knowledge capture template: ${validNoneQualified.errors.join("; ")}`);
  }
  return `Use the dispatch-work skill.

Repo: ${repo}
Work order: ${seed}

Task:
- Execute exactly work order ${seed}.
- Do not select another work order.
- Do not run seedstack run/manage loop.
- Do not call queue mutation commands (sd close, dependency edits, label edits, or follow-up creation). Seedstack owns seed/queue state.
- Use repo-native command requirements from AGENTS.md.
- You are running inside an outer supervised exec (Codex or Claude Code CLI) managed by seedstack.
- For dispatch-work child agents, use the native agent-spawn tool (spawn_agent for Codex, Agent tool for Claude Code) only if it returns a real child id; record launcher=spawn_agent for Codex and launcher=claude_agent for Claude Code Agent tool.
- If spawn_agent is unavailable or returns no real id, use supervised CLI launch with real PID, PGID, or session id captured before waiting.
- Never fabricate liveness handles. Do not use placeholders like spawn_agent:fake, spawn_agent:fixture, pid:1, or guessed ids.
- Valid launcher values are exactly: spawn_agent, claude_agent, supervisor, codex_cli_supervisor, claude_cli_supervisor.
- Match launcher to liveness_handle: spawn_agent -> spawn_agent:<id>; claude_agent -> claude_agent:<id>; supervisor/codex_cli_supervisor/claude_cli_supervisor -> supervisor:<run-id>, session:<id>, pid:<n>, or pgid:<n>.
- The JSON result file below is seedstack supervisor output only; it is not child_run_status evidence for dispatch children.

Artifact paths (use exactly, do not invent names):
- Packet: ${packetPath(seed)}
- Source hints: ${sourceHintsPath(seed)}
- Tool preflight: ${toolPreflightPath(seed)}
- Gate: ${gatePath(seed)}
- Dispatcher report: ${dispatcherReportPath(seed)}
- Terminal done artifact: ${terminalEventPath(seed, 1, "done")}
- Terminal escalate: ${terminalEventPath(seed, 1, "escalate")}
- Research 1: ${researchPaths(seed, 1).report}
- Research 2: ${researchPaths(seed, 2).report}
- Knowledge scout: ${knowledgeScoutPaths(seed).report}
- Knowledge capture: ${dispatchRoot(seed)}/knowledge-capture.md
- Events dir: ${eventsDir(seed)}
- For research 3+, continue the numeric pattern.
- Knowledge scout is pre-work context from existing .seeds/knowledge.jsonl; knowledge capture is post-work audit/recording output at ${dispatchRoot(seed)}/knowledge-capture.md.
- knowledge-capture.md is required for close/done and must validate with validateKnowledgeCaptureText.
- Required knowledge-capture.md schema fields for none_qualified: capture_state, store_count, merge_union, marker_count, artifacts_reviewed, candidate_count, rejected_count, and none_rationale or rationale.
- Old prose/status-only none_qualified is invalid for close/done. Example invalid text: capture_state=none_qualified plus accepted IDs: [] only.
- Minimal valid none_qualified example:

\`\`\`text
${VALID_NONE_QUALIFIED_KNOWLEDGE_CAPTURE.trimEnd()}
\`\`\`

- For capture_state=recorded, use accepted IDs such as \`accepted IDs: [ex-1a2b3c]\` or structured accepted_records JSON accepted by validator:

\`\`\`json
{"accepted_records":[{"type":"failure","content":"When condition occurs, action fails. Cause: root cause. Do: corrective action. Verify: focused gate. Limit: bounded scope."}]}
\`\`\`

- Prose-only "accepted records" is invalid; accepted records must be explicit JSON with valid type/content and no evidence field.
- Done and escalate are mutually exclusive — use seq 001 for whichever applies. The gate decision may contain "close" for legacy validator compatibility; it does not mean queue close.
- Write any unlisted dispatch-work artifacts under ${dispatchRoot(seed)}/.
- Set decision to exactly one of: closed, blocked, escalated, crashed.
- Prefer bounded self-heal before any non-closed decision: repair real missing/invalid artifacts, rerun or fix safe gate checks, and revalidate from disk when the failure is within this work order and can be corrected without destructive action or user input.
- Choose closed only when the work order is complete, required gates actually ran, required artifacts validate, and evidence is real.
- Choose blocked/escalated/crashed only for artifact/gate failures that cannot be repaired safely in bounded scope, or for unsafe/destructive/user/scope/queue needs.
- Write ${resultFile} last after all artifacts and validation checks; treat that result file as the terminal fence for dispatch output.
- Do not write literal combined enum text for decision; choose one value.
- For non-closed decisions, omit round_path and set blocked_reason when useful.

Required round-1 artifacts (the dispatch-work validator checks for all of these):
- Round dir: ${dispatchRoot(seed)}/round-1/
- Executor report: ${dispatchRoot(seed)}/round-1/executor-report.md (must contain Verdict: and Recommendation:)
- Execute status: ${dispatchRoot(seed)}/round-1/execute.status
- Implement report: ${dispatchRoot(seed)}/round-1/implement-a1-report.md (must contain Outcome:)
- Implement status: ${dispatchRoot(seed)}/round-1/implement-a1.status
- Review report: ${dispatchRoot(seed)}/round-1/review-r1-a1.md (must contain Verdict:)
- Review status: ${dispatchRoot(seed)}/round-1/review-r1-a1.status
- Verify report: ${dispatchRoot(seed)}/round-1/verify-1.md
- Verify status: ${dispatchRoot(seed)}/round-1/verify-1.status
- gate.md must contain the line: \`decision: close\` (or \`decision: escalate\`) for validator compatibility. Treat \`close\` as local work done; do not mutate queue state.

Required report marker lines for a clean close:
- Execute Verdict/Recommendation: executor-report.md must contain exact parseable lines \`Verdict: pass\` and \`Recommendation: close\` (or \`Recommendation: done\`).
- Implement Outcome: done: implement-a1-report.md must contain exact parseable line \`Outcome: done\`.
- Review Verdict: pass: review-r1-a1.md must contain exact parseable line \`Verdict: pass\`.
- Verify Verdict: pass: verify-1.md must contain exact parseable line \`Verdict: pass\`.
- Every role report must start with a Summary block containing these keys in this order: status, changed_files, tests, blockers, next_action.
- For close/done, report Summary next_action must be close or done.

Each .status file must be a KEY=VALUE text file with these required fields:
  contract=child_run_status.v2
  role=<execute|implement|review|verify>
  state=completed
  cwd=<repo root path>
  started_at=<ISO8601>
  updated_at=<ISO8601>
  ended_at=<ISO8601>
  exit_code=0
  launcher=<spawn_agent|claude_agent|supervisor|codex_cli_supervisor|claude_cli_supervisor>
  attempt=1
  liveness_handle=<spawn_agent:id|claude_agent:id|supervisor:id|session:id|pid:n|pgid:n>
  parent_launch_id=<parent-created launch id matching launch evidence>
  launch_evidence_path=<path to launch-evidence.json for this role>
  prompt_path=<path to prompt file — this file must exist on disk and be non-empty>
  log_path=<path to log file — this file must exist on disk and be non-empty>
  report_path=<path to report file — this file must exist on disk and be non-empty>
  signal=none
  timeout=false

The prompt, log, and report files referenced in each status MUST physically exist and MUST be non-empty.
Do not satisfy this with touch-only empty files. Write the exact child prompt to prompt_path, bounded child stdout/stderr or launch summary to log_path, and the role report to report_path.

Each launch_evidence_path must physically exist, be non-empty JSON, and match its status exactly:
{
  "contract": "child_launch_evidence.v1",
  "parent_launch_id": "<same as status parent_launch_id>",
  "role": "<same as status role>",
  "attempt": "1",
  "launcher": "<same as status launcher>",
  "liveness_handle": "<same as status liveness_handle>",
  "prompt_path": "<same as status prompt_path>",
  "log_path": "<same as status log_path>",
  "status_path": "<path to this .status file>",
  "report_path": "<same as status report_path>",
  "status_writer": "parent"
}

Each prompt_path file must include child artifact contract tags that match status paths:
- \`<io_policy prompt_path="..." log_path="..." status_path="..." launch_evidence_path="..." report_path="..." no_parent_transcript_polling="true" />\`
- \`<launch_provenance parent_launch_id="..." launch_evidence_path="..." status_owner="parent_or_supervisor" />\`
- \`<child_artifact_contract ref="dispatch-child-artifact.v2" report_path="..." status_owner="parent_or_supervisor" child_writes="report_only" no_seed_mutation=".seeds/**" command_wrapper="repo-native" no_parent_transcript_polling="true" preserve_dirty_paths="required" dirty_baseline="..." artifact_write_roots="${dispatchRoot(seed)}/round-1/" dispatch_artifact_roots="${dispatchRoot(seed)}/" repo_edit_roots="<repo paths this seed may edit>" seedstack_artifact_roots="<seedstack supervision artifact roots, if any>" gate_artifacts="${gatePath(seed)},${dispatcherReportPath(seed)}" dispatcher_owned_seed_state="cli_only" />\`

Do not use a single mixed write-root catch-all. Keep roots typed:
- artifact_write_roots / dispatch_artifact_roots: dispatch-work artifacts under tmp/dispatch-work.
- repo_edit_roots: area plus support_area from the work order description. area is behavior ownership; support_area is only gate/harness/wrapper/report wiring needed to prove this seed.
- seedstack_artifact_roots: seedstack supervision artifacts, not implementation edits.
- gate_artifacts: gate and dispatcher report files, not child_run_status evidence.
- dirty_baseline: preexisting dirty paths the child must preserve.
- Do not use support_area to widen behavior ownership or add product scope. If support_area is absent, repo_edit_roots comes from area only.

Seedstack result files and gate files are supervision/gate artifacts. They are not repo edits, and they are not dispatch child status evidence.

gate.md must include an Evidence Paths markdown table listing accepted dispatch artifact paths only. Do not put command results, cwd paths, source paths, implementation paths, or seedstack paths in this table:
  ## Evidence Paths
  | path | outcome |
  |------|---------|
  | tmp/dispatch-work/${seed}/round-1/executor-report.md | pass |
  | tmp/dispatch-work/${seed}/round-1/implement-a1-report.md | done |
  | tmp/dispatch-work/${seed}/round-1/review-r1-a1.md | pass |
  | tmp/dispatch-work/${seed}/round-1/verify-1.md | pass |
Put command checks in a separate Gate Results or Gate Checks section. Those command tables are not accepted artifact evidence unless they include an explicit log_artifact_path under tmp/dispatch-work/${seed}/.

gate.md must include a Dirty Guard section with actual implementation paths from \`git status --porcelain=v1 --untracked-files=all\`:
  ## Dirty Guard
  - command: \`git status --porcelain=v1 --untracked-files=all\`
  - snapshot: \`<dirty_state_snapshot.v1 path or raw status capture path>\`
  - implementation paths: human-readable summary of actual implementation paths
  - queue paths: human-readable summary, normally none
  - unexpected paths: human-readable summary, normally none

  \`\`\`json
  {
    "contract": "dirty_guard.v1",
    "baseline_paths": [],
    "actual_impl_paths": ["<each dirty path not under .seeds/ and not under tmp/>"],
    "queue_paths": [],
    "unexpected_paths": [],
    "snapshot_path": "<dirty_state_snapshot.v1 path or raw status capture path>"
  }
  \`\`\`
If there are no dirty implementation paths, write \`Known dirty paths: none.\`.
Do not list placeholder or blank paths. Do not list tmp/dispatch-work paths as implementation paths. Do not mutate .seeds queue paths. The structured \`dirty_guard.v1\` block is authoritative; the markdown text is compatibility only.

verify report (verify-1.md) must include a summary section with next_action field:
  ## Summary
  next_action: close
- Before writing the final JSON result, do a success-only validation/repair pass:
  - Re-read required artifact/status/launch-evidence/gate/knowledge-capture files from disk.
  - Confirm every close/pass/done marker is backed by real report content and actual gate command evidence.
  - Repair missing or malformed artifacts and rerun safe bounded checks when possible.
  - If evidence is not real or repair is not safe/bounded, do not close; choose a non-closed decision with a truthful blocked_reason.
  - Do not invent pass evidence, gate output, launch handles, close markers, pass markers, or done markers.
- When finished, write this JSON shape to ${resultFile}:

{
  "contract": "seedstack_child_result.v1",
  "ok": true,
  "role": "dispatch",
  "seed": "${seed}",
  "decision": "closed",
  "round_path": "${dispatchRoot(seed)}/round-N",
  "followups_requested": 0,
  "followups_created": []
}

Here "decision": "closed" means dispatch-work completed the bounded work item
and produced passing artifacts. It does not mean the queue record was closed;
seedstack performs any queue close/retry/follow-up decision after reconciliation.
`;
}

export function buildManagePrompt(args: {
  repo: string;
  seedstackDir: string;
  followupsPerManage: number;
  seed: string;
  reconcileFile: string;
  resultFile: string;
  remainingFollowups: number;
}): string {
  // Alignment sentinel for check-run-loop-model-alignment.ts: retry_same_seed|continue_other_seeds|blocked|done
  return `Use the seedstack skill in manage mode.

Repo: ${args.repo}
Work order: ${args.seed}
Dispatch reconcile result: ${args.reconcileFile}
Seedstack dir: ${args.seedstackDir}

Task:
- Manage only latest dispatch result for seed ${args.seed}.
- Do not dispatch another seed.
- Do not run Seeds CLI queue mutation commands. Forbidden examples: sd close, sd create, dependency edits, label edits, or any direct write under .seeds/**.
- Propose queue operations only. Seedstack supervisor owns all queue mutations after it checks fresh queue state and preconditions.
- Propose close-current for exactly this seed only if dispatch-work reported local done and fresh queue state still matches your decision snapshot.
- Do not propose closing any other seed.
- You may propose at most ${args.followupsPerManage} follow-up seeds in this manage step.
- Total remaining follow-up budget is ${args.remainingFollowups}.
- If more follow-ups are needed than budget permits, use a safe bounded op/retry/continue when one exists; report blocked only when no safe bounded operation, retry, or continue path exists.
- proposed_queue_operations entries must be structured objects with:
  - op_type: one of close-current, create-follow-up, add-dependency, adjust-labels, no-op
  - target_seed: seed id affected by the operation
  - rationale: why the supervisor should apply it
  - source_artifact_refs: dispatch/reconcile artifact paths supporting it
  - expected_preconditions: queue facts the supervisor must verify from fresh queue state before applying it. Use only supervisor-supported facts such as "seed ${args.seed} is still open" and "latest dispatch reconcile result still matches ${args.reconcileFile}". Put extra freshness concerns or reasoning in rationale/details, not expected_preconditions.
  - details: optional operation-specific object, such as follow-up title/body, dependency ids, or labels to add/remove
- Set decision to exactly one of: retry_same_seed, continue_other_seeds, blocked, done.
- Prefer retry_same_seed for retryable non-closed dispatch results, including repairable artifact/gate failures and bounded same-seed self-heal opportunities. Same-seed retry is normal control flow, not failure.
- Use continue_other_seeds only after the current dispatch result is fully handled and any required close/no-op/follow-up proposal is present.
- You may allow mechanical area/support_area repair when dispatch is directionally correct: update prompt/root wiring, gate wrapper/report paths, or same-seed validation artifacts, then choose retry_same_seed when another bounded dispatch can prove it.
- Treat true scope creep as blocked: behavior outside area, support_area used for product changes, unrelated dirty paths, new subsystem ownership, or follow-up work hidden inside gate wiring.
- Use blocked only for destructive or unsafe operations, missing user decision, true scope conflict, queue-state need, capability limit, unowned dirty worktree, exhausted follow-up budget with no safe retry/continue/no-op path, or proven unfixable artifact/gate failure.
- For a non-closed dispatch result, choose retry_same_seed unless a blocked condition above applies; do not use continue_other_seeds.
- If no queue mutation is needed, propose a no-op with rationale and supervisor-verified expected_preconditions instead of omitting proposed_queue_operations.
- proposed_queue_operations is required for blocked and retry_same_seed too. For retry_same_seed, use [] or one no-op only; do not propose close-current, create-follow-up, add-dependency, or adjust-labels.
- For blocked, include [] only when no safe no-op precondition is meaningful; otherwise include one no-op describing why supervisor should not mutate queue state.
- Do not write literal combined enum text for decision; choose one value.
- Write this JSON shape to ${args.resultFile}:

{
  "contract": "seedstack_child_result.v1",
  "ok": true,
  "role": "manage",
  "seed": "${args.seed}",
  "decision": "continue_other_seeds",
  "followups_requested": 0,
  "followups_created": [],
  "proposed_queue_operations": [
    {
      "op_type": "close-current",
      "target_seed": "${args.seed}",
      "rationale": "dispatch result is locally closed and accepted by reconcile evidence",
      "source_artifact_refs": ["${args.reconcileFile}"],
      "expected_preconditions": ["seed ${args.seed} is still open", "latest dispatch reconcile result still matches ${args.reconcileFile}"],
      "details": {}
    }
  ],
  "blocked_reason": null
}
`;
}
