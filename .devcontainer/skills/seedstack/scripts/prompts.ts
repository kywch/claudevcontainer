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

export function buildDispatchPrompt(repo: string, seed: string, resultFile: string): string {
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
- For dispatch-work child agents, use the native agent-spawn tool (spawn_agent for Codex, Agent tool for Claude Code) only if it returns a real child id.
- If spawn_agent is unavailable or returns no real id, use supervised CLI launch with real PID, PGID, or session id captured before waiting.
- Never fabricate liveness handles. Do not use placeholders like spawn_agent:fake, spawn_agent:fixture, pid:1, or guessed ids.
- The JSON result file below is seedstack supervisor output only; it is not child_run_status evidence for dispatch children.

Artifact paths (use exactly, do not invent names):
- Packet: ${packetPath(seed)}
- Source hints: ${sourceHintsPath(seed)}
- Tool preflight: ${toolPreflightPath(seed)}
- Gate: ${gatePath(seed)}
- Dispatcher report: ${dispatcherReportPath(seed)}
- Terminal done artifact: ${terminalEventPath(seed, 1, "close")}
- Terminal escalate: ${terminalEventPath(seed, 1, "escalate")}
- Research 1: ${researchPaths(seed, 1).report}
- Research 2: ${researchPaths(seed, 2).report}
- Knowledge scout: ${knowledgeScoutPaths(seed).report}
- Events dir: ${eventsDir(seed)}
- For research 3+, continue the numeric pattern.
- Done and escalate are mutually exclusive — use seq 001 for whichever applies. The path may contain "close" for legacy validator compatibility; it does not mean queue close.
- Write any unlisted dispatch-work artifacts under ${dispatchRoot(seed)}/.
- Set decision to exactly one of: closed, blocked, escalated, crashed.
- Do not write literal enum text such as "decision": "closed|blocked|escalated|crashed"; choose one value.
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

Each .status file must be a KEY=VALUE text file with these required fields:
  contract=child_run_status.v2
  role=<execute|implement|review|verify>
  state=completed
  cwd=<repo root path>
  started_at=<ISO8601>
  updated_at=<ISO8601>
  ended_at=<ISO8601>
  exit_code=0
  launcher=<e.g. claude_agent or claude_cli_supervisor>
  attempt=1
  liveness_handle=<e.g. claude_agent:id or supervisor:id>
  launch_evidence_path=<path to launch-evidence.json for this role>
  prompt_path=<path to prompt file — this file must exist on disk>
  log_path=<path to log file — this file must exist on disk>
  report_path=<path to report file>
  signal=none
  timeout=false

The prompt and log files referenced in each status MUST physically exist (even if empty).
Create them as empty files if needed: touch <path>.

gate.md must include a markdown table with a "path" column listing accepted artifact paths:
  ## Evidence Paths
  | path | outcome |
  |------|---------|
  | tmp/dispatch-work/${seed}/round-1/executor-report.md | pass |
  | tmp/dispatch-work/${seed}/round-1/implement-a1-report.md | done |
  | tmp/dispatch-work/${seed}/round-1/review-r1-a1.md | pass |
  | tmp/dispatch-work/${seed}/round-1/verify-1.md | pass |

verify report (verify-1.md) must include a summary section with next_action field:
  ## Summary
  next_action: close
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
  return `Use the seedstack skill in manage mode.

Repo: ${args.repo}
Work order: ${args.seed}
Dispatch reconcile result: ${args.reconcileFile}
Seedstack dir: ${args.seedstackDir}

Task:
- Manage only latest dispatch result for seed ${args.seed}.
- Do not dispatch another seed.
- Close exactly this seed only if dispatch-work reported local done and fresh queue state still matches your decision snapshot.
- Do not close any other seed.
- You may create at most ${args.followupsPerManage} follow-up seeds in this manage step.
- Total remaining follow-up budget is ${args.remainingFollowups}.
- If more follow-ups are needed than budget permits, do not create them; report blocked.
- Set decision to exactly one of: retry_same_seed, continue_other_seeds, blocked, done.
- Use retry_same_seed only when the same seed should be dispatched again.
- Use continue_other_seeds only after the current dispatch result is fully handled and the loop may select another seed.
- For a non-closed dispatch result, choose retry_same_seed or blocked; do not use continue_other_seeds.
- Do not write literal enum text such as "decision": "retry_same_seed|continue_other_seeds|blocked|done"; choose one value.
- Write this JSON shape to ${args.resultFile}:

{
  "contract": "seedstack_child_result.v1",
  "ok": true,
  "role": "manage",
  "seed": "${args.seed}",
  "decision": "continue_other_seeds",
  "followups_requested": 0,
  "followups_created": [],
  "blocked_reason": null
}
`;
}
