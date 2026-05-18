import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { roundDir, gatePath } from "../../../dispatch-work/scripts/dispatch-work-paths.ts";

type ReportRole = "execute" | "implement" | "review" | "verify";

export type DispatchRoundOptions = {
  repo: string;
  seed: string;
  round?: number;
  executeVerdict?: "pass" | "block" | "risk";
  executeRecommendation?: "close" | "retry" | "escalate";
  gateDecision?: "close" | "retry" | "escalate";
  dirtyPaths?: string[];
};

export function writeDispatchRound(options: DispatchRoundOptions): string {
  const round = options.round ?? 1;
  const executeVerdict = options.executeVerdict ?? "pass";
  const executeRecommendation = options.executeRecommendation ?? "close";
  const gateDecision = options.gateDecision ?? "close";
  const dirtyPaths = options.dirtyPaths ?? [];
  const repoEditRoots = dirtyPaths.length > 0 ? dirtyPaths.join(",") : "src/fixture.ts";
  const changedFiles = dirtyPaths.length > 0 ? dirtyPaths.join(",") : "src/fixture.ts";
  const seed = options.seed;
  assertSafeId(seed, "seed");
  const roundRoot = roundDir(seed, round);

  write(options.repo, `${roundRoot}/execute-prompt.md`, prompt(seed, "execute", "execute-prompt.md", "execute.log", "execute.status", "executor-report.md", round, repoEditRoots));
  write(options.repo, `${roundRoot}/execute.log`, "fixture execute log\n");
  write(options.repo, `${roundRoot}/executor-report.md`, report("Execute", executeVerdict, "none", "not run", "none", executeRecommendation, `Verdict: ${executeVerdict}\n\nRecommendation: ${executeRecommendation}\n`));

  write(options.repo, `${roundRoot}/implement-prompt.md`, prompt(seed, "implement", "implement-prompt.md", "implement.log", "implement.status", "implement-report.md", round, repoEditRoots));
  write(options.repo, `${roundRoot}/implement.log`, "fixture implement log\n");
  write(options.repo, `${roundRoot}/implement-report.md`, report("Implement", "done", changedFiles, "not run", "none", "close", "Outcome: done\n\nRecommendation: close\n"));

  write(options.repo, `${roundRoot}/review-prompt.md`, prompt(seed, "review", "review-prompt.md", "review.log", "review.status", "review-report.md", round, repoEditRoots));
  write(options.repo, `${roundRoot}/review.log`, "fixture review log\n");
  write(options.repo, `${roundRoot}/review-report.md`, report("Review", "pass", changedFiles, "not run", "none", "close", "Verdict: pass\n\nRecommendation: close\n"));

  write(options.repo, `${roundRoot}/verify-1-prompt.md`, prompt(seed, "verify", "verify-1-prompt.md", "verify-1.log", "verify-1.status", "verify-1.md", round, repoEditRoots));
  write(options.repo, `${roundRoot}/verify-1.log`, "fixture verify log\n");
  write(options.repo, `${roundRoot}/verify-1.md`, report("Verify", "pass", changedFiles, "not run", "none", "close", "Verdict: pass\n"));

  writeStatus(options.repo, seed, round, "execute", "execute-prompt.md", "execute.log", "executor-report.md");
  writeStatus(options.repo, seed, round, "implement", "implement-prompt.md", "implement.log", "implement-report.md");
  writeStatus(options.repo, seed, round, "review", "review-prompt.md", "review.log", "review-report.md");
  writeStatus(options.repo, seed, round, "verify", "verify-1-prompt.md", "verify-1.log", "verify-1.md");

  write(options.repo, gatePath(seed), [
    `# Gate: ${seed}`,
    "",
    `decision: ${gateDecision}`,
    "",
    "## Evidence",
    "",
    "| path | outcome |",
    "| --- | --- |",
    `| ${roundRoot}/executor-report.md | ${executeVerdict} |`,
    `| ${roundRoot}/implement-report.md | done |`,
    `| ${roundRoot}/review-report.md | pass |`,
    `| ${roundRoot}/verify-1.md | pass |`,
    "",
    "## Dirty Guard",
    "",
    ...(dirtyPaths.length > 0
      ? dirtyPaths.map((path) => `- known dirty path: \`${path}\``)
      : ["Known dirty paths: none."]),
  ].join("\n"));
  write(options.repo, `tmp/dispatch-work/${seed}/knowledge-capture.md`, richNoneQualifiedKnowledgeCapture());

  return `${roundRoot}`;
}

function assertSafeId(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) {
    throw new Error(`${label} must be a path-safe id`);
  }
}

function write(repo: string, repoRel: string, content: string): void {
  const file = join(repo, repoRel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function richNoneQualifiedKnowledgeCapture(): string {
  return [
    "capture_state=none_qualified",
    "store_count: 0",
    "merge_union: true",
    "marker_count: 0",
    "artifacts_reviewed: 4",
    "candidate_count: 0",
    "rejected_count: 0",
    "none_rationale: No durable cross-session knowledge candidates in fixture artifacts.",
    "",
  ].join("\n");
}

function report(
  title: string,
  status: string,
  changedFiles: string,
  tests: string,
  blockers: string,
  nextAction: string,
  body: string,
): string {
  return [
    `# ${title} Report`,
    "",
    "## Summary",
    `status: ${status}`,
    `changed_files: ${changedFiles}`,
    `tests: ${tests}`,
    `blockers: ${blockers}`,
    `next_action: ${nextAction}`,
    "",
    body.trimEnd(),
    "",
  ].join("\n");
}

function writeStatus(
  repo: string,
  seed: string,
  round: number,
  role: ReportRole,
  promptName: string,
  logName: string,
  reportName: string,
): void {
  const roundRoot = roundDir(seed, round);
  const base = role === "verify" ? "verify-1" : role;
  const statusRel = `${roundRoot}/${base}.status`;
  const evidenceRel = `${roundRoot}/${base}-launch-evidence.json`;
  const parentLaunchId = `${base}-fixture-launch`;
  const livenessHandle = `supervisor:fixture-${base}-launch`;
  const status = [
    "contract=child_run_status.v2",
    `role=${role}`,
    "state=completed",
    `cwd=${repo}`,
    "launcher=supervisor",
    "attempt=1",
    "started_at=2026-01-01T00:00:00Z",
    "updated_at=2026-01-01T00:00:01Z",
    `liveness_handle=${livenessHandle}`,
    `parent_launch_id=${parentLaunchId}`,
    `launch_evidence_path=${evidenceRel}`,
    `prompt_path=${roundRoot}/${promptName}`,
    `log_path=${roundRoot}/${logName}`,
    `report_path=${roundRoot}/${reportName}`,
    "ended_at=2026-01-01T00:00:01Z",
    "exit_code=0",
    "signal=none",
    "timeout=false",
    "",
  ].join("\n");
  write(repo, statusRel, status);
  write(repo, evidenceRel, `${JSON.stringify({
    contract: "child_launch_evidence.v1",
    parent_launch_id: parentLaunchId,
    role,
    attempt: "1",
    launcher: "supervisor",
    liveness_handle: livenessHandle,
    prompt_path: `${roundRoot}/${promptName}`,
    log_path: `${roundRoot}/${logName}`,
    status_path: statusRel,
    report_path: `${roundRoot}/${reportName}`,
    status_writer: "supervisor",
  }, null, 2)}\n`);
}

function prompt(seed: string, role: string, promptName: string, logName: string, statusName: string, reportName: string, round: number, repoEditRoots = "src/fixture.ts"): string {
  const root = roundDir(seed, round);
  const base = role === "verify" ? "verify-1" : role;
  const launchEvidencePath = `${root}/${base}-launch-evidence.json`;
  const parentLaunchId = `${base}-fixture-launch`;
  return [
    `# ${role} prompt`,
    "",
    `<io_policy prompt_path="${root}/${promptName}" log_path="${root}/${logName}" status_path="${root}/${statusName}" launch_evidence_path="${launchEvidencePath}" report_path="${root}/${reportName}" no_parent_transcript_polling="true" />`,
    `<launch_provenance parent_launch_id="${parentLaunchId}" launch_evidence_path="${launchEvidencePath}" status_owner="parent_or_supervisor" />`,
    "<rules>",
    '  <no_seed_mutation path=".seeds/**" />',
    `  <preserve_dirty_paths dirty_baseline="none" artifact_write_roots="${root}/" dispatch_artifact_roots="tmp/dispatch-work/${seed}/" repo_edit_roots="${repoEditRoots}" seedstack_artifact_roots="" gate_artifacts="tmp/dispatch-work/${seed}/gate.md,tmp/dispatch-work/${seed}/dispatcher-report.md" dispatcher_owned_seed_state="cli_only" />`,
    '  <commands obey_repo_wrappers="true" />',
    "</rules>",
    "",
    "Use repo-native commands with rtk.",
    "Write report summary first with status, changed_files, tests, blockers, next_action.",
    `Report path: ${root}/${reportName}`,
    "",
    `<child_artifact_contract ref="dispatch-child-artifact.v2" report_path="${root}/${reportName}" status_owner="parent_or_supervisor" child_writes="report_only" no_seed_mutation=".seeds/**" command_wrapper="repo-native" no_parent_transcript_polling="true" preserve_dirty_paths="required" dirty_baseline="fixture-clean" artifact_write_roots="${root}/" dispatch_artifact_roots="tmp/dispatch-work/${seed}/" repo_edit_roots="${repoEditRoots}" seedstack_artifact_roots="" gate_artifacts="tmp/dispatch-work/${seed}/gate.md,tmp/dispatch-work/${seed}/dispatcher-report.md" dispatcher_owned_seed_state="cli_only" />`,
    "",
  ].join("\n");
}
