import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, validateDispatch, writeJson } from "./validate-dispatch-work.ts";
import { compactPromptFixture, initGitRepo, legacyPromptFixture, makeFixtureRound, mutateLaunchEvidence, promptFixture, writeSeedIssue } from "./validate-dispatch-work-fixtures.ts";
import { snapshotFromStatus } from "../../seedstack/scripts/snapshot-dirty-state.ts";

export function runSelfTest(pretty: boolean): number {
  const root = mkdtempSync(join(tmpdir(), "dispatch-validate-"));
  try {
    const repo = join(root, "repo");
    const seed = "seedspec-test";
    const roundPath = join(repo, "tmp/dispatch-work", seed, "round-1");
    makeFixtureRound(repo, seed, roundPath, "pass", "close", true);
    const valid = validateDispatch({ ...parseArgs([]), repo, seed });

    const missingKnowledgeRepo = join(root, "missing-knowledge-repo");
    makeFixtureRound(missingKnowledgeRepo, seed, join(missingKnowledgeRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    rmSync(join(missingKnowledgeRepo, "tmp/dispatch-work", seed, "knowledge-capture.md"), { force: true });
    const missingKnowledge = validateDispatch({ ...parseArgs([]), repo: missingKnowledgeRepo, seed });

    const shallowKnowledgeRepo = join(root, "shallow-knowledge-repo");
    makeFixtureRound(shallowKnowledgeRepo, seed, join(shallowKnowledgeRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeFileSync(join(shallowKnowledgeRepo, "tmp/dispatch-work", seed, "knowledge-capture.md"), "capture_state=none_qualified\naccepted IDs: []\n");
    const shallowKnowledge = validateDispatch({ ...parseArgs([]), repo: shallowKnowledgeRepo, seed });

    const recordedProseRepo = join(root, "recorded-prose-repo");
    makeFixtureRound(recordedProseRepo, seed, join(recordedProseRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeFileSync(join(recordedProseRepo, "tmp/dispatch-work", seed, "knowledge-capture.md"), "capture_state=recorded\nAccepted records: wrote one down in prose.\n");
    const recordedProse = validateDispatch({ ...parseArgs([]), repo: recordedProseRepo, seed });

    const recordedIdsRepo = join(root, "recorded-ids-repo");
    makeFixtureRound(recordedIdsRepo, seed, join(recordedIdsRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeFileSync(join(recordedIdsRepo, "tmp/dispatch-work", seed, "knowledge-capture.md"), "capture_state=recorded\naccepted IDs: [ex-1a2b3c]\n");
    const recordedIds = validateDispatch({ ...parseArgs([]), repo: recordedIdsRepo, seed });

    const recordedJsonRepo = join(root, "recorded-json-repo");
    makeFixtureRound(recordedJsonRepo, seed, join(recordedJsonRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeFileSync(
      join(recordedJsonRepo, "tmp/dispatch-work", seed, "knowledge-capture.md"),
      [
        "capture_state=recorded",
        "accepted_records:",
        "```json",
        JSON.stringify({ accepted_records: [{ type: "reference", content: "Fixture source for capture validator." }] }),
        "```",
        "",
      ].join("\n"),
    );
    const recordedJson = validateDispatch({ ...parseArgs([]), repo: recordedJsonRepo, seed });

    const missingSummaryRepo = join(root, "missing-summary-repo");
    makeFixtureRound(missingSummaryRepo, seed, join(missingSummaryRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeFileSync(join(missingSummaryRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-report.md"), "# Implement Report\n\nOutcome: done\n\nRecommendation: close\n");
    const missingSummary = validateDispatch({ ...parseArgs([]), repo: missingSummaryRepo, seed });
    const missingSummaryLoop = validateDispatch({ ...parseArgs([]), repo: missingSummaryRepo, seed, validationPolicy: "loop" });

    const summaryKeysWithoutHeadingRepo = join(root, "summary-keys-without-heading-repo");
    makeFixtureRound(summaryKeysWithoutHeadingRepo, seed, join(summaryKeysWithoutHeadingRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeFileSync(
      join(summaryKeysWithoutHeadingRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-report.md"),
      [
        "# Implement Report",
        "",
        "status: done",
        "changed_files: src/fixture.ts",
        "tests: not run",
        "blockers: none",
        "next_action: close",
        "",
        "Outcome: done",
        "",
        "Recommendation: close",
        "",
      ].join("\n"),
    );
    const summaryKeysWithoutHeading = validateDispatch({ ...parseArgs([]), repo: summaryKeysWithoutHeadingRepo, seed });

    const missingSummaryKeyRepo = join(root, "missing-summary-key-repo");
    makeFixtureRound(missingSummaryKeyRepo, seed, join(missingSummaryKeyRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    const missingSummaryKeyPath = join(missingSummaryKeyRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-report.md");
    writeFileSync(
      missingSummaryKeyPath,
      readFileSync(missingSummaryKeyPath, "utf8").replace(/^tests: .*\n/m, ""),
    );
    const missingSummaryKey = validateDispatch({ ...parseArgs([]), repo: missingSummaryKeyRepo, seed });
    const missingSummaryKeyLoop = validateDispatch({ ...parseArgs([]), repo: missingSummaryKeyRepo, seed, validationPolicy: "loop" });

    const invalidSummaryOrderRepo = join(root, "invalid-summary-order-repo");
    makeFixtureRound(invalidSummaryOrderRepo, seed, join(invalidSummaryOrderRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    const invalidSummaryOrderPath = join(invalidSummaryOrderRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-report.md");
    writeFileSync(
      invalidSummaryOrderPath,
      readFileSync(invalidSummaryOrderPath, "utf8").replace(
        "status: done\nchanged_files: src/fixture.ts",
        "changed_files: src/fixture.ts\nstatus: done",
      ),
    );
    const invalidSummaryOrder = validateDispatch({ ...parseArgs([]), repo: invalidSummaryOrderRepo, seed });

    const invalidSummaryValueRepo = join(root, "invalid-summary-value-repo");
    makeFixtureRound(invalidSummaryValueRepo, seed, join(invalidSummaryValueRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    const invalidSummaryValuePath = join(invalidSummaryValueRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-report.md");
    writeFileSync(
      invalidSummaryValuePath,
      readFileSync(invalidSummaryValuePath, "utf8").replace("next_action: close", "next_action: ship-it"),
    );
    const invalidSummaryValue = validateDispatch({ ...parseArgs([]), repo: invalidSummaryValueRepo, seed });

    const badExecuteRepo = join(root, "bad-execute-repo");
    makeFixtureRound(badExecuteRepo, seed, join(badExecuteRepo, "tmp/dispatch-work", seed, "round-1"), "block", "close", true);
    const badExecute = validateDispatch({ ...parseArgs([]), repo: badExecuteRepo, seed });

    const v1Repo = join(root, "v1-repo");
    makeFixtureRound(v1Repo, seed, join(v1Repo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true, "child_run_status.v1");
    const v1 = validateDispatch({ ...parseArgs([]), repo: v1Repo, seed });

    const dirtyRepo = join(root, "dirty-repo");
    makeFixtureRound(dirtyRepo, seed, join(dirtyRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true, "child_run_status.v2", {
      role: "review",
      state: "failed_exit",
      exitCode: "1",
      failureCapsule: false,
    });
    const dirty = validateDispatch({ ...parseArgs([]), repo: dirtyRepo, seed });

    const noEvidenceRepo = join(root, "no-evidence-repo");
    makeFixtureRound(noEvidenceRepo, seed, join(noEvidenceRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true, "child_run_status.v2", undefined, "review-r1-a1.md", false);
    const noEvidence = validateDispatch({ ...parseArgs([]), repo: noEvidenceRepo, seed });

    const evidenceThenGateChecksRepo = join(root, "evidence-then-gate-checks-repo");
    const evidenceThenGateChecksRound = join(evidenceThenGateChecksRepo, "tmp/dispatch-work", seed, "round-1");
    makeFixtureRound(evidenceThenGateChecksRepo, seed, evidenceThenGateChecksRound, "pass", "close", true);
    writeFileSync(
      join(evidenceThenGateChecksRepo, "tmp/dispatch-work", seed, "gate.md"),
      [
        `# Gate: ${seed}`,
        "",
        "decision: close",
        "",
        "## Evidence Paths",
        "",
        "| path | outcome |",
        "| --- | --- |",
        `| tmp/dispatch-work/${seed}/round-1/executor-report.md | pass |`,
        `| tmp/dispatch-work/${seed}/round-1/implement-a1-report.md | done |`,
        `| tmp/dispatch-work/${seed}/round-1/review-r1-a1.md | pass |`,
        `| tmp/dispatch-work/${seed}/round-1/verify-1.md | pass |`,
        "",
        "## Gate Checks",
        "",
        "| command | cwd | exit_code | result | required | live | waiver |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| bun skills/dispatch-work/scripts/validate-dispatch-work.ts --self-test | . | 0 | pass | yes | no | none |",
        "",
        "## Dirty Guard",
        "",
        "Known dirty paths: none.",
      ].join("\n"),
    );
    const evidenceThenGateChecks = validateDispatch({ ...parseArgs([]), repo: evidenceThenGateChecksRepo, seed });

    const nonEvidenceTableRepo = join(root, "non-evidence-table-repo");
    makeFixtureRound(nonEvidenceTableRepo, seed, join(nonEvidenceTableRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeFileSync(
      join(nonEvidenceTableRepo, "tmp/dispatch-work", seed, "gate.md"),
      [
        `# Gate: ${seed}`,
        "",
        "decision: close",
        "",
        "## Evidence Paths",
        "| path | outcome |",
        "| --- | --- |",
        `| tmp/dispatch-work/${seed}/round-1/executor-report.md | pass |`,
        `| tmp/dispatch-work/${seed}/round-1/implement-a1-report.md | done |`,
        `| tmp/dispatch-work/${seed}/round-1/review-r1-a1.md | pass |`,
        `| tmp/dispatch-work/${seed}/round-1/verify-1.md | pass |`,
        "",
        "## Non-Evidence Paths",
        "| path | outcome |",
        "| --- | --- |",
        "| cd spec/conformance/runner && bun test | pass |",
        "",
        "## Gate Results",
        "| command | cwd | exit_code | result | required | live | waiver |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| bun test | . | 0 | pass | yes | no | none |",
        "",
      ].join("\n"),
    );
    const nonEvidenceTable = validateDispatch({ ...parseArgs([]), repo: nonEvidenceTableRepo, seed });

    const evidenceAliasRepo = join(root, "evidence-alias-repo");
    makeFixtureRound(evidenceAliasRepo, seed, join(evidenceAliasRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    mkdirSync(join(evidenceAliasRepo, "spec/conformance/runner"), { recursive: true });
    writeFileSync(
      join(evidenceAliasRepo, "tmp/dispatch-work", seed, "gate.md"),
      [
        `# Gate: ${seed}`,
        "",
        "decision: close",
        "",
        "## Evidence",
        "| artifact path | outcome |",
        "| --- | --- |",
        `| tmp/dispatch-work/${seed}/round-1/executor-report.md | pass |`,
        `| tmp/dispatch-work/${seed}/round-1/implement-a1-report.md | done |`,
        "",
        "## Gate Results",
        "| command | cwd | exit_code | result | required | live | waiver |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| bun test | spec/conformance/runner | 0 | pass | yes | no | none |",
        "",
      ].join("\n"),
    );
    const evidenceAlias = validateDispatch({ ...parseArgs([]), repo: evidenceAliasRepo, seed });

    const placeholderCwdRepo = join(root, "placeholder-cwd-repo");
    makeFixtureRound(placeholderCwdRepo, seed, join(placeholderCwdRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    const placeholderGatePath = join(placeholderCwdRepo, "tmp/dispatch-work", seed, "gate.md");
    writeFileSync(
      placeholderGatePath,
      readFileSync(placeholderGatePath, "utf8").replace(
        "| bun skills/dispatch-work/scripts/validate-dispatch-work.ts --self-test | . | 0 | pass | yes | no | none |",
        "| bun skills/dispatch-work/scripts/validate-dispatch-work.ts --self-test | <cwd> | 0 | pass | yes | no | none |",
      ),
    );
    const placeholderCwd = validateDispatch({ ...parseArgs([]), repo: placeholderCwdRepo, seed });

    const nonexistentCwdRepo = join(root, "nonexistent-cwd-repo");
    makeFixtureRound(nonexistentCwdRepo, seed, join(nonexistentCwdRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    const nonexistentGatePath = join(nonexistentCwdRepo, "tmp/dispatch-work", seed, "gate.md");
    writeFileSync(
      nonexistentGatePath,
      readFileSync(nonexistentGatePath, "utf8").replace(
        "| bun skills/dispatch-work/scripts/validate-dispatch-work.ts --self-test | . | 0 | pass | yes | no | none |",
        "| bun skills/dispatch-work/scripts/validate-dispatch-work.ts --self-test | missing/subdir | 0 | pass | yes | no | none |",
      ),
    );
    const nonexistentCwd = validateDispatch({ ...parseArgs([]), repo: nonexistentCwdRepo, seed });

    const markerOnlyGateRepo = join(root, "marker-only-gate-repo");
    makeFixtureRound(markerOnlyGateRepo, seed, join(markerOnlyGateRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeFileSync(
      join(markerOnlyGateRepo, "tmp/dispatch-work", seed, "gate.md"),
      readFileSync(join(markerOnlyGateRepo, "tmp/dispatch-work", seed, "gate.md"), "utf8").replace(
        "| bun skills/dispatch-work/scripts/validate-dispatch-work.ts --self-test | . | 0 | pass | yes | no | none |",
        "| pass | . | 0 | pass | yes | no | none |",
      ),
    );
    const markerOnlyGate = validateDispatch({ ...parseArgs([]), repo: markerOnlyGateRepo, seed });

    const skippedLiveGateRepo = join(root, "skipped-live-gate-repo");
    makeFixtureRound(skippedLiveGateRepo, seed, join(skippedLiveGateRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeFileSync(
      join(skippedLiveGateRepo, "tmp/dispatch-work", seed, "gate.md"),
      readFileSync(join(skippedLiveGateRepo, "tmp/dispatch-work", seed, "gate.md"), "utf8").replace(
        "| bun skills/dispatch-work/scripts/validate-dispatch-work.ts --self-test | . | 0 | pass | yes | no | none |",
        "| ./scripts/smoke-release --live | . | 0 | skipped | yes | yes | none |",
      ),
    );
    const skippedLiveGate = validateDispatch({ ...parseArgs([]), repo: skippedLiveGateRepo, seed });

    const failedRequiredGateRepo = join(root, "failed-required-gate-repo");
    makeFixtureRound(failedRequiredGateRepo, seed, join(failedRequiredGateRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeFileSync(
      join(failedRequiredGateRepo, "tmp/dispatch-work", seed, "gate.md"),
      readFileSync(join(failedRequiredGateRepo, "tmp/dispatch-work", seed, "gate.md"), "utf8").replace(
        "| bun skills/dispatch-work/scripts/validate-dispatch-work.ts --self-test | . | 0 | pass | yes | no | none |",
        "| bun test | . | 1 | fail | yes | no | none |",
      ),
    );
    const failedRequiredGate = validateDispatch({ ...parseArgs([]), repo: failedRequiredGateRepo, seed });

    const numberedReviewRepo = join(root, "numbered-review-repo");
    makeFixtureRound(numberedReviewRepo, seed, join(numberedReviewRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true, "child_run_status.v2", undefined, "review-1.md");
    const numberedReview = validateDispatch({ ...parseArgs([]), repo: numberedReviewRepo, seed });

    const staleRepo = join(root, "stale-repo");
    makeFixtureRound(staleRepo, seed, join(staleRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    const oldDate = new Date("2025-01-01T00:00:00Z");
    utimesSync(join(staleRepo, "tmp/dispatch-work", seed, "round-1/executor-report.md"), oldDate, oldDate);
    const stale = validateDispatch({ ...parseArgs([]), repo: staleRepo, seed });
    const staleLoop = validateDispatch({ ...parseArgs([]), repo: staleRepo, seed, validationPolicy: "loop" });

    const weakLivenessRepo = join(root, "weak-liveness-repo");
    makeFixtureRound(weakLivenessRepo, seed, join(weakLivenessRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true, "child_run_status.v2", undefined, "review-r1-a1.md", true, "pid:1");
    const weakLiveness = validateDispatch({ ...parseArgs([]), repo: weakLivenessRepo, seed });
    const weakLivenessLoop = validateDispatch({ ...parseArgs([]), repo: weakLivenessRepo, seed, validationPolicy: "loop" });

    const mismatchedLauncherRepo = join(root, "mismatched-launcher-repo");
    makeFixtureRound(mismatchedLauncherRepo, seed, join(mismatchedLauncherRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true, "child_run_status.v2", undefined, "review-r1-a1.md", true, "pid:2");
    const mismatchedLauncher = validateDispatch({ ...parseArgs([]), repo: mismatchedLauncherRepo, seed });

    const fakeSpawnRepo = join(root, "fake-spawn-repo");
    makeFixtureRound(fakeSpawnRepo, seed, join(fakeSpawnRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true, "child_run_status.v2", undefined, "review-r1-a1.md", true, "spawn_agent:fake");
    const fakeSpawn = validateDispatch({ ...parseArgs([]), repo: fakeSpawnRepo, seed });

    const roleNameSpawnRepo = join(root, "role-name-spawn-repo");
    makeFixtureRound(roleNameSpawnRepo, seed, join(roleNameSpawnRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true, "child_run_status.v2", undefined, "review-r1-a1.md", true, "spawn_agent:review-code");
    const roleNameSpawn = validateDispatch({ ...parseArgs([]), repo: roleNameSpawnRepo, seed });

    const sessionCurrentRepo = join(root, "session-current-repo");
    makeFixtureRound(sessionCurrentRepo, seed, join(sessionCurrentRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true, "child_run_status.v2", undefined, "review-r1-a1.md", true, "session:codex-current");
    const sessionCurrent = validateDispatch({ ...parseArgs([]), repo: sessionCurrentRepo, seed });

    const missingLaunchEvidenceRepo = join(root, "missing-launch-evidence-repo");
    makeFixtureRound(missingLaunchEvidenceRepo, seed, join(missingLaunchEvidenceRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true, "child_run_status.v2", undefined, "review-r1-a1.md", true, "spawn_agent:fixture", false);
    const missingLaunchEvidence = validateDispatch({ ...parseArgs([]), repo: missingLaunchEvidenceRepo, seed });

    const missingEvidenceContractRepo = join(root, "missing-evidence-contract-repo");
    makeFixtureRound(missingEvidenceContractRepo, seed, join(missingEvidenceContractRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    mutateLaunchEvidence(missingEvidenceContractRepo, seed, "implement", (evidence) => delete evidence.contract);
    const missingEvidenceContract = validateDispatch({ ...parseArgs([]), repo: missingEvidenceContractRepo, seed });

    const missingEvidenceOwnerRepo = join(root, "missing-evidence-owner-repo");
    makeFixtureRound(missingEvidenceOwnerRepo, seed, join(missingEvidenceOwnerRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    mutateLaunchEvidence(missingEvidenceOwnerRepo, seed, "implement", (evidence) => delete evidence.status_writer);
    const missingEvidenceOwner = validateDispatch({ ...parseArgs([]), repo: missingEvidenceOwnerRepo, seed });

    const supervisorNoEvidenceRepo = join(root, "supervisor-no-evidence-repo");
    makeFixtureRound(supervisorNoEvidenceRepo, seed, join(supervisorNoEvidenceRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true, "child_run_status.v2", undefined, "review-r1-a1.md", true, "supervisor:run-1", false, "supervisor");
    const supervisorNoEvidence = validateDispatch({ ...parseArgs([]), repo: supervisorNoEvidenceRepo, seed });

    const badAttemptRepo = join(root, "bad-attempt-repo");
    makeFixtureRound(badAttemptRepo, seed, join(badAttemptRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeFileSync(join(badAttemptRepo, "tmp/dispatch-work", seed, "round-1/implement-a1.status"), readFileSync(join(badAttemptRepo, "tmp/dispatch-work", seed, "round-1/implement-a1.status"), "utf8").replace("attempt=1", "attempt=0"));
    const badAttempt = validateDispatch({ ...parseArgs([]), repo: badAttemptRepo, seed });

    const placeholderRepo = join(root, "placeholder-repo");
    makeFixtureRound(placeholderRepo, seed, join(placeholderRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true, "child_run_status.v2", undefined, "review-r1-a1.md", true, "spawn_agent:fixture");
    writeFileSync(join(placeholderRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md"), "placeholder\n");
    const placeholder = validateDispatch({ ...parseArgs([]), repo: placeholderRepo, seed });

    const promptMismatchRepo = join(root, "prompt-mismatch-repo");
    makeFixtureRound(promptMismatchRepo, seed, join(promptMismatchRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeFileSync(join(promptMismatchRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md"), promptFixture(seed, "implement", "implement-a1-prompt.md", "implement-a1.log", "implement-a1.status", "wrong-report.md"));
    const promptMismatch = validateDispatch({ ...parseArgs([]), repo: promptMismatchRepo, seed });

    const promptLaunchMissingRepo = join(root, "prompt-launch-missing-repo");
    makeFixtureRound(promptLaunchMissingRepo, seed, join(promptLaunchMissingRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    const promptLaunchMissingPath = join(promptLaunchMissingRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md");
    writeFileSync(
      promptLaunchMissingPath,
      readFileSync(promptLaunchMissingPath, "utf8")
        .replace(/\slaunch_evidence_path="[^"]+"/, "")
        .replace(/^<launch_provenance\b.*\n/m, ""),
    );
    const promptLaunchMissing = validateDispatch({ ...parseArgs([]), repo: promptLaunchMissingRepo, seed });

    const promptIoMissingAttrRepo = join(root, "prompt-io-missing-attr-repo");
    makeFixtureRound(promptIoMissingAttrRepo, seed, join(promptIoMissingAttrRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    const promptIoMissingAttrPath = join(promptIoMissingAttrRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md");
    writeFileSync(
      promptIoMissingAttrPath,
      readFileSync(promptIoMissingAttrPath, "utf8").replace(/\sstatus_path="[^"]+"/, ""),
    );
    const promptIoMissingAttr = validateDispatch({ ...parseArgs([]), repo: promptIoMissingAttrRepo, seed });

    const promptIoNoPollingWrongRepo = join(root, "prompt-io-no-polling-wrong-repo");
    makeFixtureRound(promptIoNoPollingWrongRepo, seed, join(promptIoNoPollingWrongRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    const promptIoNoPollingWrongPath = join(promptIoNoPollingWrongRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md");
    writeFileSync(
      promptIoNoPollingWrongPath,
      readFileSync(promptIoNoPollingWrongPath, "utf8").replace('no_parent_transcript_polling="true"', 'no_parent_transcript_polling="false"'),
    );
    const promptIoNoPollingWrong = validateDispatch({ ...parseArgs([]), repo: promptIoNoPollingWrongRepo, seed });

    const promptIoNoPollingMissingRepo = join(root, "prompt-io-no-polling-missing-repo");
    makeFixtureRound(promptIoNoPollingMissingRepo, seed, join(promptIoNoPollingMissingRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    const promptIoNoPollingMissingPath = join(promptIoNoPollingMissingRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md");
    writeFileSync(
      promptIoNoPollingMissingPath,
      readFileSync(promptIoNoPollingMissingPath, "utf8").replace(/\sno_parent_transcript_polling="true"/, ""),
    );
    const promptIoNoPollingMissing = validateDispatch({ ...parseArgs([]), repo: promptIoNoPollingMissingRepo, seed });

    const promptLaunchProvenanceAttrMissingRepo = join(root, "prompt-launch-provenance-attr-missing-repo");
    makeFixtureRound(promptLaunchProvenanceAttrMissingRepo, seed, join(promptLaunchProvenanceAttrMissingRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    const promptLaunchProvenanceAttrMissingPath = join(promptLaunchProvenanceAttrMissingRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md");
    writeFileSync(
      promptLaunchProvenanceAttrMissingPath,
      readFileSync(promptLaunchProvenanceAttrMissingPath, "utf8").replace(/(<launch_provenance\b[^>]*?)\slaunch_evidence_path="[^"]+"/, "$1"),
    );
    const promptLaunchProvenanceAttrMissing = validateDispatch({ ...parseArgs([]), repo: promptLaunchProvenanceAttrMissingRepo, seed });

    const promptPreserveMissingRepo = join(root, "prompt-preserve-missing-repo");
    makeFixtureRound(promptPreserveMissingRepo, seed, join(promptPreserveMissingRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    const promptPreserveMissingPath = join(promptPreserveMissingRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md");
    writeFileSync(
      promptPreserveMissingPath,
      readFileSync(promptPreserveMissingPath, "utf8").replace(/^<preserve_dirty_paths\b.*\n/m, ""),
    );
    const promptPreserveMissing = validateDispatch({ ...parseArgs([]), repo: promptPreserveMissingRepo, seed });

    const promptPreserveWrongRepo = join(root, "prompt-preserve-wrong-repo");
    makeFixtureRound(promptPreserveWrongRepo, seed, join(promptPreserveWrongRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    const promptPreserveWrongPath = join(promptPreserveWrongRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md");
    writeFileSync(
      promptPreserveWrongPath,
      readFileSync(promptPreserveWrongPath, "utf8").replace('dispatcher_owned_seed_state="cli_only"', 'dispatcher_owned_seed_state="direct_edit"'),
    );
    const promptPreserveWrong = validateDispatch({ ...parseArgs([]), repo: promptPreserveWrongRepo, seed });

    const legacyPromptRepo = join(root, "legacy-prompt-repo");
    makeFixtureRound(legacyPromptRepo, seed, join(legacyPromptRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeFileSync(
      join(legacyPromptRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md"),
      legacyPromptFixture(seed, "implement", "implement-a1-prompt.md", "implement-a1.log", "implement-a1.status", "implement-a1-report.md"),
    );
    const legacyPrompt = validateDispatch({ ...parseArgs([]), repo: legacyPromptRepo, seed });

    const thinLegacyPromptRepo = join(root, "thin-legacy-prompt-repo");
    makeFixtureRound(thinLegacyPromptRepo, seed, join(thinLegacyPromptRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeFileSync(
      join(thinLegacyPromptRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md"),
      compactPromptFixture(seed, "implement", "implement-a1-prompt.md", "implement-a1.log", "implement-a1.status", "implement-a1-report.md")
        .replace(/^<child_artifact_contract\b.*\n/m, "Child artifact contract:\n- Final child reply: report path and outcome.\n"),
    );
    const thinLegacyPrompt = validateDispatch({ ...parseArgs([]), repo: thinLegacyPromptRepo, seed });

    const compactPromptRepo = join(root, "compact-prompt-repo");
    makeFixtureRound(compactPromptRepo, seed, join(compactPromptRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeFileSync(
      join(compactPromptRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md"),
      compactPromptFixture(seed, "implement", "implement-a1-prompt.md", "implement-a1.log", "implement-a1.status", "implement-a1-report.md"),
    );
    const compactPrompt = validateDispatch({ ...parseArgs([]), repo: compactPromptRepo, seed });

    const compactPromptBadAttrsRepo = join(root, "compact-prompt-bad-attrs-repo");
    makeFixtureRound(compactPromptBadAttrsRepo, seed, join(compactPromptBadAttrsRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeFileSync(
      join(compactPromptBadAttrsRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md"),
      compactPromptFixture(seed, "implement", "implement-a1-prompt.md", "implement-a1.log", "implement-a1.status", "implement-a1-report.md")
        .replace(' child_writes="report_only"', ""),
    );
    const compactPromptBadAttrs = validateDispatch({ ...parseArgs([]), repo: compactPromptBadAttrsRepo, seed });
    const compactPromptBadAttrsLoop = validateDispatch({ ...parseArgs([]), repo: compactPromptBadAttrsRepo, seed, validationPolicy: "loop" });

    const compactPromptBadRefRepo = join(root, "compact-prompt-bad-ref-repo");
    makeFixtureRound(compactPromptBadRefRepo, seed, join(compactPromptBadRefRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeFileSync(
      join(compactPromptBadRefRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md"),
      compactPromptFixture(seed, "implement", "implement-a1-prompt.md", "implement-a1.log", "implement-a1.status", "implement-a1-report.md")
        .replace('ref="dispatch-child-artifact.v2"', 'ref="dispatch-child-artifact.v1"'),
    );
    const compactPromptBadRef = validateDispatch({ ...parseArgs([]), repo: compactPromptBadRefRepo, seed });

    const compactPromptReportMismatchRepo = join(root, "compact-prompt-report-mismatch-repo");
    makeFixtureRound(compactPromptReportMismatchRepo, seed, join(compactPromptReportMismatchRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeFileSync(
      join(compactPromptReportMismatchRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md"),
      compactPromptFixture(seed, "implement", "implement-a1-prompt.md", "implement-a1.log", "implement-a1.status", "implement-a1-report.md")
        .replace(/(<child_artifact_contract\b[^>]*\breport_path=")[^"]+/, `$1tmp/dispatch-work/${seed}/round-1/wrong-report.md`),
    );
    const compactPromptReportMismatch = validateDispatch({ ...parseArgs([]), repo: compactPromptReportMismatchRepo, seed });

    const wrongAreaRepo = join(root, "wrong-area-repo");
    makeFixtureRound(wrongAreaRepo, seed, join(wrongAreaRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeSeedIssue(wrongAreaRepo, seed, "custom/root");
    writeFileSync(
      join(wrongAreaRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md"),
      promptFixture(seed, "implement", "implement-a1-prompt.md", "implement-a1.log", "implement-a1.status", "implement-a1-report.md")
        .replace(/repo_edit_roots="[^"]*"/g, 'repo_edit_roots="impl/rust"'),
    );
    const wrongArea = validateDispatch({ ...parseArgs([]), repo: wrongAreaRepo, seed });

    const arbitraryAreaRepo = join(root, "arbitrary-area-repo");
    makeFixtureRound(arbitraryAreaRepo, seed, join(arbitraryAreaRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeSeedIssue(arbitraryAreaRepo, seed, "packages/api");
    writeFileSync(
      join(arbitraryAreaRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md"),
      `${promptFixture(seed, "implement", "implement-a1-prompt.md", "implement-a1.log", "implement-a1.status", "implement-a1-report.md")}\n<preserve_dirty_paths repo_edit_roots="packages/web" artifact_write_roots="tmp/dispatch-work/${seed}/round-1/" />\n`,
    );
    const arbitraryArea = validateDispatch({ ...parseArgs([]), repo: arbitraryAreaRepo, seed });

    const artifactRootsIgnoredRepo = join(root, "artifact-roots-ignored-repo");
    makeFixtureRound(artifactRootsIgnoredRepo, seed, join(artifactRootsIgnoredRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeSeedIssue(artifactRootsIgnoredRepo, seed, "packages/api");
    writeFileSync(
      join(artifactRootsIgnoredRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md"),
      `${promptFixture(seed, "implement", "implement-a1-prompt.md", "implement-a1.log", "implement-a1.status", "implement-a1-report.md")}\n<preserve_dirty_paths repo_edit_roots="" artifact_write_roots="tmp/dispatch-work/${seed}/round-1/ tmp/seedstack/run-1/" />\n`,
    );
    const artifactRootsIgnored = validateDispatch({ ...parseArgs([]), repo: artifactRootsIgnoredRepo, seed });

    const legacyAllowedRootsRepo = join(root, "legacy-allowed-roots-repo");
    makeFixtureRound(legacyAllowedRootsRepo, seed, join(legacyAllowedRootsRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeSeedIssue(legacyAllowedRootsRepo, seed, "packages/web");
    writeFileSync(
      join(legacyAllowedRootsRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md"),
      legacyPromptFixture(seed, "implement", "implement-a1-prompt.md", "implement-a1.log", "implement-a1.status", "implement-a1-report.md")
        + `\n<preserve_dirty_paths allowed_write_roots="packages/web tmp/dispatch-work/${seed}/round-1/" />\n`,
    );
    const legacyAllowedRoots = validateDispatch({ ...parseArgs([]), repo: legacyAllowedRootsRepo, seed });

    const topLevelAreaRepo = join(root, "top-level-area-repo");
    makeFixtureRound(topLevelAreaRepo, seed, join(topLevelAreaRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeSeedIssue(topLevelAreaRepo, seed, "services/api");
    writeFileSync(join(topLevelAreaRepo, "tmp/dispatch-work", seed, "research-1.md"), "Likely files: impl/rust/src/main.rs\n");
    const topLevelArea = validateDispatch({ ...parseArgs([]), repo: topLevelAreaRepo, seed });

    const quotedAreaRepo = join(root, "quoted-area-repo");
    makeFixtureRound(quotedAreaRepo, seed, join(quotedAreaRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeSeedIssue(quotedAreaRepo, seed, "`impl_v2/rust`");
    writeFileSync(
      join(quotedAreaRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md"),
      `${promptFixture(seed, "implement", "implement-a1-prompt.md", "implement-a1.log", "implement-a1.status", "implement-a1-report.md")}\n<preserve_dirty_paths repo_edit_roots="impl_v2/rust" artifact_write_roots="tmp/dispatch-work/${seed}/round-1/" />\n`,
    );
    const quotedArea = validateDispatch({ ...parseArgs([]), repo: quotedAreaRepo, seed });

    const plusAliasAreaRepo = join(root, "plus-alias-area-repo");
    makeFixtureRound(plusAliasAreaRepo, seed, join(plusAliasAreaRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeSeedIssue(plusAliasAreaRepo, seed, "spec/conformance + impl/go");
    writeFileSync(
      join(plusAliasAreaRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md"),
      `${promptFixture(seed, "implement", "implement-a1-prompt.md", "implement-a1.log", "implement-a1.status", "implement-a1-report.md")}\nWrite scope: impl_go/v1/**\n`,
    );
    const plusAliasArea = validateDispatch({ ...parseArgs([]), repo: plusAliasAreaRepo, seed });

    const commaAreaRepo = join(root, "comma-area-repo");
    makeFixtureRound(commaAreaRepo, seed, join(commaAreaRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeSeedIssue(commaAreaRepo, seed, "packages/api, impl/rust");
    writeFileSync(
      join(commaAreaRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md"),
      `${promptFixture(seed, "implement", "implement-a1-prompt.md", "implement-a1.log", "implement-a1.status", "implement-a1-report.md")}\nWrite scope: impl/rust/**\n`,
    );
    const commaArea = validateDispatch({ ...parseArgs([]), repo: commaAreaRepo, seed });

    const commaRootListRepo = join(root, "comma-root-list-repo");
    makeFixtureRound(commaRootListRepo, seed, join(commaRootListRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeSeedIssue(commaRootListRepo, seed, "spec/agent, spec/io, spec/conformance");
    writeFileSync(
      join(commaRootListRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md"),
      `${promptFixture(seed, "implement", "implement-a1-prompt.md", "implement-a1.log", "implement-a1.status", "implement-a1-report.md")}\n<child_artifact_contract repo_edit_roots="spec/agent.md,spec/io.md,spec/conformance/README.md,tmp/seedstack/run-1" />\n`,
    );
    const commaRootList = validateDispatch({ ...parseArgs([]), repo: commaRootListRepo, seed });

    const semicolonAreaRepo = join(root, "semicolon-area-repo");
    makeFixtureRound(semicolonAreaRepo, seed, join(semicolonAreaRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeSeedIssue(semicolonAreaRepo, seed, "services/api; packages/web");
    writeFileSync(
      join(semicolonAreaRepo, "tmp/dispatch-work", seed, "round-1/implement-a1-prompt.md"),
      `${promptFixture(seed, "implement", "implement-a1-prompt.md", "implement-a1.log", "implement-a1.status", "implement-a1-report.md")}\n<preserve_dirty_paths repo_edit_roots="packages/web; tmp/seedstack/run-1" artifact_write_roots="tmp/dispatch-work/${seed}/round-1/" />\n`,
    );
    const semicolonArea = validateDispatch({ ...parseArgs([]), repo: semicolonAreaRepo, seed });

    const supportAreaRepo = join(root, "support-area-repo");
    makeFixtureRound(supportAreaRepo, seed, join(supportAreaRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeSeedIssue(supportAreaRepo, seed, "packages/api", "test/harness");
    setRepoEditRoots(supportAreaRepo, seed, "packages/api test/harness");
    const supportAreaGatePath = join(supportAreaRepo, "tmp/dispatch-work", seed, "gate.md");
    writeFileSync(
      supportAreaGatePath,
      readFileSync(supportAreaGatePath, "utf8").replace(
        "Known dirty paths: none.",
        "Known dirty paths:\n- `test/harness/wrapper.ts`: harness update.",
      ),
    );
    const supportAreaSnapshotPath = join(supportAreaRepo, "snapshot.json");
    writeFileSync(supportAreaSnapshotPath, `${JSON.stringify(snapshotFromStatus(supportAreaRepo, " M test/harness/wrapper.ts\n"))}\n`);
    const supportArea = validateDispatch({ ...parseArgs([]), repo: supportAreaRepo, seed, dirtyStatusFile: supportAreaSnapshotPath });

    const dirtyGuardMismatchRepo = join(root, "dirty-guard-mismatch-repo");
    makeFixtureRound(dirtyGuardMismatchRepo, seed, join(dirtyGuardMismatchRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeSeedIssue(dirtyGuardMismatchRepo, seed, "impl_v2/rust");
    mkdirSync(join(dirtyGuardMismatchRepo, "impl/rust/src"), { recursive: true });
    writeFileSync(join(dirtyGuardMismatchRepo, "impl/rust/src/commands.rs"), "base\n");
    initGitRepo(dirtyGuardMismatchRepo);
    writeFileSync(join(dirtyGuardMismatchRepo, "impl/rust/src/commands.rs"), "wrong root\n");
    const dirtyGuardGatePath = join(dirtyGuardMismatchRepo, "tmp/dispatch-work", seed, "gate.md");
    writeFileSync(
      dirtyGuardGatePath,
      readFileSync(dirtyGuardGatePath, "utf8").replace(
        "Known dirty paths: none.",
        "Known dirty paths:\n- `impl_v2/rust/src/commands.rs`: implementation change.",
      ),
    );
    const dirtyGuardMismatch = validateDispatch({ ...parseArgs([]), repo: dirtyGuardMismatchRepo, seed });

    const structuredGuardRepo = join(root, "structured-guard-repo");
    makeFixtureRound(structuredGuardRepo, seed, join(structuredGuardRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    setRepoEditRoots(structuredGuardRepo, seed, "src/fixture.ts");
    const structuredGuardSnapshotPath = join(structuredGuardRepo, "snapshot.json");
    writeFileSync(structuredGuardSnapshotPath, `${JSON.stringify(snapshotFromStatus(structuredGuardRepo, " M src/fixture.ts\n"))}\n`);
    writeStructuredDirtyGuardGate(structuredGuardRepo, seed, "snapshot.json", ["src/fixture.ts"]);
    const structuredGuard = validateDispatch({ ...parseArgs([]), repo: structuredGuardRepo, seed, dirtyStatusFile: structuredGuardSnapshotPath });

    const structuredSnapshotMismatchRepo = join(root, "structured-snapshot-mismatch-repo");
    makeFixtureRound(structuredSnapshotMismatchRepo, seed, join(structuredSnapshotMismatchRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    setRepoEditRoots(structuredSnapshotMismatchRepo, seed, "src/fixture.ts");
    const supervisorSnapshotPath = join(structuredSnapshotMismatchRepo, "supervisor-snapshot.json");
    writeFileSync(supervisorSnapshotPath, `${JSON.stringify(snapshotFromStatus(structuredSnapshotMismatchRepo, " M src/fixture.ts\n"))}\n`);
    writeStructuredDirtyGuardGate(structuredSnapshotMismatchRepo, seed, "tmp/dispatch-work/seedspec-test/dirty-status.txt", ["src/fixture.ts"]);
    const structuredSnapshotMismatchStrict = validateDispatch({
      ...parseArgs([]),
      repo: structuredSnapshotMismatchRepo,
      seed,
      dirtyStatusFile: supervisorSnapshotPath,
    });
    const structuredSnapshotMismatchLoop = validateDispatch({
      ...parseArgs([]),
      repo: structuredSnapshotMismatchRepo,
      seed,
      dirtyStatusFile: supervisorSnapshotPath,
      validationPolicy: "loop",
    });

    const structuredBeatsMarkdownRepo = join(root, "structured-beats-markdown-repo");
    makeFixtureRound(structuredBeatsMarkdownRepo, seed, join(structuredBeatsMarkdownRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    setRepoEditRoots(structuredBeatsMarkdownRepo, seed, "src/fixture.ts");
    const structuredBeatsMarkdownSnapshotPath = join(structuredBeatsMarkdownRepo, "snapshot.json");
    writeFileSync(structuredBeatsMarkdownSnapshotPath, `${JSON.stringify(snapshotFromStatus(structuredBeatsMarkdownRepo, " M src/fixture.ts\n"))}\n`);
    writeStructuredDirtyGuardGate(structuredBeatsMarkdownRepo, seed, "snapshot.json", ["src/fixture.ts"], ["- implementation path: `<placeholder/wrong>`"]);
    const structuredBeatsMarkdown = validateDispatch({ ...parseArgs([]), repo: structuredBeatsMarkdownRepo, seed, dirtyStatusFile: structuredBeatsMarkdownSnapshotPath });

    const structuredMismatchRepo = join(root, "structured-mismatch-repo");
    makeFixtureRound(structuredMismatchRepo, seed, join(structuredMismatchRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    setRepoEditRoots(structuredMismatchRepo, seed, "src/fixture.ts");
    const structuredMismatchSnapshotPath = join(structuredMismatchRepo, "snapshot.json");
    writeFileSync(structuredMismatchSnapshotPath, `${JSON.stringify(snapshotFromStatus(structuredMismatchRepo, " M src/fixture.ts\n"))}\n`);
    writeStructuredDirtyGuardGate(structuredMismatchRepo, seed, "snapshot.json", ["src/other.ts"]);
    const structuredMismatch = validateDispatch({ ...parseArgs([]), repo: structuredMismatchRepo, seed, dirtyStatusFile: structuredMismatchSnapshotPath });
    const structuredMismatchLoop = validateDispatch({
      ...parseArgs([]),
      repo: structuredMismatchRepo,
      seed,
      dirtyStatusFile: structuredMismatchSnapshotPath,
      validationPolicy: "loop",
    });

    const queueMutationRepo = join(root, "queue-mutation-repo");
    makeFixtureRound(queueMutationRepo, seed, join(queueMutationRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    initGitRepo(queueMutationRepo);
    mkdirSync(join(queueMutationRepo, ".seeds"), { recursive: true });
    writeFileSync(join(queueMutationRepo, ".seeds/issues.jsonl"), "{}\n");
    const queueMutation = validateDispatch({ ...parseArgs([]), repo: queueMutationRepo, seed });
    const managerQueueMutation = validateDispatch({
      ...parseArgs([]),
      repo: queueMutationRepo,
      seed,
      queueMutationContext: "manager",
    });

    const snapshotCleanRepo = join(root, "snapshot-clean-repo");
    makeFixtureRound(snapshotCleanRepo, seed, join(snapshotCleanRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    mkdirSync(join(snapshotCleanRepo, "src"), { recursive: true });
    writeFileSync(join(snapshotCleanRepo, "src/live.ts"), "base\n");
    initGitRepo(snapshotCleanRepo);
    writeFileSync(join(snapshotCleanRepo, "src/live.ts"), "live dirty after snapshot\n");
    const cleanSnapshotPath = join(snapshotCleanRepo, "snapshot-clean.json");
    writeFileSync(cleanSnapshotPath, `${JSON.stringify(snapshotFromStatus(snapshotCleanRepo, ""))}\n`);
    const snapshotClean = validateDispatch({ ...parseArgs([]), repo: snapshotCleanRepo, seed, dirtyStatusFile: cleanSnapshotPath });

    const snapshotDirtyRepo = join(root, "snapshot-dirty-repo");
    makeFixtureRound(snapshotDirtyRepo, seed, join(snapshotDirtyRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    const dirtySnapshotPath = join(snapshotDirtyRepo, "snapshot-dirty.json");
    writeFileSync(dirtySnapshotPath, `${JSON.stringify(snapshotFromStatus(snapshotDirtyRepo, " M src/from-snapshot.ts\n"))}\n`);
    const snapshotDirty = validateDispatch({ ...parseArgs([]), repo: snapshotDirtyRepo, seed, dirtyStatusFile: dirtySnapshotPath });

    const multiAreaDirtyRepo = join(root, "multi-area-dirty-repo");
    makeFixtureRound(multiAreaDirtyRepo, seed, join(multiAreaDirtyRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeSeedIssue(multiAreaDirtyRepo, seed, "spec/conformance + impl_go/v1");
    const multiAreaRoots = "spec/conformance impl_go/v1";
    for (const prompt of ["execute-prompt.md", "implement-a1-prompt.md", "review-r1-a1-prompt.md", "verify-1-prompt.md"]) {
      const promptPath = join(multiAreaDirtyRepo, "tmp/dispatch-work", seed, "round-1", prompt);
      writeFileSync(promptPath, readFileSync(promptPath, "utf8").replace(/repo_edit_roots="[^"]*"/g, `repo_edit_roots="${multiAreaRoots}"`));
    }
    const multiAreaGatePath = join(multiAreaDirtyRepo, "tmp/dispatch-work", seed, "gate.md");
    writeFileSync(
      multiAreaGatePath,
      readFileSync(multiAreaGatePath, "utf8").replace(
        "Known dirty paths: none.",
        "Known dirty paths:\n- `spec/conformance/case.yaml`: conformance update.\n- `impl_go/v1/run.go`: implementation update.",
      ),
    );
    const multiAreaSnapshotPath = join(multiAreaDirtyRepo, "snapshot.json");
    writeFileSync(multiAreaSnapshotPath, `${JSON.stringify(snapshotFromStatus(multiAreaDirtyRepo, " M spec/conformance/case.yaml\n M impl_go/v1/run.go\n"))}\n`);
    const multiAreaDirty = validateDispatch({ ...parseArgs([]), repo: multiAreaDirtyRepo, seed, dirtyStatusFile: multiAreaSnapshotPath });

    const proseMentionRepo = join(root, "prose-mention-repo");
    makeFixtureRound(proseMentionRepo, seed, join(proseMentionRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeSeedIssue(proseMentionRepo, seed, "spec/conformance + impl_go/v1");
    writeFileSync(join(proseMentionRepo, "tmp/dispatch-work", seed, "research-1.md"), "Source refs: impl_bad/v1/src/main.go\nCommand: cd impl_bad/v1 && go test ./...\n");
    const proseMentionSnapshotPath = join(proseMentionRepo, "snapshot.json");
    writeFileSync(proseMentionSnapshotPath, `${JSON.stringify(snapshotFromStatus(proseMentionRepo, ""))}\n`);
    const proseMention = validateDispatch({ ...parseArgs([]), repo: proseMentionRepo, seed, dirtyStatusFile: proseMentionSnapshotPath });

    const outOfScopeDirtyRepo = join(root, "out-of-scope-dirty-repo");
    makeFixtureRound(outOfScopeDirtyRepo, seed, join(outOfScopeDirtyRepo, "tmp/dispatch-work", seed, "round-1"), "pass", "close", true);
    writeSeedIssue(outOfScopeDirtyRepo, seed, "spec/conformance + impl_go/v1");
    for (const prompt of ["execute-prompt.md", "implement-a1-prompt.md", "review-r1-a1-prompt.md", "verify-1-prompt.md"]) {
      const promptPath = join(outOfScopeDirtyRepo, "tmp/dispatch-work", seed, "round-1", prompt);
      writeFileSync(promptPath, readFileSync(promptPath, "utf8").replace(/repo_edit_roots="[^"]*"/g, `repo_edit_roots="${multiAreaRoots}"`));
    }
    const outOfScopeGatePath = join(outOfScopeDirtyRepo, "tmp/dispatch-work", seed, "gate.md");
    writeFileSync(
      outOfScopeGatePath,
      readFileSync(outOfScopeGatePath, "utf8").replace(
        "Known dirty paths: none.",
        "Known dirty paths:\n- `impl_bad/v1/run.go`: implementation update.",
      ),
    );
    const outOfScopeSnapshotPath = join(outOfScopeDirtyRepo, "snapshot.json");
    writeFileSync(outOfScopeSnapshotPath, `${JSON.stringify(snapshotFromStatus(outOfScopeDirtyRepo, " M impl_bad/v1/run.go\n"))}\n`);
    const outOfScopeDirty = validateDispatch({ ...parseArgs([]), repo: outOfScopeDirtyRepo, seed, dirtyStatusFile: outOfScopeSnapshotPath });

    const alternateRootRepo = join(root, "alternate-root-repo");
    const alternateRound = join(alternateRootRepo, "custom-dispatch", seed, "round-1");
    makeFixtureRound(alternateRootRepo, seed, alternateRound, "pass", "close", true);
    writeSeedIssue(alternateRootRepo, seed, "custom/root");
    const alternateRoot = validateDispatch({ ...parseArgs([]), repo: alternateRootRepo, roundPath: alternateRound });

    const tests = [
      { name: "valid fixture passes", pass: valid.ok, blockers: valid.blockers.length },
      { name: "missing knowledge capture blocks close", pass: !missingKnowledge.ok && missingKnowledge.blockers.some((finding) => finding.code === "gate_done_knowledge_capture_invalid"), blockers: missingKnowledge.blockers.length },
      { name: "shallow none qualified knowledge capture blocks close", pass: !shallowKnowledge.ok && shallowKnowledge.blockers.some((finding) => finding.message.includes("store_count missing")), blockers: shallowKnowledge.blockers.length },
      { name: "recorded prose knowledge capture blocks close", pass: !recordedProse.ok && recordedProse.blockers.some((finding) => finding.message.includes("recorded capture requires")), blockers: recordedProse.blockers.length },
      { name: "recorded accepted ID knowledge capture passes", pass: recordedIds.ok, blockers: recordedIds.blockers.length },
      { name: "recorded JSON accepted records knowledge capture passes", pass: recordedJson.ok, blockers: recordedJson.blockers.length },
      { name: "missing report summary blocks", pass: !missingSummary.ok && missingSummary.blockers.some((finding) => finding.code === "missing_report_summary"), blockers: missingSummary.blockers.length },
      { name: "loop policy missing report summary softens", pass: missingSummaryLoop.ok && (missingSummaryLoop.soft_blockers ?? []).some((finding) => finding.code === "missing_report_summary"), blockers: missingSummaryLoop.blockers.length },
      { name: "summary keys without heading block", pass: !summaryKeysWithoutHeading.ok && summaryKeysWithoutHeading.blockers.some((finding) => finding.code === "missing_report_summary"), blockers: summaryKeysWithoutHeading.blockers.length },
      { name: "missing report summary key blocks", pass: !missingSummaryKey.ok && missingSummaryKey.blockers.some((finding) => finding.code === "missing_report_summary_key"), blockers: missingSummaryKey.blockers.length },
      { name: "loop policy missing report summary key softens", pass: missingSummaryKeyLoop.ok && (missingSummaryKeyLoop.soft_blockers ?? []).some((finding) => finding.code === "missing_report_summary_key"), blockers: missingSummaryKeyLoop.blockers.length },
      { name: "invalid report summary order blocks", pass: !invalidSummaryOrder.ok && invalidSummaryOrder.blockers.some((finding) => finding.code === "invalid_report_summary_order"), blockers: invalidSummaryOrder.blockers.length },
      { name: "invalid report summary value blocks", pass: !invalidSummaryValue.ok && invalidSummaryValue.blockers.some((finding) => finding.code === "invalid_report_summary_value"), blockers: invalidSummaryValue.blockers.length },
      { name: "execute done without pass blocks", pass: !badExecute.ok && badExecute.blockers.some((finding) => finding.code === "execute_done_without_pass"), blockers: badExecute.blockers.length },
      { name: "v1 status contract blocks", pass: !v1.ok && v1.blockers.some((finding) => finding.code === "invalid_status_contract"), blockers: v1.blockers.length },
      { name: "dirty child without capsule blocks", pass: !dirty.ok && dirty.blockers.some((finding) => finding.code === "missing_failure_capsule"), blockers: dirty.blockers.length },
      { name: "gate close without evidence blocks", pass: !noEvidence.ok && noEvidence.blockers.some((finding) => finding.code === "gate_missing_evidence_paths"), blockers: noEvidence.blockers.length },
      { name: "gate checks table paths ignored after evidence table", pass: evidenceThenGateChecks.ok && evidenceThenGateChecks.summary.gate?.acceptedPaths === 4, blockers: evidenceThenGateChecks.blockers.length },
      { name: "non-evidence path table ignored", pass: nonEvidenceTable.ok && nonEvidenceTable.summary.gate?.acceptedPaths === 4, blockers: nonEvidenceTable.blockers.length },
      { name: "gate evidence artifact path alias passes", pass: evidenceAlias.ok && evidenceAlias.summary.gate?.acceptedPaths === 2, blockers: evidenceAlias.blockers.length },
      { name: "placeholder gate cwd blocks", pass: !placeholderCwd.ok && placeholderCwd.blockers.some((finding) => finding.code === "gate_command_placeholder_cwd"), blockers: placeholderCwd.blockers.length },
      { name: "nonexistent gate cwd blocks", pass: !nonexistentCwd.ok && nonexistentCwd.blockers.some((finding) => finding.code === "gate_command_cwd_missing"), blockers: nonexistentCwd.blockers.length },
      { name: "marker-only gate command blocks close", pass: !markerOnlyGate.ok && markerOnlyGate.blockers.some((finding) => finding.code === "gate_command_marker_only"), blockers: markerOnlyGate.blockers.length },
      { name: "skipped smoke-release live gate without waiver blocks close", pass: !skippedLiveGate.ok && skippedLiveGate.blockers.some((finding) => finding.code === "gate_skipped_required_without_waiver"), blockers: skippedLiveGate.blockers.length },
      { name: "failed required gate without waiver blocks close", pass: !failedRequiredGate.ok && failedRequiredGate.blockers.some((finding) => finding.code === "gate_failed_required_without_waiver"), blockers: failedRequiredGate.blockers.length },
      { name: "numbered review report passes", pass: numberedReview.ok, blockers: numberedReview.blockers.length },
      { name: "stale report blocks", pass: !stale.ok && stale.blockers.some((finding) => finding.code === "stale_linked_report"), blockers: stale.blockers.length },
      { name: "loop policy stale report softens", pass: staleLoop.ok && (staleLoop.soft_blockers ?? []).some((finding) => finding.code === "stale_linked_report"), blockers: staleLoop.blockers.length },
      { name: "weak liveness handle blocks", pass: !weakLiveness.ok && weakLiveness.blockers.some((finding) => finding.code === "invalid_liveness_handle"), blockers: weakLiveness.blockers.length },
      { name: "loop policy weak liveness softens", pass: weakLivenessLoop.ok && (weakLivenessLoop.soft_blockers ?? []).some((finding) => finding.code === "invalid_liveness_handle"), blockers: weakLivenessLoop.blockers.length },
      { name: "launcher/handle mismatch blocks", pass: !mismatchedLauncher.ok && mismatchedLauncher.blockers.some((finding) => finding.code === "launcher_liveness_mismatch"), blockers: mismatchedLauncher.blockers.length },
      { name: "placeholder spawn handle blocks", pass: !fakeSpawn.ok && fakeSpawn.blockers.some((finding) => finding.code === "invalid_liveness_handle"), blockers: fakeSpawn.blockers.length },
      { name: "role-name spawn handle blocks", pass: !roleNameSpawn.ok && roleNameSpawn.blockers.some((finding) => finding.code === "self_attested_liveness_handle"), blockers: roleNameSpawn.blockers.length },
      { name: "session current handle blocks", pass: !sessionCurrent.ok && sessionCurrent.blockers.some((finding) => finding.code === "invalid_liveness_handle"), blockers: sessionCurrent.blockers.length },
      { name: "missing launch evidence blocks", pass: !missingLaunchEvidence.ok && missingLaunchEvidence.blockers.some((finding) => finding.code === "missing_launch_evidence_path"), blockers: missingLaunchEvidence.blockers.length },
      { name: "missing launch evidence contract blocks", pass: !missingEvidenceContract.ok && missingEvidenceContract.blockers.some((finding) => finding.code === "invalid_launch_evidence_contract"), blockers: missingEvidenceContract.blockers.length },
      { name: "missing launch evidence owner blocks", pass: !missingEvidenceOwner.ok && missingEvidenceOwner.blockers.some((finding) => finding.code === "missing_launch_evidence_owner"), blockers: missingEvidenceOwner.blockers.length },
      { name: "supervisor without launch evidence blocks", pass: !supervisorNoEvidence.ok && supervisorNoEvidence.blockers.some((finding) => finding.code === "missing_launch_evidence_path"), blockers: supervisorNoEvidence.blockers.length },
      { name: "invalid attempt blocks", pass: !badAttempt.ok && badAttempt.blockers.some((finding) => finding.code === "invalid_attempt"), blockers: badAttempt.blockers.length },
      { name: "placeholder prompt blocks", pass: !placeholder.ok && placeholder.blockers.some((finding) => finding.code === "placeholder_linked_artifact"), blockers: placeholder.blockers.length },
      { name: "prompt report mismatch blocks", pass: !promptMismatch.ok && promptMismatch.blockers.some((finding) => finding.code === "prompt_report_path_mismatch"), blockers: promptMismatch.blockers.length },
      { name: "prompt launch provenance missing blocks", pass: !promptLaunchMissing.ok && promptLaunchMissing.blockers.some((finding) => finding.code === "prompt_missing_launch_evidence_path") && promptLaunchMissing.blockers.some((finding) => finding.code === "prompt_missing_launch_provenance"), blockers: promptLaunchMissing.blockers.length },
      { name: "prompt io_policy missing attr blocks", pass: !promptIoMissingAttr.ok && promptIoMissingAttr.blockers.some((finding) => finding.code === "prompt_missing_io_path"), blockers: promptIoMissingAttr.blockers.length },
      { name: "prompt io_policy no polling mismatch blocks", pass: !promptIoNoPollingWrong.ok && promptIoNoPollingWrong.blockers.some((finding) => finding.code === "prompt_io_policy_attr_mismatch"), blockers: promptIoNoPollingWrong.blockers.length },
      { name: "prompt io_policy no polling missing blocks", pass: !promptIoNoPollingMissing.ok && promptIoNoPollingMissing.blockers.some((finding) => finding.code === "prompt_missing_io_policy_attr"), blockers: promptIoNoPollingMissing.blockers.length },
      { name: "prompt launch provenance attr missing blocks", pass: !promptLaunchProvenanceAttrMissing.ok && promptLaunchProvenanceAttrMissing.blockers.some((finding) => finding.code === "prompt_missing_launch_provenance_attr"), blockers: promptLaunchProvenanceAttrMissing.blockers.length },
      { name: "prompt preserve_dirty_paths missing blocks", pass: !promptPreserveMissing.ok && promptPreserveMissing.blockers.some((finding) => finding.code === "prompt_missing_preserve_dirty_paths"), blockers: promptPreserveMissing.blockers.length },
      { name: "prompt preserve_dirty_paths bad state blocks", pass: !promptPreserveWrong.ok && promptPreserveWrong.blockers.some((finding) => finding.code === "prompt_preserve_dirty_paths_attr_mismatch"), blockers: promptPreserveWrong.blockers.length },
      { name: "legacy child contract passes", pass: legacyPrompt.ok, blockers: legacyPrompt.blockers.length },
      { name: "thin legacy child contract blocks", pass: !thinLegacyPrompt.ok && thinLegacyPrompt.blockers.some((finding) => finding.code === "prompt_legacy_child_contract_incomplete"), blockers: thinLegacyPrompt.blockers.length },
      { name: "compact child contract passes", pass: compactPrompt.ok, blockers: compactPrompt.blockers.length },
      { name: "compact child contract bad attrs block", pass: !compactPromptBadAttrs.ok && compactPromptBadAttrs.blockers.some((finding) => finding.code === "prompt_child_contract_missing_attr"), blockers: compactPromptBadAttrs.blockers.length },
      { name: "loop policy compact child contract bad attrs stays hard", pass: !compactPromptBadAttrsLoop.ok && compactPromptBadAttrsLoop.blockers.some((finding) => finding.code === "prompt_child_contract_missing_attr"), blockers: compactPromptBadAttrsLoop.blockers.length },
      { name: "compact child contract bad ref blocks", pass: !compactPromptBadRef.ok && compactPromptBadRef.blockers.some((finding) => finding.code === "prompt_child_contract_attr_mismatch"), blockers: compactPromptBadRef.blockers.length },
      { name: "compact child contract report mismatch blocks", pass: !compactPromptReportMismatch.ok && compactPromptReportMismatch.blockers.some((finding) => finding.code === "prompt_report_path_mismatch"), blockers: compactPromptReportMismatch.blockers.length },
      { name: "seed area mismatch blocks", pass: !wrongArea.ok && wrongArea.blockers.some((finding) => finding.code === "artifact_impl_root_mismatch"), blockers: wrongArea.blockers.length },
      { name: "arbitrary seed area mismatch blocks", pass: !arbitraryArea.ok && arbitraryArea.blockers.some((finding) => finding.code === "artifact_impl_root_mismatch"), blockers: arbitraryArea.blockers.length },
      { name: "artifact roots ignored for implementation scope", pass: artifactRootsIgnored.ok, blockers: artifactRootsIgnored.blockers.length },
      { name: "legacy allowed_write_roots compatibility passes", pass: legacyAllowedRoots.ok, blockers: legacyAllowedRoots.blockers.length },
      { name: "top-level prose area mention ignored", pass: topLevelArea.ok, blockers: topLevelArea.blockers.length },
      { name: "quoted area passes", pass: quotedArea.ok, blockers: quotedArea.blockers.length },
      { name: "plus area alias passes", pass: plusAliasArea.ok, blockers: plusAliasArea.blockers.length },
      { name: "comma area passes", pass: commaArea.ok, blockers: commaArea.blockers.length },
      { name: "comma repo_edit_roots list passes", pass: commaRootList.ok, blockers: commaRootList.blockers.length },
      { name: "semicolon area passes", pass: semicolonArea.ok, blockers: semicolonArea.blockers.length },
      { name: "support_area repo_edit_roots and dirty paths pass", pass: supportArea.ok, blockers: supportArea.blockers.length },
      { name: "dirty guard actual path mismatch blocks", pass: !dirtyGuardMismatch.ok && dirtyGuardMismatch.blockers.some((finding) => finding.code === "gate_dirty_guard_path_mismatch"), blockers: dirtyGuardMismatch.blockers.length },
      { name: "structured dirty guard matching snapshot passes", pass: structuredGuard.ok, blockers: structuredGuard.blockers.length },
      { name: "strict dirty guard snapshot mismatch blocks", pass: !structuredSnapshotMismatchStrict.ok && structuredSnapshotMismatchStrict.blockers.some((finding) => finding.code === "gate_dirty_guard_snapshot_mismatch"), blockers: structuredSnapshotMismatchStrict.blockers.length },
      { name: "loop dirty guard snapshot mismatch softens", pass: structuredSnapshotMismatchLoop.ok && (structuredSnapshotMismatchLoop.soft_blockers ?? []).some((finding) => finding.code === "gate_dirty_guard_snapshot_mismatch"), blockers: structuredSnapshotMismatchLoop.blockers.length },
      { name: "structured dirty guard overrides malformed markdown", pass: structuredBeatsMarkdown.ok, blockers: structuredBeatsMarkdown.blockers.length },
      { name: "structured dirty guard mismatch blocks", pass: !structuredMismatch.ok && structuredMismatch.blockers.some((finding) => finding.code === "gate_dirty_guard_structured_mismatch"), blockers: structuredMismatch.blockers.length },
      { name: "loop structured dirty guard mismatch stays hard", pass: !structuredMismatchLoop.ok && structuredMismatchLoop.blockers.some((finding) => finding.code === "gate_dirty_guard_structured_mismatch"), blockers: structuredMismatchLoop.blockers.length },
      { name: "queue mutation dirty blocks", pass: !queueMutation.ok && queueMutation.blockers.some((finding) => finding.code === "gate_queue_mutation_dirty"), blockers: queueMutation.blockers.length },
      { name: "manager-owned issues dirty allowed", pass: managerQueueMutation.ok, blockers: managerQueueMutation.blockers.length },
      { name: "dirty snapshot clean ignores live git dirtiness", pass: snapshotClean.ok, blockers: snapshotClean.blockers.length },
      { name: "dirty snapshot implementation dirtiness blocks", pass: !snapshotDirty.ok && snapshotDirty.blockers.some((finding) => finding.code === "gate_dirty_guard_missing_actual_paths"), blockers: snapshotDirty.blockers.length },
      { name: "multi-area dirty paths under repo_edit_roots pass", pass: multiAreaDirty.ok, blockers: multiAreaDirty.blockers.length },
      { name: "out-of-scope prose mention without changed file passes", pass: proseMention.ok, blockers: proseMention.blockers.length },
      { name: "out-of-scope changed file blocks", pass: !outOfScopeDirty.ok && outOfScopeDirty.blockers.some((finding) => finding.code === "repo_edit_path_outside_roots"), blockers: outOfScopeDirty.blockers.length },
      { name: "round-path alternate root passes", pass: alternateRoot.ok, blockers: alternateRoot.blockers.length },
    ];
    const result = { ok: tests.every((test) => test.pass), tests };
    writeJson(result, pretty);
    return result.ok ? 0 : 1;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function setRepoEditRoots(repo: string, seed: string, roots: string) {
  for (const prompt of ["execute-prompt.md", "implement-a1-prompt.md", "review-r1-a1-prompt.md", "verify-1-prompt.md"]) {
    const promptPath = join(repo, "tmp/dispatch-work", seed, "round-1", prompt);
    writeFileSync(promptPath, readFileSync(promptPath, "utf8").replace(/repo_edit_roots="[^"]*"/g, `repo_edit_roots="${roots}"`));
  }
}

function writeStructuredDirtyGuardGate(repo: string, seed: string, snapshotPath: string, actualImplPaths: string[], markdownLines?: string[]) {
  const gatePath = join(repo, "tmp/dispatch-work", seed, "gate.md");
  const guard = {
    contract: "dirty_guard.v1",
    baseline_paths: [],
    actual_impl_paths: actualImplPaths,
    queue_paths: [],
    unexpected_paths: [],
    snapshot_path: snapshotPath,
  };
  const markdown = markdownLines ?? actualImplPaths.map((path) => `- implementation path: \`${path}\``);
  writeFileSync(
    gatePath,
    readFileSync(gatePath, "utf8").replace(
      "Known dirty paths: none.",
      [
        "- command: `git status --porcelain=v1 --untracked-files=all`",
        ...markdown,
        "```json",
        JSON.stringify(guard, null, 2),
        "```",
      ].join("\n"),
    ),
  );
}
