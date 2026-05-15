/**
 * dispatch-work-paths.ts — Single source of truth for dispatch artifact file paths.
 *
 * All paths are repo-relative strings (no leading `/` or `./`).
 * Pure functions only — no filesystem side effects.
 * No external dependencies — string manipulation only.
 */

// ──── Types ────

/** Roles that appear inside round directories. */
export type RoundRole = "execute" | "implement" | "review" | "verify";

/** Top-level dispatch roles that live at the dispatch root. */
export type TopLevelRole = "research" | "knowledge-scout" | "knowledge-capture";

// ──── Dispatch root ────

/** Root directory for a dispatch: `tmp/dispatch-work/${seedId}` */
export function dispatchRoot(seedId: string): string {
  return `tmp/dispatch-work/${seedId}`;
}

// ──── Round directory ────

/** Round directory: `tmp/dispatch-work/${seedId}/round-${round}` */
export function roundDir(seedId: string, round: number): string {
  return `${dispatchRoot(seedId)}/round-${round}`;
}

// ──── Child run prefix builders ────

/**
 * Build the filename prefix for a child run artifact.
 *
 * Encoding:
 *  - execute              => "execute"
 *  - implement, attempt=N => "implement-aN"
 *  - review, reviewer=R, attempt=A => "review-rR-aA"
 *
 * Verify uses `verifyPrefix` instead.
 */
export function childRunPrefix(
  role: RoundRole,
  opts?: { attempt?: number; reviewer?: number },
): string {
  const attempt = opts?.attempt ?? 1;
  const reviewer = opts?.reviewer;

  switch (role) {
    case "execute":
      return "execute";
    case "implement":
      return `implement-a${attempt}`;
    case "review": {
      const r = reviewer ?? 1;
      return `review-r${r}-a${attempt}`;
    }
    case "verify":
      throw new Error("Use verifyPrefix() for verify role");
  }
}

/** Prefix for verify artifacts: `verify-${instance}` */
export function verifyPrefix(instance: number): string {
  return `verify-${instance}`;
}

// ──── Artifact path builders ────

/** Prompt file: `${dir}/${prefix}-prompt.md` */
export function promptPath(dir: string, prefix: string): string {
  return `${dir}/${prefix}-prompt.md`;
}

/** Log file: `${dir}/${prefix}.log` */
export function logPath(dir: string, prefix: string): string {
  return `${dir}/${prefix}.log`;
}

/** Status file: `${dir}/${prefix}.status` */
export function statusPath(dir: string, prefix: string): string {
  return `${dir}/${prefix}.status`;
}

/** Launch evidence: `${dir}/${prefix}-launch-evidence.json` */
export function launchEvidencePath(dir: string, prefix: string): string {
  return `${dir}/${prefix}-launch-evidence.json`;
}

/**
 * Report file for a given role.
 *
 * Naming differs by role:
 *  - execute              => `${dir}/executor-report.md`
 *  - implement, attempt=N => `${dir}/implement-aN-report.md`
 *  - review, reviewer=R, attempt=A => `${dir}/review-rR-aA.md`
 *  - verify, instance=N   => `${dir}/verify-N.md`
 */
export function reportPath(
  dir: string,
  role: RoundRole,
  opts?: { attempt?: number; reviewer?: number; instance?: number },
): string {
  const attempt = opts?.attempt ?? 1;
  switch (role) {
    case "execute":
      return `${dir}/executor-report.md`;
    case "implement":
      return `${dir}/implement-a${attempt}-report.md`;
    case "review": {
      const r = opts?.reviewer ?? 1;
      return `${dir}/review-r${r}-a${attempt}.md`;
    }
    case "verify": {
      const inst = opts?.instance ?? 1;
      return `${dir}/verify-${inst}.md`;
    }
  }
}

// ──── Convenience: full child run paths as object ────

export type ChildRunPaths = {
  prompt: string;
  log: string;
  status: string;
  launchEvidence: string;
  report: string;
};

/**
 * All 5 artifact paths for a single child run.
 *
 * For verify, pass `instance` in opts.
 * For review, pass `reviewer` (and optionally `attempt`) in opts.
 * For implement, pass `attempt` in opts.
 */
export function childRunPaths(
  dir: string,
  role: RoundRole,
  opts?: { attempt?: number; reviewer?: number; instance?: number },
): ChildRunPaths {
  const prefix =
    role === "verify"
      ? verifyPrefix(opts?.instance ?? 1)
      : childRunPrefix(role, opts);

  return {
    prompt: promptPath(dir, prefix),
    log: logPath(dir, prefix),
    status: statusPath(dir, prefix),
    launchEvidence: launchEvidencePath(dir, prefix),
    report: reportPath(dir, role, opts),
  };
}

// ──── Artifact basenames (for consumers that resolve their own root) ────

/** Canonical basenames for dispatch artifacts, independent of dispatch root path. */
export const BASENAMES = {
  executorReport: "executor-report.md",
  workOrder: "work-order.md",
  packet: "packet.md",
  gate: "gate.md",
  failureCapsule: "failure-capsule.md",
  sourceHints: "source-hints.json",
  toolPreflight: "tool-preflight.md",
  knowledgeScout: "knowledge-scout.md",
  knowledgeCapture: "knowledge-capture.md",
  dispatcherReport: "dispatcher-report.md",
  boundaryDeferred: "boundary-deferred.json",
} as const;

// ──── Top-level dispatch artifacts ────

/** Packet file: `tmp/dispatch-work/${seedId}/packet.md` */
export function packetPath(seedId: string): string {
  return `${dispatchRoot(seedId)}/packet.md`;
}

/** Work order file: `tmp/dispatch-work/${seedId}/work-order.md` */
export function workOrderPath(seedId: string): string {
  return `${dispatchRoot(seedId)}/work-order.md`;
}

/** Gate file: `tmp/dispatch-work/${seedId}/gate.md` */
export function gatePath(seedId: string): string {
  return `${dispatchRoot(seedId)}/gate.md`;
}

/** Source hints: `tmp/dispatch-work/${seedId}/source-hints.json` */
export function sourceHintsPath(seedId: string): string {
  return `${dispatchRoot(seedId)}/source-hints.json`;
}

/** Tool preflight: `tmp/dispatch-work/${seedId}/tool-preflight.md` */
export function toolPreflightPath(seedId: string): string {
  return `${dispatchRoot(seedId)}/tool-preflight.md`;
}

/** Knowledge scout report: `tmp/dispatch-work/${seedId}/knowledge-scout.md` */
export function knowledgeScoutPath(seedId: string): string {
  return `${dispatchRoot(seedId)}/knowledge-scout.md`;
}

/** Knowledge capture report: `tmp/dispatch-work/${seedId}/knowledge-capture.md` */
export function knowledgeCapturePath(seedId: string): string {
  return `${dispatchRoot(seedId)}/knowledge-capture.md`;
}

/** Dispatcher report: `tmp/dispatch-work/${seedId}/dispatcher-report.md` */
export function dispatcherReportPath(seedId: string): string {
  return `${dispatchRoot(seedId)}/dispatcher-report.md`;
}

/** Boundary deferred: `tmp/dispatch-work/${seedId}/boundary-deferred.json` */
export function boundaryDeferredPath(seedId: string): string {
  return `${dispatchRoot(seedId)}/boundary-deferred.json`;
}

/** Failure capsule for a round: `tmp/dispatch-work/${seedId}/round-${round}/failure-capsule.md` */
export function failureCapsulePath(seedId: string, round: number): string {
  return `${roundDir(seedId, round)}/failure-capsule.md`;
}

// ──── Research (top-level child runs) ────

/**
 * Paths for a research child run at the dispatch root.
 * Prefix: `research-${index}`, report: `research-${index}.md`
 */
export function researchPaths(seedId: string, index: number): ChildRunPaths {
  const root = dispatchRoot(seedId);
  const prefix = `research-${index}`;
  return {
    prompt: promptPath(root, prefix),
    log: logPath(root, prefix),
    status: statusPath(root, prefix),
    launchEvidence: launchEvidencePath(root, prefix),
    report: `${root}/${prefix}.md`,
  };
}

/** Paths for the knowledge-scout child run at the dispatch root. */
export function knowledgeScoutPaths(seedId: string): ChildRunPaths {
  const root = dispatchRoot(seedId);
  const prefix = "knowledge-scout";
  return {
    prompt: promptPath(root, prefix),
    log: logPath(root, prefix),
    status: statusPath(root, prefix),
    launchEvidence: launchEvidencePath(root, prefix),
    report: knowledgeScoutPath(seedId),
  };
}

// ──── Terminal events ────

/** Events directory: `tmp/dispatch-work/${seedId}/events` */
export function eventsDir(seedId: string): string {
  return `${dispatchRoot(seedId)}/events`;
}

/**
 * Terminal event file.
 * Seq is zero-padded to 3 digits: `events/001-done.json`, `events/002-escalate.json`
 */
export function terminalEventPath(
  seedId: string,
  seq: number,
  kind: "done" | "escalate",
): string {
  return `${eventsDir(seedId)}/${String(seq).padStart(3, "0")}-${kind}.json`;
}

// ──── Validator predicates ────

/**
 * Returns true if `basename` is a report filename (legacy or new canonical).
 *
 * Legacy patterns:
 *  - executor-report.md, implement-report.md, review-report.md
 *  - review-1.md, review-2.md, verify-*.md
 *
 * New canonical patterns:
 *  - implement-a1-report.md, implement-a2-report.md
 *  - review-r1-a1.md, review-r2-a1.md
 *
 * Excludes filenames containing "prompt" or "artifact-index".
 */
export function isReportFilename(basename: string): boolean {
  if (basename.includes("prompt")) return false;
  if (basename.includes("artifact-index")) return false;
  return (
    // Legacy executor / execute
    /^execut(or|e)-report\.md$/.test(basename) ||
    // Legacy implement-report or new implement-aN-report
    /^implement(-a\d+)?-report\.md$/.test(basename) ||
    // Legacy review-report, review-N, or new review-rN-aN
    /^review(-report|-\d+|-r\d+-a\d+)\.md$/.test(basename) ||
    // verify-N (unchanged across old/new)
    /^verify-.+\.md$/.test(basename)
  );
}

/**
 * Extract the round role from a report basename, or undefined if not a report.
 *
 * Handles both legacy and new canonical names.
 *
 * Note: this does pure prefix matching. It will return a role for non-report
 * files like prompts if they share the prefix. Callers should pre-filter with
 * `isReportFilename` when the input is not already known to be a report.
 */
export function reportRoleFromFilename(basename: string): RoundRole | undefined {
  if (basename.startsWith("executor-") || basename.startsWith("execute-")) return "execute";
  if (basename.startsWith("implement")) return "implement";
  if (basename.startsWith("review")) return "review";
  if (basename.startsWith("verify")) return "verify";
  return undefined;
}

// ──── Self-test ────

if (import.meta.main) {
  let failures = 0;

  function assert(cond: boolean, msg: string): void {
    if (!cond) {
      console.error(`FAIL: ${msg}`);
      failures++;
    }
  }

  function eq(actual: string, expected: string, label: string): void {
    assert(actual === expected, `${label}: got "${actual}", expected "${expected}"`);
  }

  // dispatchRoot / roundDir
  eq(dispatchRoot("seedspec-99f7"), "tmp/dispatch-work/seedspec-99f7", "dispatchRoot");
  eq(roundDir("seedspec-99f7", 1), "tmp/dispatch-work/seedspec-99f7/round-1", "roundDir");

  // childRunPrefix
  eq(childRunPrefix("execute"), "execute", "prefix execute");
  eq(childRunPrefix("implement", { attempt: 1 }), "implement-a1", "prefix implement a1");
  eq(childRunPrefix("implement", { attempt: 2 }), "implement-a2", "prefix implement a2");
  eq(childRunPrefix("review", { reviewer: 1, attempt: 1 }), "review-r1-a1", "prefix review r1 a1");
  eq(childRunPrefix("review", { reviewer: 2, attempt: 1 }), "review-r2-a1", "prefix review r2 a1");

  // verify prefix throws for childRunPrefix
  let threw = false;
  try { childRunPrefix("verify"); } catch { threw = true; }
  assert(threw, "childRunPrefix('verify') should throw");

  // verifyPrefix
  eq(verifyPrefix(1), "verify-1", "verifyPrefix 1");
  eq(verifyPrefix(2), "verify-2", "verifyPrefix 2");

  // Artifact path builders
  const dir = "tmp/dispatch-work/seedspec-99f7/round-1";
  eq(promptPath(dir, "execute"), `${dir}/execute-prompt.md`, "promptPath");
  eq(logPath(dir, "implement-a1"), `${dir}/implement-a1.log`, "logPath");
  eq(statusPath(dir, "review-r1-a1"), `${dir}/review-r1-a1.status`, "statusPath");
  eq(launchEvidencePath(dir, "execute"), `${dir}/execute-launch-evidence.json`, "launchEvidencePath");

  // reportPath
  eq(reportPath(dir, "execute"), `${dir}/executor-report.md`, "reportPath execute");
  eq(reportPath(dir, "implement", { attempt: 1 }), `${dir}/implement-a1-report.md`, "reportPath implement a1");
  eq(reportPath(dir, "implement", { attempt: 2 }), `${dir}/implement-a2-report.md`, "reportPath implement a2");
  eq(reportPath(dir, "review", { reviewer: 1, attempt: 1 }), `${dir}/review-r1-a1.md`, "reportPath review r1 a1");
  eq(reportPath(dir, "review", { reviewer: 2, attempt: 1 }), `${dir}/review-r2-a1.md`, "reportPath review r2 a1");
  eq(reportPath(dir, "verify", { instance: 1 }), `${dir}/verify-1.md`, "reportPath verify 1");

  // childRunPaths
  const execPaths = childRunPaths(dir, "execute");
  eq(execPaths.prompt, `${dir}/execute-prompt.md`, "childRunPaths execute prompt");
  eq(execPaths.log, `${dir}/execute.log`, "childRunPaths execute log");
  eq(execPaths.status, `${dir}/execute.status`, "childRunPaths execute status");
  eq(execPaths.launchEvidence, `${dir}/execute-launch-evidence.json`, "childRunPaths execute launchEvidence");
  eq(execPaths.report, `${dir}/executor-report.md`, "childRunPaths execute report");

  const implPaths = childRunPaths(dir, "implement", { attempt: 2 });
  eq(implPaths.prompt, `${dir}/implement-a2-prompt.md`, "childRunPaths implement a2 prompt");
  eq(implPaths.report, `${dir}/implement-a2-report.md`, "childRunPaths implement a2 report");

  const revPaths = childRunPaths(dir, "review", { reviewer: 2, attempt: 1 });
  eq(revPaths.prompt, `${dir}/review-r2-a1-prompt.md`, "childRunPaths review r2 a1 prompt");
  eq(revPaths.report, `${dir}/review-r2-a1.md`, "childRunPaths review r2 a1 report");

  const verPaths = childRunPaths(dir, "verify", { instance: 2 });
  eq(verPaths.prompt, `${dir}/verify-2-prompt.md`, "childRunPaths verify 2 prompt");
  eq(verPaths.report, `${dir}/verify-2.md`, "childRunPaths verify 2 report");

  // Top-level dispatch artifacts
  const sid = "seedspec-99f7";
  eq(workOrderPath(sid), "tmp/dispatch-work/seedspec-99f7/work-order.md", "workOrderPath");
  eq(packetPath(sid), "tmp/dispatch-work/seedspec-99f7/packet.md", "packetPath");
  eq(gatePath(sid), "tmp/dispatch-work/seedspec-99f7/gate.md", "gatePath");
  eq(sourceHintsPath(sid), "tmp/dispatch-work/seedspec-99f7/source-hints.json", "sourceHintsPath");
  eq(toolPreflightPath(sid), "tmp/dispatch-work/seedspec-99f7/tool-preflight.md", "toolPreflightPath");
  eq(knowledgeScoutPath(sid), "tmp/dispatch-work/seedspec-99f7/knowledge-scout.md", "knowledgeScoutPath");
  eq(knowledgeCapturePath(sid), "tmp/dispatch-work/seedspec-99f7/knowledge-capture.md", "knowledgeCapturePath");
  eq(dispatcherReportPath(sid), "tmp/dispatch-work/seedspec-99f7/dispatcher-report.md", "dispatcherReportPath");
  eq(boundaryDeferredPath(sid), "tmp/dispatch-work/seedspec-99f7/boundary-deferred.json", "boundaryDeferredPath");
  eq(failureCapsulePath(sid, 2), "tmp/dispatch-work/seedspec-99f7/round-2/failure-capsule.md", "failureCapsulePath");

  // Research paths
  const rp = researchPaths(sid, 1);
  eq(rp.prompt, "tmp/dispatch-work/seedspec-99f7/research-1-prompt.md", "researchPaths prompt");
  eq(rp.report, "tmp/dispatch-work/seedspec-99f7/research-1.md", "researchPaths report");
  eq(rp.log, "tmp/dispatch-work/seedspec-99f7/research-1.log", "researchPaths log");

  // Knowledge scout paths
  const ksp = knowledgeScoutPaths(sid);
  eq(ksp.prompt, "tmp/dispatch-work/seedspec-99f7/knowledge-scout-prompt.md", "knowledgeScoutPaths prompt");
  eq(ksp.report, "tmp/dispatch-work/seedspec-99f7/knowledge-scout.md", "knowledgeScoutPaths report");

  // Terminal events
  eq(eventsDir(sid), "tmp/dispatch-work/seedspec-99f7/events", "eventsDir");
  eq(terminalEventPath(sid, 1, "done"), "tmp/dispatch-work/seedspec-99f7/events/001-done.json", "terminalEvent done");
  eq(terminalEventPath(sid, 12, "escalate"), "tmp/dispatch-work/seedspec-99f7/events/012-escalate.json", "terminalEvent escalate");

  // isReportFilename — new canonical
  assert(isReportFilename("executor-report.md"), "isReport executor-report.md");
  assert(isReportFilename("implement-a1-report.md"), "isReport implement-a1-report.md");
  assert(isReportFilename("implement-a2-report.md"), "isReport implement-a2-report.md");
  assert(isReportFilename("review-r1-a1.md"), "isReport review-r1-a1.md");
  assert(isReportFilename("review-r2-a1.md"), "isReport review-r2-a1.md");
  assert(isReportFilename("verify-1.md"), "isReport verify-1.md");
  assert(isReportFilename("verify-2.md"), "isReport verify-2.md");

  // isReportFilename — legacy
  assert(isReportFilename("implement-report.md"), "isReport legacy implement-report.md");
  assert(isReportFilename("review-report.md"), "isReport legacy review-report.md");
  assert(isReportFilename("review-1.md"), "isReport legacy review-1.md");
  assert(isReportFilename("review-2.md"), "isReport legacy review-2.md");
  assert(isReportFilename("execute-report.md"), "isReport legacy execute-report.md");

  // isReportFilename — exclusions
  assert(!isReportFilename("execute-prompt.md"), "!isReport execute-prompt.md");
  assert(!isReportFilename("implement-a1-prompt.md"), "!isReport implement-a1-prompt.md");
  assert(!isReportFilename("artifact-index.md"), "!isReport artifact-index.md");
  assert(!isReportFilename("random-file.md"), "!isReport random-file.md");

  // reportRoleFromFilename
  eq(reportRoleFromFilename("executor-report.md") ?? "", "execute", "role executor-report");
  eq(reportRoleFromFilename("execute-report.md") ?? "", "execute", "role execute-report");
  eq(reportRoleFromFilename("implement-report.md") ?? "", "implement", "role implement-report");
  eq(reportRoleFromFilename("implement-a1-report.md") ?? "", "implement", "role implement-a1-report");
  eq(reportRoleFromFilename("review-report.md") ?? "", "review", "role review-report");
  eq(reportRoleFromFilename("review-1.md") ?? "", "review", "role review-1");
  eq(reportRoleFromFilename("review-r1-a1.md") ?? "", "review", "role review-r1-a1");
  eq(reportRoleFromFilename("verify-1.md") ?? "", "verify", "role verify-1");
  assert(reportRoleFromFilename("random.md") === undefined, "role undefined for random.md");

  if (failures === 0) {
    console.log("All self-tests passed.");
  } else {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  }
}
