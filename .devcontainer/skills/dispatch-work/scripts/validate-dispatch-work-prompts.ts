import { IO_POLICY_PATH_ATTRS } from "./dispatch-work-contracts.ts";

type Level = "blocker" | "warning";

type AddFinding = (level: Level, code: string, message: string, path?: string) => void;
type SameArtifactPath = (left: string, right: string) => boolean;

type ExpectedPromptPaths =
  | { promptPath?: string; reportPath?: string; logPath?: string; statusPath?: string; launchEvidencePath?: string; parentLaunchId?: string }
  | undefined;

export function validatePromptContract(
  raw: string,
  linkedPath: string,
  statusFile: string,
  expectedPaths: ExpectedPromptPaths,
  add: AddFinding,
  sameArtifactPath: SameArtifactPath,
) {
  const childContract = parsePromptChildArtifactContract(raw);
  const hasLegacyChildContract = /Child artifact contract/i.test(raw);
  if (!hasLegacyChildContract && !childContract.present) {
    add("blocker", "prompt_missing_child_contract", `prompt missing child artifact contract: ${linkedPath}`, statusFile);
  }
  if (childContract.present) {
    validateCompactChildArtifactContract(childContract.attrs, linkedPath, statusFile, expectedPaths, add, sameArtifactPath);
  } else if (hasLegacyChildContract) {
    validateLegacyChildArtifactContract(raw, linkedPath, statusFile, add);
  }
  const checks = [
    { code: "prompt_missing_seed_mutation_rule", pattern: /\.seeds\/\*\*/, message: "prompt missing .seeds/** mutation rule" },
    { code: "prompt_missing_command_wrapper_rule", pattern: /rtk|command[-_]wrapper|repo-native(?:\s+commands)?/i, message: "prompt missing repo command-wrapper rule" },
    { code: "prompt_missing_report_path", pattern: /(?:report_path\s*=\s*["'][^"']+["']|Report path:\s*\S+)/i, message: "prompt missing assigned report path" },
  ];
  for (const check of checks) {
    if (!check.pattern.test(raw)) add("blocker", check.code, `${check.message}: ${linkedPath}`, statusFile);
  }
  const ioPolicy = parsePromptIoPolicy(raw);
  const ioPaths = promptIoPaths(ioPolicy.attrs);
  const launchProvenance = parsePromptLaunchProvenance(raw);
  const preserveDirtyPaths = parsePromptPreserveDirtyPaths(raw);
  validatePromptIoPolicy(ioPolicy, linkedPath, statusFile, add);
  validatePromptPreserveDirtyPaths(preserveDirtyPaths, linkedPath, statusFile, add);
  requirePromptIoPath("prompt_path", expectedPaths?.promptPath, ioPaths, "prompt_path_mismatch", linkedPath, statusFile, add, sameArtifactPath);
  requirePromptIoPath("log_path", expectedPaths?.logPath, ioPaths, "prompt_log_path_mismatch", linkedPath, statusFile, add, sameArtifactPath);
  requirePromptIoPath("status_path", expectedPaths?.statusPath, ioPaths, "prompt_status_path_mismatch", linkedPath, statusFile, add, sameArtifactPath);
  requirePromptIoPath("report_path", expectedPaths?.reportPath, ioPaths, "prompt_report_path_mismatch", linkedPath, statusFile, add, sameArtifactPath);
  const promptLaunchEvidencePath = ioPaths.launch_evidence_path ?? stringValue(launchProvenance.launch_evidence_path);
  if (!promptLaunchEvidencePath) {
    add("blocker", "prompt_missing_launch_evidence_path", `prompt missing launch_evidence_path: ${linkedPath}`, statusFile);
  } else if (expectedPaths?.launchEvidencePath && !sameArtifactPath(promptLaunchEvidencePath, expectedPaths.launchEvidencePath)) {
    add(
      "blocker",
      "prompt_launch_evidence_path_mismatch",
      `prompt launch_evidence_path ${promptLaunchEvidencePath} does not match status ${expectedPaths.launchEvidencePath}`,
      statusFile,
    );
  }
  if (!launchProvenance.present) {
    add("blocker", "prompt_missing_launch_provenance", `prompt missing launch_provenance: ${linkedPath}`, statusFile);
  }
  const promptParentLaunchId = stringValue(launchProvenance.parent_launch_id);
  if (launchProvenance.present && !promptParentLaunchId) {
    add("blocker", "prompt_missing_launch_provenance_attr", `prompt launch_provenance missing parent_launch_id: ${linkedPath}`, statusFile);
  }
  if (launchProvenance.present && !stringValue(launchProvenance.launch_evidence_path)) {
    add("blocker", "prompt_missing_launch_provenance_attr", `prompt launch_provenance missing launch_evidence_path: ${linkedPath}`, statusFile);
  }
  if (expectedPaths?.parentLaunchId && promptParentLaunchId && promptParentLaunchId !== expectedPaths.parentLaunchId) {
    add(
      "blocker",
      "prompt_parent_launch_id_mismatch",
      `prompt parent_launch_id ${promptParentLaunchId} does not match status ${expectedPaths.parentLaunchId}`,
      statusFile,
    );
  }
  const promptReportPath = ioPaths.report_path ?? childContract.attrs.report_path ?? parseReportPathLine(raw);
  if (expectedPaths?.reportPath && promptReportPath && !sameArtifactPath(promptReportPath, expectedPaths.reportPath)) {
    add("blocker", "prompt_report_path_mismatch", `prompt report path ${promptReportPath} does not match status ${expectedPaths.reportPath}`, statusFile);
  }
}

function validateLegacyChildArtifactContract(raw: string, linkedPath: string, statusFile: string, add: AddFinding) {
  const required = [
    { label: "parent status ownership", pattern: /Parent\/supervisor writes status_path/i },
    { label: "child report-only write rule", pattern: /Children\s+write\s+report_path\s+only/i },
    { label: "child_run_status.v2 contract", pattern: /contract=child_run_status\.v2/i },
    { label: "launch evidence path", pattern: /\blaunch_evidence_path\b/i },
    { label: "parent launch id", pattern: /\bparent_launch_id\b/i },
    { label: "liveness handle", pattern: /\bliveness_handle\b/i },
    { label: "status writer", pattern: /\bstatus_writer\b/i },
  ];
  for (const check of required) {
    if (!check.pattern.test(raw)) add("blocker", "prompt_legacy_child_contract_incomplete", `legacy child artifact contract missing ${check.label}: ${linkedPath}`, statusFile);
  }
}

function parsePromptIoPolicy(raw: string): { present: boolean; attrs: Record<string, string> } {
  const match = /<io_policy\b([^>]*)\/?>/i.exec(raw);
  return match ? { present: true, attrs: parseTagAttrs(match[1]) } : { present: false, attrs: {} };
}

function parsePromptChildArtifactContract(raw: string): { present: boolean; attrs: Record<string, string> } {
  const match = /<child_artifact_contract\b([^>]*)\/?>/i.exec(raw);
  return match ? { present: true, attrs: parseTagAttrs(match[1]) } : { present: false, attrs: {} };
}

function validateCompactChildArtifactContract(
  attrs: Record<string, string>,
  linkedPath: string,
  statusFile: string,
  expectedPaths: ExpectedPromptPaths,
  add: AddFinding,
  sameArtifactPath: SameArtifactPath,
) {
  const required: Record<string, string> = {
    ref: "dispatch-child-artifact.v2",
    status_owner: "parent_or_supervisor",
    child_writes: "report_only",
    no_seed_mutation: ".seeds/**",
    command_wrapper: "repo-native",
    no_parent_transcript_polling: "true",
    preserve_dirty_paths: "required",
    dispatcher_owned_seed_state: "cli_only",
  };
  for (const [attr, expected] of Object.entries(required)) {
    const actual = attrs[attr];
    if (!actual) {
      add("blocker", "prompt_child_contract_missing_attr", `child_artifact_contract missing ${attr}: ${linkedPath}`, statusFile);
    } else if (actual !== expected) {
      add("blocker", "prompt_child_contract_attr_mismatch", `child_artifact_contract ${attr}=${actual} does not match ${expected}: ${linkedPath}`, statusFile);
    }
  }
  const reportPath = attrs.report_path;
  if (!reportPath) {
    add("blocker", "prompt_child_contract_missing_attr", `child_artifact_contract missing report_path: ${linkedPath}`, statusFile);
  } else if (expectedPaths?.reportPath && !sameArtifactPath(reportPath, expectedPaths.reportPath)) {
    add("blocker", "prompt_report_path_mismatch", `child_artifact_contract report_path ${reportPath} does not match status ${expectedPaths.reportPath}`, statusFile);
  }
  for (const attr of ["dirty_baseline", "allowed_write_roots"]) {
    if (!attrs[attr]) add("blocker", "prompt_child_contract_missing_attr", `child_artifact_contract missing ${attr}: ${linkedPath}`, statusFile);
  }
}

function validatePromptIoPolicy(ioPolicy: { present: boolean; attrs: Record<string, string> }, linkedPath: string, statusFile: string, add: AddFinding) {
  if (!ioPolicy.present) {
    add("blocker", "prompt_missing_io_policy", `prompt missing io_policy: ${linkedPath}`, statusFile);
    return;
  }
  for (const attr of IO_POLICY_PATH_ATTRS) {
    if (!ioPolicy.attrs[attr]) add("blocker", "prompt_missing_io_path", `prompt io_policy missing ${attr}: ${linkedPath}`, statusFile);
  }
  const noPolling = ioPolicy.attrs.no_parent_transcript_polling;
  if (!noPolling) {
    add("blocker", "prompt_missing_io_policy_attr", `prompt io_policy missing no_parent_transcript_polling: ${linkedPath}`, statusFile);
  } else if (noPolling !== "true") {
    add("blocker", "prompt_io_policy_attr_mismatch", `prompt io_policy no_parent_transcript_polling=${noPolling} does not match true: ${linkedPath}`, statusFile);
  }
}

function parsePromptPreserveDirtyPaths(raw: string): { present: boolean; attrs: Record<string, string> } {
  const match = /<preserve_dirty_paths\b([^>]*)\/?>/i.exec(raw);
  return match ? { present: true, attrs: parseTagAttrs(match[1]) } : { present: false, attrs: {} };
}

function validatePromptPreserveDirtyPaths(preserveDirtyPaths: { present: boolean; attrs: Record<string, string> }, linkedPath: string, statusFile: string, add: AddFinding) {
  if (!preserveDirtyPaths.present) {
    add("blocker", "prompt_missing_preserve_dirty_paths", `prompt missing preserve_dirty_paths: ${linkedPath}`, statusFile);
    return;
  }
  for (const attr of ["dirty_baseline", "allowed_write_roots"]) {
    if (!preserveDirtyPaths.attrs[attr]) add("blocker", "prompt_preserve_dirty_paths_missing_attr", `preserve_dirty_paths missing ${attr}: ${linkedPath}`, statusFile);
  }
  const seedState = preserveDirtyPaths.attrs.dispatcher_owned_seed_state;
  if (!seedState) {
    add("blocker", "prompt_preserve_dirty_paths_missing_attr", `preserve_dirty_paths missing dispatcher_owned_seed_state: ${linkedPath}`, statusFile);
  } else if (seedState !== "cli_only") {
    add("blocker", "prompt_preserve_dirty_paths_attr_mismatch", `preserve_dirty_paths dispatcher_owned_seed_state=${seedState} does not match cli_only: ${linkedPath}`, statusFile);
  }
}

function promptIoPaths(attrs: Record<string, string>): Record<string, string> {
  const paths: Record<string, string> = {};
  for (const attr of IO_POLICY_PATH_ATTRS) {
    if (attrs[attr]) paths[attr] = attrs[attr];
  }
  return paths;
}

function parsePromptLaunchProvenance(raw: string): Record<string, string | boolean> {
  const match = /<launch_provenance\b([^>]*)>/i.exec(raw);
  if (!match) return { present: false };
  const data: Record<string, string | boolean> = { present: true };
  const attrs = parseTagAttrs(match[1]);
  for (const attr of ["parent_launch_id", "launch_evidence_path"]) {
    if (attrs[attr]) data[attr] = attrs[attr];
  }
  return data;
}

function parseTagAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(/([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(["'])(.*?)\2/g)) {
    attrs[match[1]] = match[3];
  }
  return attrs;
}

function requirePromptIoPath(
  attr: string,
  expected: string | undefined,
  ioPaths: Record<string, string>,
  mismatchCode: string,
  linkedPath: string,
  statusFile: string,
  add: AddFinding,
  sameArtifactPath: SameArtifactPath,
) {
  if (!expected) return;
  const actual = ioPaths[attr];
  if (!actual) {
    add("blocker", "prompt_missing_io_path", `prompt io_policy missing ${attr}: ${linkedPath}`, statusFile);
  } else if (!sameArtifactPath(actual, expected)) {
    add("blocker", mismatchCode, `prompt io_policy ${attr} ${actual} does not match status ${expected}`, statusFile);
  }
}

function parseReportPathLine(raw: string): string | undefined {
  return /^\s*Report path:\s*(\S+)\s*$/im.exec(raw)?.[1];
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}
