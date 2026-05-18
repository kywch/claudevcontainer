import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { LAUNCH_EVIDENCE_CONTRACT, STATUS_CONTRACT } from "./dispatch-work-contracts.ts";
import { childRunPaths } from "./dispatch-work-paths.ts";
import { VALID_NONE_QUALIFIED_KNOWLEDGE_CAPTURE } from "./knowledge-capture-validation.ts";
import type { ReportRole } from "./validate-dispatch-work.ts";

export function writeSeedIssue(repo: string, seed: string, area: string) {
  const issuesPath = join(repo, ".seeds", "issues.jsonl");
  mkdirp(dirname(issuesPath));
  writeFileSync(issuesPath, `${JSON.stringify({
    id: seed,
    status: "open",
    title: "Fixture seed",
    description: `Fixture seed\n\narea: ${area}\n`,
  })}\n`);
}

export function initGitRepo(repo: string) {
  spawnSync("git", ["init", "-q"], { cwd: repo });
  spawnSync("git", ["add", "."], { cwd: repo });
  spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "fixture"], { cwd: repo });
}

export type FixtureDirtyChild = {
  role: ReportRole;
  state: string;
  exitCode: string;
  failureCapsule: boolean;
};

export function makeFixtureRound(
  repo: string,
  seed: string,
  roundPath: string,
  executeVerdict: string,
  executeRecommendation: string,
  includeLiveness: boolean,
  statusContract = STATUS_CONTRACT,
  dirtyChild?: FixtureDirtyChild,
  reviewReportName = "review-r1-a1.md",
  includeGateEvidence = true,
  livenessHandle = "spawn_agent:fixture",
  includeLaunchEvidence = true,
  launcher = "spawn_agent",
) {
  const roundRel = repoRelative(repo, roundPath);
  const dispatchRel = dirname(roundRel);
  const dispatchPath = join(repo, dispatchRel);
  mkdirp(roundPath);
  const write = (repoRel: string, content: string) => {
    const file = join(repo, repoRel);
    mkdirp(dirname(file));
    writeFileSync(file, content);
    return file;
  };

  const paths = {
    execute: childRunPaths(roundRel, "execute"),
    implement: childRunPaths(roundRel, "implement", { attempt: 1 }),
    review: { ...childRunPaths(roundRel, "review", { reviewer: 1, attempt: 1 }), report: `${roundRel}/${reviewReportName}` },
    verify: childRunPaths(roundRel, "verify", { instance: 1 }),
  };
  write(paths.execute.prompt, promptFixture(seed, "execute", basename(paths.execute.prompt), basename(paths.execute.log), basename(paths.execute.status), basename(paths.execute.report), roundRel));
  write(paths.execute.log, "launch summary\n");
  write(paths.execute.report, reportFixture("Execute", executeVerdict, "none", "not run", "none", executeRecommendation, `Verdict: ${executeVerdict}\n\nRecommendation: ${executeRecommendation}\n`));
  write(paths.implement.prompt, promptFixture(seed, "implement", basename(paths.implement.prompt), basename(paths.implement.log), basename(paths.implement.status), basename(paths.implement.report), roundRel));
  write(paths.implement.log, "launch summary\n");
  write(paths.implement.report, reportFixture("Implement", "done", "src/fixture.ts", "not run", "none", "close", "Outcome: done\n\nRecommendation: close\n"));
  write(paths.review.prompt, promptFixture(seed, "review", basename(paths.review.prompt), basename(paths.review.log), basename(paths.review.status), basename(paths.review.report), roundRel));
  write(paths.review.log, "launch summary\n");
  write(paths.review.report, reportFixture("Review", "pass", "src/fixture.ts", "not run", "none", "close", "Verdict: pass\n\nRecommendation: close\n"));
  write(paths.verify.prompt, promptFixture(seed, "verify", basename(paths.verify.prompt), basename(paths.verify.log), basename(paths.verify.status), basename(paths.verify.report), roundRel));
  write(paths.verify.log, "launch summary\n");
  write(paths.verify.report, reportFixture("Verify", "pass", "src/fixture.ts", "not run", "none", "close", "Verdict: pass\n"));
  writeStatus(write, repo, seed, roundRel, "execute", basename(paths.execute.prompt), basename(paths.execute.log), basename(paths.execute.report), includeLiveness, statusContract, dirtyChild, livenessHandle, includeLaunchEvidence, launcher);
  writeStatus(write, repo, seed, roundRel, "implement", basename(paths.implement.prompt), basename(paths.implement.log), basename(paths.implement.report), true, statusContract, dirtyChild, livenessHandle, includeLaunchEvidence, launcher);
  writeStatus(write, repo, seed, roundRel, "review", basename(paths.review.prompt), basename(paths.review.log), basename(paths.review.report), true, statusContract, dirtyChild, livenessHandle, includeLaunchEvidence, launcher);
  writeStatus(write, repo, seed, roundRel, "verify", basename(paths.verify.prompt), basename(paths.verify.log), basename(paths.verify.report), true, statusContract, dirtyChild, livenessHandle, includeLaunchEvidence, launcher);
  write(`${dispatchRel}/gate.md`, [
    `# Gate: ${seed}`,
    "",
    "decision: close",
    "",
    "## Evidence",
    "",
    ...(includeGateEvidence
      ? [
          "| path | outcome |",
          "| --- | --- |",
          `| ${paths.execute.report} | ${executeVerdict} |`,
          `| ${paths.implement.report} | done |`,
          `| ${paths.review.report} | pass |`,
          `| ${paths.verify.report} | pass |`,
        ]
      : ["No evidence paths recorded."]),
    "",
    "## Dirty Guard",
    "",
    "Known dirty paths: none.",
  ].join("\n"));
  write(`${dispatchRel}/knowledge-capture.md`, richNoneQualifiedKnowledgeCapture());
  mkdirp(dispatchPath);
}

export function richNoneQualifiedKnowledgeCapture(): string {
  return VALID_NONE_QUALIFIED_KNOWLEDGE_CAPTURE;
}

function reportFixture(
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
  write: (repoRel: string, content: string) => string,
  repo: string,
  seed: string,
  roundRel: string,
  role: ReportRole,
  promptName: string,
  logName: string,
  reportName: string,
  includeLiveness: boolean,
  statusContract: string,
  dirtyChild?: FixtureDirtyChild,
  livenessHandle = "spawn_agent:fixture",
  includeLaunchEvidence = true,
  launcher = "spawn_agent",
): string {
  const statusName = promptName.replace(/-prompt\.md$/, ".status");
  const statusRel = `${roundRel}/${statusName}`;
  const baseName = statusName.replace(/\.status$/, "");
  const parentLaunchId = `${baseName}-launch-1`;
  const evidenceRel = `${roundRel}/${baseName}-launch-evidence.json`;
  const dirty = dirtyChild?.role === role;
  const status = [
    `contract=${statusContract}`,
    `role=${role}`,
    `state=${dirty ? dirtyChild.state : "completed"}`,
    `cwd=${repo}`,
    `launcher=${launcher}`,
    "attempt=1",
    "started_at=2026-01-01T00:00:00Z",
    "updated_at=2026-01-01T00:00:01Z",
    includeLiveness ? `liveness_handle=${livenessHandle}` : "",
    includeLaunchEvidence ? `parent_launch_id=${parentLaunchId}` : "",
    includeLaunchEvidence ? `launch_evidence_path=${evidenceRel}` : "",
    `prompt_path=${roundRel}/${promptName}`,
    `log_path=${roundRel}/${logName}`,
    `report_path=${roundRel}/${reportName}`,
    "ended_at=2026-01-01T00:00:01Z",
    `exit_code=${dirty ? dirtyChild.exitCode : "0"}`,
    "signal=none",
    "timeout=false",
  ].filter(Boolean).join("\n") + "\n";
  write(statusRel, status);
  if (includeLaunchEvidence) {
    write(evidenceRel, `${JSON.stringify({
	      contract: LAUNCH_EVIDENCE_CONTRACT,
      parent_launch_id: parentLaunchId,
      role,
      attempt: "1",
      launcher,
      liveness_handle: livenessHandle,
      prompt_path: `${roundRel}/${promptName}`,
      log_path: `${roundRel}/${logName}`,
      status_path: statusRel,
      report_path: `${roundRel}/${reportName}`,
      status_writer: "parent",
    }, null, 2)}\n`);
  }
  if (dirty && dirtyChild.failureCapsule) {
    write(`${roundRel}/failure-capsule.md`, "dirty child evidence\n");
  }
  return statusRel;
}

export function promptFixture(seed: string, role: string, promptName: string, logName: string, statusName: string, reportName: string, roundRel = `tmp/dispatch-work/${seed}/round-1`): string {
  return compactPromptFixture(seed, role, promptName, logName, statusName, reportName, roundRel);
}

export function legacyPromptFixture(seed: string, role: string, promptName: string, logName: string, statusName: string, reportName: string, roundRel = `tmp/dispatch-work/${seed}/round-1`): string {
  const baseName = statusName.replace(/\.status$/, "");
  const parentLaunchId = `${baseName}-launch-1`;
  const launchEvidencePath = `${roundRel}/${baseName}-launch-evidence.json`;
  return [
    `# ${role} prompt`,
    "",
    `<io_policy prompt_path="${roundRel}/${promptName}" log_path="${roundRel}/${logName}" status_path="${roundRel}/${statusName}" launch_evidence_path="${launchEvidencePath}" report_path="${roundRel}/${reportName}" no_parent_transcript_polling="true" />`,
    `<launch_provenance parent_launch_id="${parentLaunchId}" launch_evidence_path="${launchEvidencePath}" status_owner="parent_or_supervisor" />`,
    "<rules>",
    '  <no_seed_mutation path=".seeds/**" />',
    `  <preserve_dirty_paths dirty_baseline="none" allowed_write_roots="${roundRel}/" dispatcher_owned_seed_state="cli_only" />`,
    '  <commands obey_repo_wrappers="true" />',
    "</rules>",
    "",
    "Use repo-native commands with rtk.",
    "Write report summary first with status, changed_files, tests, blockers, next_action.",
    `Report path: ${roundRel}/${reportName}`,
    "",
    "Child artifact contract:",
    "- Parent/supervisor writes status_path as key=value lines or JSON. Children write report_path only; do not self-attest liveness/status.",
    "- Required status keys: contract=child_run_status.v2 role state cwd started_at updated_at launcher attempt liveness_handle parent_launch_id launch_evidence_path prompt_path log_path report_path.",
    "- launch_evidence_path points to parent-owned JSON with contract=child_launch_evidence.v1 parent_launch_id role attempt launcher liveness_handle prompt_path log_path status_path report_path status_writer.",
    "- Final child reply: report path and outcome.",
    "",
  ].join("\n");
}

export function compactPromptFixture(seed: string, role: string, promptName: string, logName: string, statusName: string, reportName: string, roundRel = `tmp/dispatch-work/${seed}/round-1`): string {
  const baseName = statusName.replace(/\.status$/, "");
  const parentLaunchId = `${baseName}-launch-1`;
  const launchEvidencePath = `${roundRel}/${baseName}-launch-evidence.json`;
  const reportPath = `${roundRel}/${reportName}`;
  return [
    `# ${role} prompt`,
    "",
    `<io_policy prompt_path="${roundRel}/${promptName}" log_path="${roundRel}/${logName}" status_path="${roundRel}/${statusName}" launch_evidence_path="${launchEvidencePath}" report_path="${reportPath}" no_parent_transcript_polling="true" />`,
    `<launch_provenance parent_launch_id="${parentLaunchId}" launch_evidence_path="${launchEvidencePath}" status_owner="parent_or_supervisor" />`,
    `<preserve_dirty_paths dirty_baseline="none" artifact_write_roots="${roundRel}/" repo_edit_roots="" dispatcher_owned_seed_state="cli_only" />`,
    `<child_artifact_contract ref="dispatch-child-artifact.v2" report_path="${reportPath}" status_owner="parent_or_supervisor" child_writes="report_only" no_seed_mutation=".seeds/**" command_wrapper="repo-native" no_parent_transcript_polling="true" preserve_dirty_paths="required" dirty_baseline="fixture-clean" artifact_write_roots="${roundRel}/" repo_edit_roots="" dispatcher_owned_seed_state="cli_only" />`,
    "Write report summary first with status, changed_files, tests, blockers, next_action.",
    "",
  ].join("\n");
}

function mkdirp(path: string) {
  mkdirSync(path, { recursive: true });
}

function repoRelative(repo: string, path: string): string {
  return relative(repo, path).split(sep).join("/");
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

export function mutateLaunchEvidence(repo: string, seed: string, role: ReportRole, mutate: (evidence: Record<string, unknown>) => void) {
  const baseName =
    role === "verify"
      ? "verify-1"
      : role === "implement"
        ? "implement-a1"
        : role === "review"
          ? "review-r1-a1"
          : role;
  const path = join(repo, "tmp/dispatch-work", seed, "round-1", `${baseName}-launch-evidence.json`);
  const evidence = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  mutate(evidence);
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
}
