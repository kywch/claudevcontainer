export const STATUS_CONTRACT = "child_run_status.v2";
export const LAUNCH_EVIDENCE_CONTRACT = "child_launch_evidence.v1";

export const STATUS_REQUIRED_FIELDS = [
  "role",
  "state",
  "cwd",
  "started_at",
  "updated_at",
  "launcher",
  "attempt",
  "liveness_handle",
  "parent_launch_id",
  "launch_evidence_path",
  "prompt_path",
  "log_path",
  "report_path",
] as const;

export const STATUS_TERMINAL_FIELDS = ["ended_at", "exit_code", "signal", "timeout"] as const;

export const LAUNCH_EVIDENCE_VALUE_FIELDS = [
  "parent_launch_id",
  "role",
  "attempt",
  "launcher",
  "liveness_handle",
] as const;

export const LAUNCH_EVIDENCE_PATH_FIELDS = ["prompt_path", "log_path", "status_path", "report_path"] as const;

export const LAUNCHERS = [
  "spawn_agent",
  "supervisor",
  "codex_cli_supervisor",
  "claude_agent",
  "claude_cli_supervisor",
] as const;

export const IO_POLICY_PATH_ATTRS = [
  "prompt_path",
  "log_path",
  "status_path",
  "report_path",
  "launch_evidence_path",
] as const;

export const GATE_DECISIONS = ["done", "retry", "escalate"] as const;
export const LEGACY_GATE_DECISIONS = ["close", "retry", "escalate"] as const;
export const ACCEPTED_GATE_DECISIONS = ["done", "close", "retry", "escalate"] as const;
export const REPORT_SUMMARY_NEXT_ACTIONS = ["done", "close", "retry", "escalate", "follow-up"] as const;

export function isLocalDoneDecision(value: string | undefined): boolean {
  return value === "done" || value === "close";
}
