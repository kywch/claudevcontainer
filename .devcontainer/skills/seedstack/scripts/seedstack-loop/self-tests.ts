// Self-tests for seedstack-loop.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readChildResult,
  runChildTimeoutSelfTest,
  followupCount,
  type ChildResult,
  type ChildAttemptRecord,
} from "../child-supervisor.ts";
import { buildDispatchPrompt, buildManagePrompt } from "../prompts.ts";
import {
  runStatePath as statePath,
  loopStatePath,
  loopDir,
  childAttemptsDir,
  childAttemptPath,
  iterationArtifactPath,
  recoveryAttemptDir,
  recoveryScanPath,
  recoveryValidationPath,
} from "../seedstack-paths.ts";
import { preflightRepo } from "../worktree-preflight.ts";
import { writeDispatchRound } from "../fixtures/dispatch-artifacts.ts";
import {
  VALID_NONE_QUALIFIED_KNOWLEDGE_CAPTURE,
  validateKnowledgeCaptureText,
} from "../../../dispatch-work/scripts/knowledge-capture-validation.ts";
import {
  type JsonObject,
  type Options,
  type PerSeedCommitMetadata,
  WORKSPACE_ROOT,
  DISPATCH_SEED_DIR,
  readJson,
  writeJson,
  isObject,
  stringField,
  stringArray,
  numberField,
} from "./types.ts";
import { parseArgs } from "./cli.ts";
import { queueDirtyPathsFromStatus } from "./queue-operations.ts";
import {
  baseKnowledgeCaptureCheck,
  recordKnowledgeCandidates,
  knowledgeCaptureBlocksRequired,
  knowledgeStorePath,
  knowledgeStoreLineCount,
} from "./knowledge-capture.ts";

// Callback types for orchestrator-provided functions
type GetOptionsGlobal = () => Options & { seedstackDir: string; adoptionSelection: string };
type SetOptionsForTest = (opts: Options & { seedstackDir: string; adoptionSelection: string }) => void;

// Orchestrator function signatures needed by self-tests
type OrchestratorFns = {
  getOptionsGlobal: GetOptionsGlobal;
  setOptionsForTest: SetOptionsForTest;
  loadLoopState: (seedstackDir: string) => { contract: string; loop_iteration: number; scan_epoch: number; manage_epoch: number; total_followups: number; baseline_seed_count: number; skipped_seeds: Array<{ seed: string; reason: string; at: string; loop_cap?: string }> };
  allocateSupervisorIteration: (seedstackDir: string) => { iteration: number; loopState: { loop_iteration: number } };
  artifact: (seedstackDir: string, label: string, iteration: number) => string;
  resultPath: (seedstackDir: string, label: string, seed: string, iteration: number) => string;
  runScan: (seedstackDir: string, iteration: number, label: string) => JsonObject;
  ok: (result: JsonObject) => boolean;
  applyManageQueueOperations: (seedstackDir: string, iteration: number, seed: string, childPreScan: JsonObject, reconcilePath: string, proposals: JsonObject[]) => JsonObject;
  recoverMissingDispatchChildResult: (seedstackDir: string, iteration: number, seed: string) => { path: string; result: ChildResult } | null;
  writePerSeedCommitRecoveryArtifact: (seedstackDir: string, iteration: number, seed: string, phase: string, metadata: PerSeedCommitMetadata, detail: JsonObject) => string;
  runGit: (args: string[], allowFailure?: boolean) => { status: number; stdout: string; stderr: string };
  commitCandidatePaths: (dirty: JsonObject) => string[];
  parseGateExpectedSeedPaths: (text: string) => string[];
  beforeFirstDispatch: (runState: JsonObject) => boolean;
  runStateName: (runState: JsonObject) => string;
  dispatchValidatorPath: () => string;
  snapshotDirtyState: (seedstackDir: string, iteration: number, label: string) => JsonObject;
  dispatchWorkValidate: (seedstackDir: string, iteration: number, seed: string, roundPath?: string, dirtySnapshotPath?: string, queueMutationContext?: "dispatch" | "manager") => JsonObject;
};

export function assertSelfTest(condition: unknown, message: string, ...extra: unknown[]): void {
  if (!condition) throw new Error(`self-test failed: ${message}${extra.length ? ` ${JSON.stringify(extra)}` : ""}`);
}

function runGitSelfTest(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 5 * 1024 * 1024 });
  assertSelfTest((result.status ?? 1) === 0, `git ${args.join(" ")}: ${result.stderr || result.stdout}`);
}

function runWorktreePreflightSelfTest(): void {
  const root = mkdtempSync(join(tmpdir(), "seedstack-worktree-preflight-"));
  try {
    const repo = join(root, "repo");
    mkdirSync(repo, { recursive: true });
    runGitSelfTest(repo, ["init", "-b", "main"]);
    runGitSelfTest(repo, ["config", "user.email", "seedstack@example.test"]);
    runGitSelfTest(repo, ["config", "user.name", "Seedstack Test"]);
    writeFileSync(join(repo, "README.md"), "seedstack\n");
    runGitSelfTest(repo, ["add", "README.md"]);
    runGitSelfTest(repo, ["commit", "-m", "init"]);

    const subdir = join(repo, "nested", "dir");
    mkdirSync(subdir, { recursive: true });
    const main = preflightRepo({ repoInput: repo, cwd: root, policy: "linked-ok", requireWorktree: false });
    const fromSubdir = preflightRepo({ repoInput: subdir, cwd: root, policy: "linked-ok", requireWorktree: false });
    assertSelfTest(main.repo === repo, "main worktree normalizes to git top-level");
    assertSelfTest(fromSubdir.repo === repo, "subdir input normalizes to git top-level");
    assertSelfTest(main.metadata.git_common_dir !== null, "git common dir recorded");
    assertSelfTest(main.metadata.git_dir !== null, "git dir recorded");
    assertSelfTest(main.metadata.worktree_root === repo, "worktree root recorded");
    assertSelfTest(main.metadata.branch === "main", "branch recorded");
    assertSelfTest(typeof main.metadata.head === "string" && main.metadata.head.length > 0, "head recorded");
    assertSelfTest(!main.metadata.linked, "main worktree is not linked");

    const linked = join(root, "linked");
    runGitSelfTest(repo, ["worktree", "add", "-b", "wt-ok", linked]);
    const linkedPreflight = preflightRepo({ repoInput: linked, cwd: root, policy: "linked-ok", requireWorktree: false });
    assertSelfTest(linkedPreflight.repo === linked, "linked worktree normalizes to linked root");
    assertSelfTest(linkedPreflight.metadata.linked, "linked worktree accepted by linked-ok");
    const requireLinked = preflightRepo({ repoInput: linked, cwd: root, policy: "linked-ok", requireWorktree: true });
    assertSelfTest(requireLinked.metadata.require_worktree, "require-worktree accepted linked worktree");

    const persistedSeedstackDir = join(root, "persisted-stack");
    const adoptionSelection = join(root, "adoption-selection.json");
    mkdirSync(persistedSeedstackDir, { recursive: true });
    writeJson(statePath(persistedSeedstackDir), {
      state: "dispatching",
      repo: linked,
      worktree: linkedPreflight.metadata,
    });
    writeJson(adoptionSelection, { adopted_seed_ids: ["seed-test"] });
    const fromPersisted = parseArgs([
      "--repo",
      "relative-that-would-be-wrong-from-cwd",
      "--seedstack-dir",
      persistedSeedstackDir,
      "--adoption-selection",
      adoptionSelection,
    ]);
    assertSelfTest(fromPersisted.repo === linked, "run-state repo wins over cwd-relative repo during resume");
    assertSelfTest(
      fromPersisted.originalRepo === "relative-that-would-be-wrong-from-cwd",
      "original repo argument preserved while using persisted repo",
    );

    try {
      preflightRepo({ repoInput: repo, cwd: root, policy: "linked-ok", requireWorktree: true });
      assertSelfTest(false, "require-worktree fails main worktree");
    } catch (error) {
      assertSelfTest(String((error as Error).message).includes("require-worktree"), "require-worktree failure mentions flag");
    }

    const duplicate = join(root, "linked-duplicate");
    runGitSelfTest(repo, ["worktree", "add", "--force", duplicate, "wt-ok"]);
    try {
      preflightRepo({ repoInput: linked, cwd: root, policy: "linked-ok", requireWorktree: false });
      assertSelfTest(false, "linked-ok blocks same-branch duplicate linked worktrees");
    } catch (error) {
      assertSelfTest(String((error as Error).message).includes("same-branch"), "same-branch duplicate error mentions policy");
    }
    const override = preflightRepo({ repoInput: linked, cwd: root, policy: "allow-same-branch", requireWorktree: false });
    assertSelfTest(override.metadata.policy === "allow-same-branch", "explicit override accepts same-branch duplicate");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runLoopIterationAllocationSelfTest(fns: OrchestratorFns): void {
  const root = mkdtempSync(join(tmpdir(), "seedstack-loop-iteration-"));
  const adoptionSelection = join(root, "adoption-selection.json");
  const previousOptions = fns.getOptionsGlobal();
  writeFileSync(adoptionSelection, JSON.stringify({ adopted_seed_ids: ["seed-test"] }));
  fns.setOptionsForTest({
    ...parseArgs(["--repo", root, "--seedstack-dir", root, "--adoption-selection", adoptionSelection]),
    seedstackDir: root,
    adoptionSelection,
  });

  try {
    const noState = join(root, "no-state");
    mkdirSync(noState, { recursive: true });
    assertSelfTest(fns.loadLoopState(noState).loop_iteration === 0, "loop iteration defaults to zero without state or files");
    assertSelfTest(fns.allocateSupervisorIteration(noState).iteration === 1, "first allocation starts at one");

    const persisted = join(root, "persisted");
    mkdirSync(persisted, { recursive: true });
    writeJson(loopStatePath(persisted), {
      contract: "seedstack_loop_state.v1",
      loop_iteration: 7,
      scan_epoch: 0,
      manage_epoch: 0,
      total_followups: 0,
      baseline_seed_count: 1,
      skipped_seeds: [],
    });
    assertSelfTest(fns.loadLoopState(persisted).loop_iteration === 7, "loop iteration loads persisted state");
    assertSelfTest(fns.allocateSupervisorIteration(persisted).iteration === 8, "allocation follows persisted state");

    const filesOnly = join(root, "files-only");
    mkdirSync(loopDir(filesOnly), { recursive: true });
    writeFileSync(iterationArtifactPath(filesOnly, 12, "scan"), "{}\n");
    assertSelfTest(fns.loadLoopState(filesOnly).loop_iteration === 12, "loop iteration scans existing artifact files");
    assertSelfTest(fns.allocateSupervisorIteration(filesOnly).iteration === 13, "allocation follows existing artifact files");

    const merged = join(root, "merged");
    mkdirSync(loopDir(merged), { recursive: true });
    writeJson(loopStatePath(merged), {
      contract: "seedstack_loop_state.v1",
      loop_iteration: 7,
      scan_epoch: 0,
      manage_epoch: 0,
      total_followups: 0,
      baseline_seed_count: 1,
      skipped_seeds: [],
    });
    writeFileSync(iterationArtifactPath(merged, 12, "scan"), "{}\n");
    assertSelfTest(fns.loadLoopState(merged).loop_iteration === 12, "loop iteration merges persisted state and file max");

    const large = join(root, "large");
    mkdirSync(loopDir(large), { recursive: true });
    writeFileSync(join(loopDir(large), "12345-scan.json"), "{}\n");
    assertSelfTest(fns.loadLoopState(large).loop_iteration === 12345, "loop iteration scans large names");
    assertSelfTest(fns.allocateSupervisorIteration(large).iteration === 12346, "allocation follows large existing names");

    const retry = join(root, "retry");
    mkdirSync(loopDir(retry), { recursive: true });
    const first = fns.allocateSupervisorIteration(retry).iteration;
    const firstResult = fns.resultPath(retry, "dispatch", "seed-test", first);
    writeFileSync(firstResult, "{}\n");
    const second = fns.allocateSupervisorIteration(retry).iteration;
    const secondResult = fns.resultPath(retry, "dispatch", "seed-test", second);
    assertSelfTest(second === first + 1, "retry same seed allocates fresh supervisor iteration");
    assertSelfTest(secondResult !== firstResult && existsSync(firstResult), "retry same seed does not clobber first dispatch result");
  } finally {
    fns.setOptionsForTest(previousOptions);
    rmSync(root, { recursive: true, force: true });
  }
}

function runArtifactRecoveryFixtureSelfTest(fns: OrchestratorFns): void {
  const root = mkdtempSync(join(tmpdir(), "seedstack-artifact-recovery-"));
  const adoptionSelection = join(root, "adoption-selection.json");
  const previousOptions = fns.getOptionsGlobal();
  writeFileSync(adoptionSelection, JSON.stringify({ adopted_seed_ids: ["seed-test"] }));
  fns.setOptionsForTest({
    ...parseArgs(["--repo", root, "--seedstack-dir", root, "--adoption-selection", adoptionSelection]),
    seedstackDir: root,
    adoptionSelection,
  });

  try {
    mkdirSync(loopDir(root), { recursive: true });
    const firstScan = iterationArtifactPath(root, 1, "scan");
    writeFileSync(firstScan, "{\"ok\":true}\n");

    const resumed = fns.allocateSupervisorIteration(root).iteration;
    const resumedScan = fns.artifact(root, "scan", resumed);
    writeFileSync(resumedScan, "{\"ok\":true}\n");
    assertSelfTest(resumed === 2, "resumed supervisor run allocates loop/0002 after loop/0001");
    assertSelfTest(firstScan.endsWith("loop/0001-scan.json"), "first scan fixture uses loop/0001");
    assertSelfTest(resumedScan.endsWith("loop/0002-scan.json"), "resumed scan fixture uses loop/0002");
    assertSelfTest(existsSync(firstScan), "resumed supervisor run does not clobber loop/0001");

    const firstDispatch = fns.resultPath(root, "dispatch", "seed-test", resumed);
    writeFileSync(firstDispatch, "{\"decision\":\"blocked\"}\n");
    const retryIteration = fns.allocateSupervisorIteration(root).iteration;
    const retryDirty = fns.artifact(root, "retry-dirty-seed-test", retryIteration);
    const retryDispatch = fns.resultPath(root, "dispatch", "seed-test", retryIteration);
    writeFileSync(retryDirty, "{\"ok\":true}\n");
    writeFileSync(retryDispatch, "{\"decision\":\"closed\"}\n");
    assertSelfTest(retryIteration === 3, "retry same seed allocates separate loop iteration");
    assertSelfTest(firstDispatch.endsWith("loop/0002-dispatch-seed-test.result.json"), "first dispatch result keeps resumed iteration");
    assertSelfTest(retryDirty.endsWith("loop/0003-retry-dirty-seed-test.json"), "retry dirty artifact uses fresh iteration");
    assertSelfTest(retryDispatch.endsWith("loop/0003-dispatch-seed-test.result.json"), "retry dispatch result uses fresh iteration");
    assertSelfTest(existsSync(firstDispatch), "retry same seed does not clobber previous dispatch result");

    mkdirSync(recoveryAttemptDir(root, 1), { recursive: true });
    writeFileSync(recoveryScanPath(root, 1), "{\"ok\":true}\n");
    writeFileSync(recoveryValidationPath(root, 1), "{\"ok\":true}\n");
    const rootRecoveryFiles = readdirSync(root).filter((entry) => /^recovery-.*\.(?:json|md)$/.test(entry));
    assertSelfTest(rootRecoveryFiles.length === 0, "recovery artifacts stay under recovery/rec-####");
  } finally {
    fns.setOptionsForTest(previousOptions);
    rmSync(root, { recursive: true, force: true });
  }
}

function runLoopDirtyGuardPolicyFixtureSelfTest(fns: OrchestratorFns): void {
  const root = mkdtempSync(join(tmpdir(), "seedstack-loop-dirty-guard-"));
  try {
    const repo = join(root, "repo");
    const seed = "seed-test";
    const round = join(repo, "tmp", "dispatch-work", seed, "round-1");
    mkdirSync(round, { recursive: true });

    const result = spawnSync(process.execPath, [fns.dispatchValidatorPath(), "--self-test"], {
      cwd: repo,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    assertSelfTest((result.status ?? 1) === 0, "dispatch validator self-test covers loop dirty guard policy");
    const parsed = JSON.parse(result.stdout) as JsonObject;
    const tests = Array.isArray(parsed.tests) ? parsed.tests.filter((item): item is JsonObject => typeof item === "object" && item !== null) : [];
    assertSelfTest(
      tests.some((test) => test.name === "loop dirty guard snapshot mismatch softens" && test.pass === true),
      "loop dirty guard policy softens equivalent supervisor snapshot mismatches",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runMissingResultRecoverySelfTest(fns: OrchestratorFns): void {
  const root = mkdtempSync(join(tmpdir(), "seedstack-missing-result-recovery-"));
  const previousOptions = fns.getOptionsGlobal();
  try {
    const repo = join(root, "repo");
    const seedstackDir = join(root, "stack");
    const adoptionSelection = join(root, "adoption-selection.json");
    const seed = "seed-recovery";
    mkdirSync(repo, { recursive: true });
    mkdirSync(seedstackDir, { recursive: true });
    runGitSelfTest(repo, ["init", "-b", "main"]);
    runGitSelfTest(repo, ["config", "user.email", "seedstack@example.test"]);
    runGitSelfTest(repo, ["config", "user.name", "Seedstack Test"]);
    writeFileSync(join(repo, "README.md"), "fixture\n");
    runGitSelfTest(repo, ["add", "README.md"]);
    runGitSelfTest(repo, ["commit", "-m", "fixture baseline"]);
    writeJson(adoptionSelection, { adopted_seed_ids: [seed] });
    fns.setOptionsForTest({
      ...parseArgs(["--repo", repo, "--seedstack-dir", seedstackDir, "--adoption-selection", adoptionSelection]),
      seedstackDir,
      adoptionSelection,
    });
    writeDispatchRound({ repo, seed });
    mkdirSync(loopDir(seedstackDir), { recursive: true });
    const result = join(seedstackDir, "loop", "0001-dispatch-seed-recovery.result.json");
    mkdirSync(childAttemptsDir(seedstackDir), { recursive: true });
    writeJson(childAttemptPath(seedstackDir, 1, "dispatch", seed), {
      contract: "seedstack_child_attempt.v1",
      attempt_id: "0001-dispatch-seed-recovery",
      role: "dispatch",
      seed,
      iteration: 1,
      result_path: result,
      prompt_path: join(seedstackDir, "loop", "0001-dispatch-seed-recovery.prompt.md"),
      log_path: join(seedstackDir, "loop", "0001-dispatch-seed-recovery.log"),
      pid: 12345,
      pgid: 12345,
      liveness_handle: "pgid:12345",
      process_identity: { pid: 12345, starttime: "1", cwd: repo },
      baseline_dirty_snapshot: { paths: [] },
      heartbeat: { at: "2026-01-01T00:00:00Z", stale_after_ms: 1000 },
      state: "failed",
      fencing_token: "fixture",
      started_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:01Z",
      ended_at: "2026-01-01T00:00:01Z",
      exit_code: 0,
      signal: null,
      timeout: null,
    });
    const recovered = fns.recoverMissingDispatchChildResult(seedstackDir, 2, seed);
    assertSelfTest(recovered?.result.decision === "closed", "missing result with clean strict artifacts recovers closed child result");
    assertSelfTest(existsSync(result), "recovered child result written");
    const parsed = readChildResult(result, "dispatch", seed);
    assertSelfTest(parsed.summary && (parsed.summary as JsonObject).recovered_missing_result === true, "recovered result records recovery summary");
  } finally {
    fns.setOptionsForTest(previousOptions);
    rmSync(root, { recursive: true, force: true });
  }
}

function runManageQueueOpsSelfTest(fns: OrchestratorFns): void {
  const root = mkdtempSync(join(tmpdir(), "seedstack-queue-ops-"));
  const previousOptions = fns.getOptionsGlobal();
  try {
    const repo = join(root, "repo");
    const seedstackDir = join(root, "stack");
    const adoptionSelection = join(root, "adoption-selection.json");
    const stateFile = join(root, "queue-state.json");
    const cliLog = join(root, "seed-cli-log.jsonl");
    const fakeCli = join(root, "fake-seed-cli");
    mkdirSync(join(repo, ".seeds"), { recursive: true });
    mkdirSync(seedstackDir, { recursive: true });
    runGitSelfTest(repo, ["init", "-b", "main"]);
    runGitSelfTest(repo, ["config", "user.email", "seedstack@example.test"]);
    runGitSelfTest(repo, ["config", "user.name", "Seedstack Test"]);
    writeJson(join(repo, ".seeds", "issues.jsonl"), { seed: "seed-test", status: "open" });
    runGitSelfTest(repo, ["add", ".seeds/issues.jsonl"]);
    runGitSelfTest(repo, ["commit", "-m", "seed init"]);
    writeJson(adoptionSelection, { adopted_seed_ids: ["seed-test"], excluded_open_seed_ids: [] });
    writeJson(stateFile, {
      issues: [{ id: "seed-test", status: "open", labels: ["impl"], priority: 1, createdAt: "2026-01-01T00:00:00Z" }],
      next: 1,
    });
    writeFileSync(
      fakeCli,
      `#!/usr/bin/env bun
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const stateFile = ${JSON.stringify(stateFile)};
const logFile = ${JSON.stringify(cliLog)};
const repo = ${JSON.stringify(repo)};
const args = process.argv.slice(2);
appendFileSync(logFile, JSON.stringify({ cwd: process.cwd(), argv: args }) + "\\n");
const state = JSON.parse(readFileSync(stateFile, "utf8"));
const command = args[0];
const issueFor = (id) => state.issues.find((issue) => issue.id === id);
const writeState = () => {
  writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\\n");
  writeFileSync(repo + "/.seeds/issues.jsonl", state.issues.map((issue) => JSON.stringify(issue)).join("\\n") + "\\n");
};
const envelope = (data) => JSON.stringify({ ok: true, command, data }) + "\\n";
if (command === "health") process.stdout.write(envelope({ summary: { pass: 1, warning: 0, error: 0 }, checks: [] }));
else if (command === "list") process.stdout.write(envelope({ count: state.issues.length, issues: state.issues }));
else if (command === "ready") process.stdout.write(envelope({ count: state.issues.filter((issue) => issue.status !== "closed").length, issues: state.issues.filter((issue) => issue.status !== "closed") }));
else if (command === "blocked") process.stdout.write(envelope({ count: 0, issues: [] }));
else if (command === "close") {
  const issue = issueFor(args[1]);
  if (!issue) process.exit(3);
  issue.status = "closed";
  writeState();
  process.stdout.write(JSON.stringify({ ok: true, command, id: args[1] }) + "\\n");
} else if (command === "create") {
  const title = args[args.indexOf("--title") + 1];
  const id = "follow-" + state.next++;
  state.issues.push({ id, title, status: "open", labels: [], priority: 2, createdAt: "2026-01-01T00:00:00Z" });
  writeState();
  process.stdout.write(JSON.stringify({ ok: true, command, issue: { id } }) + "\\n");
} else {
  process.stderr.write("unsupported " + command + "\\n");
  process.exit(2);
}
`,
    );
    chmodSync(fakeCli, 0o755);
    fns.setOptionsForTest({
      ...parseArgs([
        "--repo",
        repo,
        "--seedstack-dir",
        seedstackDir,
        "--adoption-selection",
        adoptionSelection,
        "--seed-cli",
        fakeCli,
      ]),
      seedstackDir,
      adoptionSelection,
    });
    const reconcilePath = join(root, "reconcile.json");
    writeJson(reconcilePath, { ok: true, decision: "manage_reconcile" });
    const childPreScan = fns.runScan(seedstackDir, 1, "queue-ops-child-pre-scan");
    assertSelfTest(fns.ok(childPreScan), "queue ops fixture child pre-scan ok");
    const appliedClose = fns.applyManageQueueOperations(seedstackDir, 1, "seed-test", childPreScan, reconcilePath, [
      {
        op_type: "close-current",
        target_seed: "seed-test",
        rationale: "done",
        source_artifact_refs: [reconcilePath],
        expected_preconditions: [
          "seed seed-test is still open",
          `latest dispatch reconcile result still matches ${reconcilePath}`,
          "supervisor fresh queue state check finds no newer dispatch/manage artifact superseding this decision",
        ],
        details: {},
      },
    ]);
    assertSelfTest(fns.ok(appliedClose), "queue ops close apply succeeds");
    assertSelfTest(
      stringArray(appliedClose.warnings).some((item) => item.includes("unsupported precondition treated as advisory")),
      "queue ops records advisory unsupported precondition warning",
    );
    assertSelfTest(stringArray(appliedClose.queue_dirty_paths).includes(".seeds/issues.jsonl"), "queue ops close ledger records dirty queue path");
    const appliedCreate = fns.applyManageQueueOperations(seedstackDir, 2, "seed-test", childPreScan, reconcilePath, [
      {
        op_type: "create-follow-up",
        target_seed: "seed-test",
        rationale: "follow-up needed",
        source_artifact_refs: [reconcilePath],
        expected_preconditions: [`latest dispatch reconcile result still matches ${reconcilePath}`],
        details: { title: "Follow up", labels: ["impl"] },
      },
    ]);
    assertSelfTest(fns.ok(appliedCreate), "queue ops create apply succeeds");
    assertSelfTest(stringArray(appliedCreate.after_seed_ids).includes("follow-1"), "queue ops after ids include created follow-up");
    const runs = readFileSync(cliLog, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line) as JsonObject);
    assertSelfTest(runs.every((run) => run.cwd === repo), "queue ops configured seed-cli cwd is repo");
    assertSelfTest(runs.some((run) => Array.isArray(run.argv) && run.argv[0] === "close"), "queue ops fake cli saw close argv");
    assertSelfTest(runs.some((run) => Array.isArray(run.argv) && run.argv[0] === "create"), "queue ops fake cli saw create argv");
    const beforeFailed = runs.length;
    const blocked = fns.applyManageQueueOperations(seedstackDir, 3, "seed-test", childPreScan, join(root, "missing-reconcile.json"), [
      {
        op_type: "close-current",
        target_seed: "seed-test",
        rationale: "bad stale close",
        source_artifact_refs: [join(root, "missing-reconcile.json")],
        expected_preconditions: ["seed seed-test is still open"],
        details: {},
      },
    ]);
    assertSelfTest(!fns.ok(blocked), "queue ops precondition failure blocks");
    const afterFailed = readFileSync(cliLog, "utf8").trim().split(/\r?\n/).length;
    assertSelfTest(afterFailed === beforeFailed + 4, "queue ops precondition failure performs fresh scan only");
    const beforeMulti = afterFailed;
    const multiBlocked = fns.applyManageQueueOperations(seedstackDir, 4, "seed-test", childPreScan, reconcilePath, [
      {
        op_type: "create-follow-up",
        target_seed: "seed-test",
        rationale: "first",
        source_artifact_refs: [reconcilePath],
        expected_preconditions: [`latest dispatch reconcile result still matches ${reconcilePath}`],
        details: { title: "First" },
      },
      {
        op_type: "create-follow-up",
        target_seed: "seed-test",
        rationale: "second",
        source_artifact_refs: [reconcilePath],
        expected_preconditions: [`latest dispatch reconcile result still matches ${reconcilePath}`],
        details: { title: "Second" },
      },
    ]);
    assertSelfTest(!fns.ok(multiBlocked), "queue ops multi-mutation batch blocks");
    const afterMulti = readFileSync(cliLog, "utf8").trim().split(/\r?\n/).length;
    assertSelfTest(afterMulti === beforeMulti + 4, "queue ops multi-mutation block performs fresh scan only");
  } finally {
    fns.setOptionsForTest(previousOptions);
    rmSync(root, { recursive: true, force: true });
  }
}

function runPerSeedCommitRecoverySelfTest(fns: OrchestratorFns): void {
  const root = mkdtempSync(join(tmpdir(), "seedstack-commit-recovery-"));
  try {
    const metadata: PerSeedCommitMetadata = {
      commit: "abc123",
      worktreeRoot: join(root, "repo"),
      branch: "main",
      headBefore: "def456",
      headAfter: "abc123",
      gitCommonDir: join(root, "repo", ".git"),
      changedPathAllowlist: ["src/seed.txt", ".seeds/issues.jsonl"],
    };
    const recovery = fns.writePerSeedCommitRecoveryArtifact(root, 7, "seed-recovery", "run_state_update", metadata, {
      error: "fixture update failed",
    });
    const parsed = readJson(recovery);
    assertSelfTest(isObject(parsed), "commit recovery artifact is object");
    assertSelfTest(parsed.contract === "per_seed_commit_recovery.v1", "commit recovery artifact contract");
    assertSelfTest(parsed.recoverable === true, "commit recovery artifact is recoverable");
    assertSelfTest(parsed.commit === metadata.commit, "commit recovery artifact records commit");
    assertSelfTest(parsed.run_state === statePath(root), "commit recovery artifact records run-state path");
    const recoveryInfo = isObject(parsed.recovery) ? parsed.recovery : {};
    const expected = isObject(recoveryInfo.expected_latest_dispatch) ? recoveryInfo.expected_latest_dispatch : {};
    assertSelfTest(expected.commit_pending === false && expected.commit === metadata.commit, "commit recovery artifact records expected state");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function writeSupervisorFixtureCodex(path: string, sourceRepo: string): void {
  writeFileSync(
    path,
    `#!/usr/bin/env bun
import { mkdirSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { makeFixtureRound } from ${JSON.stringify(`${sourceRepo}/.devcontainer/skills/dispatch-work/scripts/validate-dispatch-work-fixtures.ts`)};

const result = process.env.SEEDSTACK_RESULT_FILE;
if (!result) process.exit(2);
const repo = process.cwd();
const match = /-(dispatch|manage)-(.+)\\.result\\.json$/.exec(result);
const role = match?.[1] ?? "unknown";
const seed = match?.[2] ?? "seed-test";
const log = process.env.SEEDSTACK_FIXTURE_LAUNCH_LOG;
if (log) appendFileSync(log, JSON.stringify({ role, cwd: repo, argv: process.argv.slice(2), result }) + "\\n");

if (role === "dispatch") {
  mkdirSync(join(repo, "src"), { recursive: true });
  const round = join(repo, "tmp", "dispatch-work", seed, "round-1");
  makeFixtureRound(repo, seed, round, "pass", "close", true, "child_run_status.v2", undefined, "review-r1-a1.md", true, "pid:" + process.pid, true, "supervisor");
  for (const prompt of ["execute-prompt.md", "implement-a1-prompt.md", "review-r1-a1-prompt.md", "verify-1-prompt.md"]) {
    const promptPath = join(round, prompt);
    writeFileSync(promptPath, readFileSync(promptPath, "utf8").replace(/repo_edit_roots=""/g, 'repo_edit_roots="src"'));
  }
  const dispatchRoot = join(repo, "tmp", "dispatch-work", seed);
  const roundRel = "tmp/dispatch-work/" + seed + "/round-1";
  writeFileSync(join(round, "executor-report.md"), [
    "## Summary",
    "status: pass",
    "changed_files: none",
    "tests: fixture dispatch artifacts generated",
    "blockers: none",
    "next_action: close",
    "",
    "Verdict: pass",
    "Recommendation: close",
    "",
  ].join("\\n"));
  writeFileSync(join(round, "implement-a1-report.md"), [
    "## Summary",
    "status: done",
    "changed_files: none",
    "tests: fixture dispatch artifacts generated",
    "blockers: none",
    "next_action: close",
    "",
    "Outcome: done",
    "Recommendation: close",
    "",
  ].join("\\n"));
  writeFileSync(join(round, "review-r1-a1.md"), [
    "## Summary",
    "status: pass",
    "changed_files: none",
    "tests: fixture dispatch artifacts inspected",
    "blockers: none",
    "next_action: close",
    "",
    "Verdict: pass",
    "Recommendation: close",
    "",
  ].join("\\n"));
  writeFileSync(join(round, "verify-1.md"), [
    "## Summary",
    "status: pass",
    "changed_files: none",
    "tests: fixture dispatch artifacts inspected",
    "blockers: none",
    "next_action: close",
    "",
    "Verdict: pass",
    "",
  ].join("\\n"));
  writeFileSync(join(dispatchRoot, "knowledge-capture.md"), [
    "capture_state=none_qualified",
    "store_count: 0",
    "merge_union: true",
    "marker_count: 0",
    "artifacts_reviewed: 4",
    "candidate_count: 0",
    "rejected_count: 0",
    "none_rationale: No durable cross-session knowledge candidates in fixture artifacts.",
    "",
  ].join("\\n"));
  writeFileSync(join(dispatchRoot, "gate.md"), [
    "# Gate: " + seed,
    "",
    "decision: close",
    "",
    "## Evidence Paths",
    "| path | outcome |",
    "|------|---------|",
    "| " + roundRel + "/executor-report.md | pass |",
    "| " + roundRel + "/implement-a1-report.md | done |",
    "| " + roundRel + "/review-r1-a1.md | pass |",
    "| " + roundRel + "/verify-1.md | pass |",
    "",
    "## Gate Checks",
    "| command | cwd | exit_code | status |",
    "|---|---|---|---|",
    "| bun test fixture | " + process.cwd() + " | 0 | pass |",
    "",
    "## Dirty Guard",
    "- command: git status --porcelain=v1 --untracked-files=all",
    "- snapshot: loop supervisor snapshot",
    "- implementation paths: none",
    "- queue paths: none",
    "- unexpected paths: none",
    "",
    String.fromCharCode(96, 96, 96) + "json",
    JSON.stringify({
      contract: "dirty_guard.v1",
      baseline_paths: [],
      actual_impl_paths: [],
      queue_paths: [],
      unexpected_paths: [],
      snapshot_path: "loop supervisor snapshot",
    }, null, 2),
    String.fromCharCode(96, 96, 96),
    "",
  ].join("\\n"));
  writeFileSync(result, JSON.stringify({
    contract: "seedstack_child_result.v1",
    ok: true,
    role: "dispatch",
    seed,
    decision: "closed",
    round_path: roundRel,
    followups_requested: 0,
    followups_created: [],
  }, null, 2) + "\\n");
} else if (role === "manage") {
  writeFileSync(result, JSON.stringify({
    contract: "seedstack_child_result.v1",
    ok: true,
    role: "manage",
    seed,
    decision: "done",
    followups_requested: 0,
    followups_created: [],
    proposed_queue_operations: [{
      op_type: "close-current",
      target_seed: seed,
      rationale: "fixture dispatch closed cleanly",
      source_artifact_refs: [result],
      expected_preconditions: ["seed " + seed + " is still open", "latest dispatch reconcile result still matches fixture"],
      details: {},
    }],
  }, null, 2) + "\\n");
} else {
  process.stderr.write("unknown role for " + result + "\\n");
  process.exit(2);
}
`,
  );
  chmodSync(path, 0o755);
}

export function writeSupervisorFixtureSeedCli(path: string, stateFile: string, logFile: string): void {
  writeFileSync(
    path,
    `#!/usr/bin/env bun
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const stateFile = ${JSON.stringify(stateFile)};
const logFile = ${JSON.stringify(logFile)};
const args = process.argv.slice(2);
appendFileSync(logFile, JSON.stringify({ cwd: process.cwd(), argv: args }) + "\\n");
const state = JSON.parse(readFileSync(stateFile, "utf8"));
const command = args[0];
const issueFor = (id) => state.issues.find((issue) => issue.id === id);
const writeState = () => {
  writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\\n");
  writeFileSync(join(process.cwd(), ".seeds", "issues.jsonl"), state.issues.map((issue) => JSON.stringify(issue)).join("\\n") + "\\n");
};
const envelope = (data) => JSON.stringify({ ok: true, command, data }) + "\\n";
if (command === "health") process.stdout.write(envelope({ summary: { pass: 1, warning: 0, error: 0 }, checks: [] }));
else if (command === "list") process.stdout.write(envelope({ count: state.issues.length, issues: state.issues }));
else if (command === "ready") process.stdout.write(envelope({ count: state.issues.filter((issue) => issue.status !== "closed").length, issues: state.issues.filter((issue) => issue.status !== "closed") }));
else if (command === "blocked") process.stdout.write(envelope({ count: 0, issues: [] }));
else if (command === "close") {
  const issue = issueFor(args[1]);
  if (!issue) process.exit(3);
  issue.status = "closed";
  writeState();
  process.stdout.write(JSON.stringify({ ok: true, command, id: args[1] }) + "\\n");
} else if (command === "create") {
  process.stderr.write("fixture does not create follow-ups\\n");
  process.exit(2);
} else {
  process.stderr.write("unsupported " + command + "\\n");
  process.exit(2);
}
`,
  );
  chmodSync(path, 0o755);
}

export function setupSupervisorFixtureRepo(root: string): { repo: string; linked: string; seed: string } {
  const repo = join(root, "repo");
  const seed = "seed-test";
  mkdirSync(join(repo, ".seeds"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "README.md"), "fixture\\n");
  writeFileSync(join(repo, "src", "fixture.txt"), "initial\\n");
  writeFileSync(join(repo, ".seeds", "issues.jsonl"), `${JSON.stringify({
    id: seed,
    title: "Fixture seed",
    status: "open",
    description: "Fixture seed\n\narea: src\n",
    labels: ["impl"],
    priority: 1,
    createdAt: "2026-01-01T00:00:00Z",
  })}\\n`);
  runGitSelfTest(repo, ["init", "-b", "main"]);
  runGitSelfTest(repo, ["config", "user.email", "seedstack@example.test"]);
  runGitSelfTest(repo, ["config", "user.name", "Seedstack Test"]);
  runGitSelfTest(repo, ["add", "."]);
  runGitSelfTest(repo, ["commit", "-m", "fixture init"]);
  const linked = join(root, "linked");
  runGitSelfTest(repo, ["worktree", "add", "-b", "fixture-linked", linked]);
  return { repo, linked, seed };
}

export function runSupervisorFixture(root: string, repo: string, seed: string, fixtureName: string, fns: OrchestratorFns): JsonObject {
  const seedstackDir = join(repo, "tmp", "seedstack", fixtureName);
  const adoptionSelection = join(seedstackDir, "adoption-selection.json");
  const stateFile = join(root, `${fixtureName}-seed-cli-state.json`);
  const seedCliLog = join(root, `${fixtureName}-seed-cli.jsonl`);
  const launchLog = join(root, `${fixtureName}-child-launch.jsonl`);
  const fakeSeedCli = join(root, `${fixtureName}-seed-cli`);
  const fakeCodex = join(root, `${fixtureName}-codex`);
  mkdirSync(seedstackDir, { recursive: true });
  writeJson(adoptionSelection, { adopted_seed_ids: [seed], excluded_open_seed_ids: [] });
  writeJson(stateFile, {
    issues: [{ id: seed, title: "Fixture seed", status: "open", description: "Fixture seed\n\narea: src\n", labels: ["impl"], priority: 1, createdAt: "2026-01-01T00:00:00Z" }],
  });
  writeSupervisorFixtureSeedCli(fakeSeedCli, stateFile, seedCliLog);
  writeSupervisorFixtureCodex(fakeCodex, WORKSPACE_ROOT);
  // Use the orchestrator's own path (one level up from this module)
  const loopScriptPath = resolve(fileURLToPath(import.meta.url), "../../seedstack-loop.ts");
  const result = spawnSync(process.execPath, [
    loopScriptPath,
    "--repo",
    repo,
    "--seedstack-dir",
    seedstackDir,
    "--adoption-selection",
    adoptionSelection,
    "--seed-cli",
    fakeSeedCli,
    "--codex-bin",
    fakeCodex,
    "--commit-policy",
    "per_seed",
    "--knowledge-capture",
    "audit",
    "--post-seed-delay-ms",
    "1",
    "--max-iterations",
    "8",
    "--pretty",
  ], {
    cwd: fns.getOptionsGlobal().repo,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env, SEEDSTACK_FIXTURE_LAUNCH_LOG: launchLog },
  });
  const validationDebug = existsSync(loopDir(seedstackDir))
    ? readdirSync(loopDir(seedstackDir))
      .filter((file) => file.includes("dispatch-work-validation"))
      .map((file) => `${file}: ${readFileSync(join(loopDir(seedstackDir), file), "utf8").slice(0, 4000)}`)
      .join("\n")
    : "";
  const childDebug = existsSync(loopDir(seedstackDir))
    ? readdirSync(loopDir(seedstackDir))
      .filter((file) => file.endsWith(".log"))
      .map((file) => `${file}: ${readFileSync(join(loopDir(seedstackDir), file), "utf8").slice(0, 4000)}`)
      .join("\n")
    : "";
  assertSelfTest((result.status ?? 1) === 0, `${fixtureName} supervisor exits cleanly: ${result.stderr || result.stdout}\n${validationDebug}\n${childDebug}`);
  const finalLine = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "{}";
  const parsed = JSON.parse(finalLine) as JsonObject;
  assertSelfTest(parsed.ok === true && parsed.state === "done", `${fixtureName} supervisor reaches done`);
  const seedCliRuns = readFileSync(seedCliLog, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line) as JsonObject);
  const childRuns = readFileSync(launchLog, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line) as JsonObject);
  assertSelfTest(seedCliRuns.length > 0 && seedCliRuns.every((run) => run.cwd === repo), `${fixtureName} seed-cli cwd uses target repo`);
  assertSelfTest(childRuns.some((run) => run.role === "dispatch" && run.cwd === repo), `${fixtureName} dispatch child cwd uses target repo`);
  assertSelfTest(childRuns.some((run) => run.role === "manage" && run.cwd === repo), `${fixtureName} manage child cwd uses target repo`);
  assertSelfTest(existsSync(join(seedstackDir, "commit-ledger.md")), `${fixtureName} commit ledger written`);
  const runState = JSON.parse(readFileSync(statePath(seedstackDir), "utf8")) as JsonObject;
  const worktree = isObject(runState.worktree) ? runState.worktree : {};
  assertSelfTest(worktree.worktree_root === repo, `${fixtureName} run-state worktree root uses target repo`);
  const ledger = readFileSync(join(seedstackDir, "commit-ledger.md"), "utf8");
  assertSelfTest(ledger.includes(repo), `${fixtureName} commit ledger records target worktree root`);
  assertSelfTest(ledger.includes(".seeds/issues.jsonl"), `${fixtureName} commit ledger records queue changed path allowlist`);
  return { seedstackDir, seedCliLog, launchLog, final: parsed };
}

function runLinkedWorktreeSupervisorFixtureSelfTest(fns: OrchestratorFns): void {
  const root = mkdtempSync(join(tmpdir(), "seedstack-linked-supervisor-"));
  try {
    const { repo, linked, seed } = setupSupervisorFixtureRepo(root);
    const previousOptions = fns.getOptionsGlobal();
    fns.setOptionsForTest(parseArgs(["--repo", repo]) as Options & { seedstackDir: string; adoptionSelection: string });
    try {
      runSupervisorFixture(root, repo, seed, "main-fixture", fns);
      runSupervisorFixture(root, linked, seed, "linked-fixture", fns);
      const duplicate = join(root, "linked-duplicate");
      runGitSelfTest(repo, ["worktree", "add", "--force", duplicate, "fixture-linked"]);
      const duplicateSeedstackDir = join(linked, "tmp", "seedstack", "duplicate-fixture");
      const duplicateAdoption = join(duplicateSeedstackDir, "adoption-selection.json");
      const duplicateState = join(root, "duplicate-state.json");
      const duplicateSeedCliLog = join(root, "duplicate-seed-cli.jsonl");
      const duplicateChildLog = join(root, "duplicate-child.jsonl");
      const duplicateSeedCli = join(root, "duplicate-seed-cli");
      const duplicateCodex = join(root, "duplicate-codex");
      mkdirSync(duplicateSeedstackDir, { recursive: true });
      writeJson(duplicateAdoption, { adopted_seed_ids: [seed], excluded_open_seed_ids: [] });
      writeJson(duplicateState, { issues: [{ id: seed, status: "open", description: "Fixture seed\n\narea: src\n", labels: ["impl"], priority: 1, createdAt: "2026-01-01T00:00:00Z" }] });
      writeSupervisorFixtureSeedCli(duplicateSeedCli, duplicateState, duplicateSeedCliLog);
      writeSupervisorFixtureCodex(duplicateCodex, WORKSPACE_ROOT);
      const loopScriptPath = resolve(fileURLToPath(import.meta.url), "../../seedstack-loop.ts");
      const blocked = spawnSync(process.execPath, [
        loopScriptPath,
        "--repo",
        linked,
        "--seedstack-dir",
        duplicateSeedstackDir,
        "--adoption-selection",
        duplicateAdoption,
        "--seed-cli",
        duplicateSeedCli,
        "--codex-bin",
        duplicateCodex,
        "--max-iterations",
        "1",
      ], {
        cwd: repo,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, SEEDSTACK_FIXTURE_LAUNCH_LOG: duplicateChildLog },
      });
      assertSelfTest((blocked.status ?? 0) !== 0, "same-branch duplicate linked worktree blocks supervisor");
      assertSelfTest((blocked.stdout + blocked.stderr).includes("same-branch"), "duplicate linked worktree error mentions policy");
      assertSelfTest(!existsSync(duplicateSeedCliLog), "duplicate linked worktree blocks before seed-cli queue mutation");
      assertSelfTest(!existsSync(duplicateChildLog), "duplicate linked worktree blocks before child launch");
    } finally {
      fns.setOptionsForTest(previousOptions);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export async function selfTest(pretty: boolean, fns: OrchestratorFns): Promise<never> {
  const parsed = parseArgs([
    "--child-total-timeout-ms",
    "123",
    "--child-silent-timeout-ms=45",
    "--child-silent-probe-ms",
    "6",
    "--post-seed-delay-ms=25",
  ]);
  assertSelfTest(parsed.childTotalTimeoutMs === 123, "total timeout arg parse");
  assertSelfTest(parsed.childSilentTimeoutMs === 45, "silent timeout equals arg parse");
  assertSelfTest(parsed.childSilentProbeMs === 6, "silent probe arg parse");
  assertSelfTest(parsed.postSeedDelayMs === 25, "post-seed delay equals arg parse");
  assertSelfTest(parsed.commitPolicy === "per_seed", "auto commit policy default");
  assertSelfTest(parsed.knowledgeCapture === "audit", "knowledge capture default");
  const recordKnowledge = parseArgs(["--knowledge-capture", "record", "--knowledge-required"]);
  assertSelfTest(recordKnowledge.knowledgeCapture === "record", "knowledge capture arg parse");
  assertSelfTest(recordKnowledge.knowledgeRequired, "knowledge required arg parse");
  const offKnowledge = parseArgs(["--knowledge-capture=off"]);
  assertSelfTest(offKnowledge.knowledgeCapture === "off", "knowledge capture equals arg parse");
  const manualDefault = parseArgs(["--mode", "manual"]);
  assertSelfTest(manualDefault.commitPolicy === "none", "manual commit policy default");
  const explicitNone = parseArgs(["--commit-policy", "none"]);
  assertSelfTest(explicitNone.commitPolicy === "none", "explicit none commit policy");
  assertSelfTest(parsed.codexReasoningEffort === "medium", "reasoning effort default");
  const lowReasoning = parseArgs(["--codex-reasoning-effort", "low"]);
  assertSelfTest(lowReasoning.codexReasoningEffort === "low", "reasoning effort arg parse");
  const xhighReasoning = parseArgs(["--codex-reasoning-effort=xhigh"]);
  assertSelfTest(xhighReasoning.codexReasoningEffort === "xhigh", "reasoning effort equals arg parse");
  assertSelfTest(parsed.runner === "codex", "runner default");
  assertSelfTest(parsed.claudeBin === "claude", "claude bin default");
  assertSelfTest(parsed.claudeModel === "claude-sonnet-4-6", "claude model default");
  const claudeParsed = parseArgs(["--runner", "claude", "--claude-model", "claude-haiku-4-5-20251001"]);
  assertSelfTest(claudeParsed.runner === "claude", "claude runner parse");
  assertSelfTest(claudeParsed.claudeModel === "claude-haiku-4-5-20251001", "claude model parse");
  const clamped = parseArgs(["--child-silent-timeout-ms", "50"]);
  assertSelfTest(clamped.childSilentProbeMs === 50, "silent probe clamps to timeout");
  try {
    parseArgs(["--post-seed-delay-ms", "-1"]);
    assertSelfTest(false, "invalid post-seed delay rejected");
  } catch (error) {
    assertSelfTest(String((error as Error).message).includes("post-seed-delay-ms"), "invalid post-seed delay error");
  }
  try {
    parseArgs(["--child-total-timeout-ms", "0"]);
    assertSelfTest(false, "invalid timeout rejected");
  } catch (error) {
    assertSelfTest(String((error as Error).message).includes("positive"), "invalid timeout error");
  }
  try {
    parseArgs(["--codex-reasoning-effort", "turbo"]);
    assertSelfTest(false, "invalid reasoning effort rejected");
  } catch (error) {
    assertSelfTest(String((error as Error).message).includes("codex-reasoning-effort"), "invalid reasoning effort error");
  }
  try {
    parseArgs(["--knowledge-capture", "maybe"]);
    assertSelfTest(false, "invalid knowledge capture rejected");
  } catch (error) {
    assertSelfTest(String((error as Error).message).includes("knowledge-capture"), "invalid knowledge capture error");
  }
  try {
    fns.runStateName({ state: "dispatch" });
    assertSelfTest(false, "invalid run-state rejected");
  } catch (error) {
    assertSelfTest(String((error as Error).message).includes("invalid_run_state"), "invalid run-state error");
  }
  assertSelfTest(fns.beforeFirstDispatch({ state: "idle" }), "empty idle run-state is before first dispatch");
  assertSelfTest(!fns.beforeFirstDispatch({ state: "idle", loop_iteration: 1 }), "loop iteration marks dispatch started");
  assertSelfTest(!fns.beforeFirstDispatch({ state: "idle", dispatch_attempts: { S1: 1 } }), "dispatch attempt marks dispatch started");
  assertSelfTest(!fns.beforeFirstDispatch({ state: "idle", latest_dispatch: { seed_id: "S1" } }), "latest dispatch marks dispatch started");
  runWorktreePreflightSelfTest();
  runLoopIterationAllocationSelfTest(fns);
  runArtifactRecoveryFixtureSelfTest(fns);
  runLoopDirtyGuardPolicyFixtureSelfTest(fns);
  runMissingResultRecoverySelfTest(fns);
  runManageQueueOpsSelfTest(fns);
  runPerSeedCommitRecoverySelfTest(fns);
  runLinkedWorktreeSupervisorFixtureSelfTest(fns);
  const queueDirty = queueDirtyPathsFromStatus([
    " M .seeds/issues.jsonl",
    "?? .seeds/knowledge.jsonl",
    " M .seeds/deps.jsonl",
    "R  .seeds/issues.jsonl -> .seeds/knowledge.jsonl",
    " M src/app.ts",
    "",
  ].join("\n"));
  assertSelfTest(
    queueDirty.length === 2 && queueDirty.includes(".seeds/issues.jsonl") && queueDirty.includes(".seeds/deps.jsonl"),
    "queue dirty preflight excludes knowledge and includes queue paths",
  );
  const commitCandidates = fns.commitCandidatePaths({
    paths: [
      { path: ".seeds/issues.jsonl", classification: "dispatcher_owned" },
      { path: ".seeds/knowledge.jsonl", classification: "capture_owned" },
      { path: "src/owned.ts", classification: "expected_seed" },
    ],
  });
  assertSelfTest(
    commitCandidates.join(",") === ".seeds/issues.jsonl,src/owned.ts",
    "commit candidates exclude capture-owned knowledge",
  );
  const knowledgeRepo = mkdtempSync(join(tmpdir(), "seedstack-knowledge-"));
  try {
    const init = spawnSync("git", ["init"], { cwd: knowledgeRepo, encoding: "utf8" });
    assertSelfTest((init.status ?? 1) === 0, "knowledge self-test git init");
    mkdirSync(join(knowledgeRepo, "tmp", "dispatch-work", "seed-empty"), { recursive: true });
    writeFileSync(join(knowledgeRepo, "tmp", "dispatch-work", "seed-empty", "knowledge-capture.md"), [
      "capture_state=none_qualified",
      "store_count: 0",
      "merge_union: true",
      "marker_count: 0",
      "artifacts_reviewed: 4",
      "candidate_count: 0",
      "rejected_count: 0",
      "none_rationale: No durable cross-session knowledge candidates in fixture artifacts.",
      "",
    ].join("\n"));
    mkdirSync(join(knowledgeRepo, "tmp", "dispatch-work", "seed-shallow"), { recursive: true });
    writeFileSync(join(knowledgeRepo, "tmp", "dispatch-work", "seed-shallow", "knowledge-capture.md"), "capture_state=none_qualified\naccepted IDs: []\n");
    mkdirSync(join(knowledgeRepo, "tmp", "dispatch-work", "seed-status-only"), { recursive: true });
    writeFileSync(join(knowledgeRepo, "tmp", "dispatch-work", "seed-status-only", "knowledge-capture.md"), "status: none_qualified\naccepted IDs: []\n");
    mkdirSync(join(knowledgeRepo, "tmp", "dispatch-work", "seed-invalid"), { recursive: true });
    writeFileSync(join(knowledgeRepo, "tmp", "dispatch-work", "seed-invalid", "knowledge-capture.md"), "\n");
    mkdirSync(join(knowledgeRepo, "tmp", "dispatch-work", "seed-recorded"), { recursive: true });
    writeFileSync(join(knowledgeRepo, "tmp", "dispatch-work", "seed-recorded", "knowledge-capture.md"), [
      "capture_state=recorded",
      "```json",
      "{\"accepted_records\":[{\"type\":\"failure\",\"content\":\"When X, beware Y. Cause: Z. Do: W. Verify: T. Limit: L.\"}]}",
      "```",
      "",
    ].join("\n"));
    const testOptions = parseArgs([
      "--repo",
      knowledgeRepo,
      "--seedstack-dir",
      "tmp/seedstack/test",
      "--adoption-selection",
      "tmp/seedstack/test/adoption-selection.json",
      "--knowledge-required",
    ]) as Options & { seedstackDir: string; adoptionSelection: string };
    fns.setOptionsForTest(testOptions);
    const knowledgeRunGit = fns.runGit;
    const missingAudit = baseKnowledgeCaptureCheck(knowledgeRepo, "seed-missing", "audit", knowledgeRunGit);
    assertSelfTest(missingAudit.ok !== true && stringField(missingAudit.state) === "audit_missing", "knowledge audit missing fails check");
    assertSelfTest(knowledgeCaptureBlocksRequired(missingAudit, true), "required missing audit blocks");
    const invalidAudit = baseKnowledgeCaptureCheck(knowledgeRepo, "seed-invalid", "audit", knowledgeRunGit);
    assertSelfTest(invalidAudit.ok !== true && stringField(invalidAudit.state) === "audit_invalid", "knowledge invalid audit rejected");
    assertSelfTest(knowledgeCaptureBlocksRequired(invalidAudit, true), "required invalid audit blocks");
    const shallowAudit = baseKnowledgeCaptureCheck(knowledgeRepo, "seed-shallow", "audit", knowledgeRunGit);
    assertSelfTest(shallowAudit.ok !== true && stringField(shallowAudit.state) === "audit_invalid", "knowledge shallow audit rejected");
    assertSelfTest(knowledgeCaptureBlocksRequired(shallowAudit, true), "required shallow audit blocks");
    const statusOnlyAudit = baseKnowledgeCaptureCheck(knowledgeRepo, "seed-status-only", "audit", knowledgeRunGit);
    const statusOnlyAuditInfo = isObject(statusOnlyAudit.audit) ? statusOnlyAudit.audit : {};
    assertSelfTest(statusOnlyAudit.ok !== true && stringField(statusOnlyAudit.state) === "audit_invalid", "knowledge status-only none qualified rejected");
    assertSelfTest(
      Array.isArray(statusOnlyAuditInfo.errors) && statusOnlyAuditInfo.errors.includes("capture_state missing"),
      "knowledge status-only none qualified reports capture_state missing",
    );
    assertSelfTest(knowledgeCaptureBlocksRequired(statusOnlyAudit, true), "required status-only none qualified blocks");
    const emptyAudit = baseKnowledgeCaptureCheck(knowledgeRepo, "seed-empty", "audit", knowledgeRunGit);
    assertSelfTest(emptyAudit.ok === true && stringField(emptyAudit.state) === "none_qualified", "knowledge none qualified audit succeeds");
    assertSelfTest(!knowledgeCaptureBlocksRequired(emptyAudit, true), "required none qualified audit passes");
    const missingStore = recordKnowledgeCandidates(knowledgeRepo, baseKnowledgeCaptureCheck(knowledgeRepo, "seed-recorded", "record", knowledgeRunGit));
    assertSelfTest(missingStore.ok !== true && stringField(missingStore.state) === "store_missing", "record mode missing store state");
    mkdirSync(join(knowledgeRepo, ".seeds"), { recursive: true });
    writeFileSync(join(knowledgeRepo, ".seeds", ".gitattributes"), "knowledge.jsonl merge=union\n");
    writeFileSync(join(knowledgeRepo, ".seeds", "knowledge.jsonl"), "{\"id\":\"ex-5e569a\",\"type\":\"guide\",\"content\":\"x\",\"recorded_at\":\"2026-01-01T00:00:00.000Z\"}\n");
    const noneQualified = recordKnowledgeCandidates(knowledgeRepo, baseKnowledgeCaptureCheck(knowledgeRepo, "seed-empty", "record", knowledgeRunGit));
    assertSelfTest(noneQualified.ok === true && stringField(noneQualified.state) === "none_qualified", "record mode none qualified state");
    assertSelfTest(!knowledgeCaptureBlocksRequired(noneQualified, true), "required none qualified record passes");
    const auditOne = baseKnowledgeCaptureCheck(knowledgeRepo, "seed-empty", "audit", knowledgeRunGit);
    const auditTwo = baseKnowledgeCaptureCheck(knowledgeRepo, "seed-empty", "audit", knowledgeRunGit);
    assertSelfTest(JSON.stringify(auditOne) === JSON.stringify(auditTwo), "knowledge audit deterministic");
    const storeInfo = isObject(auditOne.store) ? auditOne.store : {};
    assertSelfTest(storeInfo.count === 1 && storeInfo.dirty === true && storeInfo.merge_union === true, "knowledge store state inspected");
    mkdirSync(join(knowledgeRepo, "tmp", "dispatch-work", "seed-candidate"), { recursive: true });
    writeFileSync(join(knowledgeRepo, "tmp", "dispatch-work", "seed-candidate", "knowledge-capture.md"), [
      "capture_state=recorded",
      "```json",
      JSON.stringify({
        accepted_records: [{ type: "failure", content: "When accepted, record this. Cause: Z. Do: W. Verify: T. Limit: L." }],
        rejected_records: [{ type: "failure", content: "Rejected record must not be appended." }],
      }),
      "```",
      "",
    ].join("\n"));
    const candidateAudit = baseKnowledgeCaptureCheck(knowledgeRepo, "seed-candidate", "audit", knowledgeRunGit);
    const candidateAuditInfo = isObject(candidateAudit.audit) ? candidateAudit.audit : {};
    assertSelfTest(candidateAuditInfo.structured_candidates_count === 1, "knowledge structured candidate parse");
    const recorded = recordKnowledgeCandidates(knowledgeRepo, baseKnowledgeCaptureCheck(knowledgeRepo, "seed-candidate", "record", knowledgeRunGit));
    assertSelfTest(recorded.ok === true && stringField(recorded.state) === "recorded", "accepted_records append via store succeeds");
    const finalStore = readFileSync(join(knowledgeRepo, ".seeds", "knowledge.jsonl"), "utf8");
    assertSelfTest(finalStore.includes("When accepted, record this."), "accepted record appended");
    assertSelfTest(!finalStore.includes("Rejected record must not be appended."), "rejected record not appended");
    assertSelfTest(knowledgeStoreLineCount(knowledgeStorePath(knowledgeRepo)).count === 2, "only accepted record appended");
  } finally {
    rmSync(knowledgeRepo, { recursive: true, force: true });
  }
  await runChildTimeoutSelfTest(assertSelfTest);
  const dispatchPrompt = buildDispatchPrompt("/repo", "seed-test", "/result.json");
  const noneQualifiedTemplate = dispatchPrompt.match(/Minimal valid none_qualified example:\n\n```text\n([\s\S]*?)\n```/)?.[1] ?? "";
  const promptTemplateValidation = validateKnowledgeCaptureText(noneQualifiedTemplate);
  assertSelfTest(promptTemplateValidation.ok, "dispatch prompt none qualified template validates", promptTemplateValidation.errors);
  assertSelfTest(
    noneQualifiedTemplate.trim() === VALID_NONE_QUALIFIED_KNOWLEDGE_CAPTURE.trim(),
    "dispatch prompt embeds shared none qualified template",
  );
  assertSelfTest(dispatchPrompt.includes("outer supervised exec (Codex or Claude Code CLI) managed by seedstack"), "dispatch prompt explains outer supervision");
  assertSelfTest(dispatchPrompt.includes("native agent-spawn tool (spawn_agent for Codex, Agent tool for Claude Code) only if it returns a real child id"), "dispatch prompt requires real spawn_agent id");
  assertSelfTest(dispatchPrompt.includes("Never fabricate liveness handles"), "dispatch prompt forbids fabricated liveness");
  assertSelfTest(dispatchPrompt.includes("not child_run_status evidence"), "dispatch prompt separates seedstack result from child status evidence");
  assertSelfTest(!dispatchPrompt.includes('"decision": "closed|blocked|escalated|crashed",'), "dispatch prompt avoids literal enum example");
  const managePrompt = buildManagePrompt({
    repo: "/repo",
    seedstackDir: "/stack",
    followupsPerManage: 2,
    seed: "seed-test",
    reconcileFile: "/reconcile.json",
    resultFile: "/result.json",
    remainingFollowups: 3,
  });
  assertSelfTest(managePrompt.includes("retry_same_seed, continue_other_seeds, blocked, done"), "manage prompt lists retry policy enum");
  assertSelfTest(!managePrompt.includes('"decision": "continue"'), "manage prompt avoids legacy continue decision");
  const gatePaths = fns.parseGateExpectedSeedPaths([
    "## Dirty Guard",
    "- known dirty paths before close: `.seeds/issues.jsonl` (dispatcher claim), `impl/rust/tests/cli.rs` (implementation)",
    "- artifact: `tmp/dispatch-work/seed/gate.md`",
    "- status words: `close`, `pass`",
    "outside bullet `impl/rust/src/lib.rs`",
    "## Review",
  ].join("\n"));
  assertSelfTest(gatePaths.length === 1 && gatePaths[0] === "impl/rust/tests/cli.rs", "gate dirty paths parse");
  const yamlGatePaths = fns.parseGateExpectedSeedPaths([
    "dirty_guard:",
    "- .seeds/issues.jsonl dirty from dispatcher claim only.",
    "- implementation changes limited to seedspec/impl_v2/rust/src/main.rs and impl_v2/rust/tests/list_labels.rs.",
    "",
    "final_rationale:",
    "- ignore impl_v2/rust/src/not_dirty.rs here.",
  ].join("\n"));
  assertSelfTest(
    yamlGatePaths.length === 2 &&
      yamlGatePaths.includes("impl_v2/rust/src/main.rs") &&
      yamlGatePaths.includes("impl_v2/rust/tests/list_labels.rs"),
    "gate dirty_guard yaml paths parse",
  );
  const devcontainerGatePaths = fns.parseGateExpectedSeedPaths([
    "## Dirty Guard",
    "- implementation paths: .devcontainer/skills/seedstack/scripts/seedstack-loop.ts",
    "```json",
    JSON.stringify({
      contract: "dirty_guard.v1",
      actual_impl_paths: [".devcontainer/skills/seedstack/scripts/seedstack-loop.ts"],
    }),
    "```",
  ].join("\n"));
  assertSelfTest(
    devcontainerGatePaths.includes(".devcontainer/skills/seedstack/scripts/seedstack-loop.ts") &&
      !devcontainerGatePaths.includes("skills/seedstack/scripts/seedstack-loop.ts"),
    "gate dirty paths preserve dot-prefixed root",
  );

  const result = {
    contract: "seedstack_loop_self_test.v1",
    ok: true,
    checks: [
      "args_parse",
      "post_seed_delay_args_parse",
      "child_timeout_args_parse",
      "child_silent_probe_clamp",
      "child_timeout_watchdog",
      "child_total_timeout",
      "invalid_run_state",
      "preexisting_queue_dirty_before_auto_run",
      "knowledge_capture_args",
      "knowledge_capture_required",
      "knowledge_capture_audit",
      "knowledge_capture_record_none",
      "child_result_contract",
      "child_launch_provenance",
      "dispatch_prompt_launch_provenance",
      "gate_dirty_expected_paths",
      "worktree_preflight_policy",
      "loop_state_contract",
      "loop_iteration_allocation",
      "artifact_recovery_fixtures",
      "loop_dirty_guard_policy_fixture",
      "missing_result_recovery_fixture",
      "manage_queue_ops_fixture",
      "per_seed_commit_recovery_fixture",
      "linked_worktree_supervisor_fixture",
    ],
  };
  process.stdout.write(`${JSON.stringify(result, null, pretty ? 2 : 0)}\n`);
  process.exit(0);
}
