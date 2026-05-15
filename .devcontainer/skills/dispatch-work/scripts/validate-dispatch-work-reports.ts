import { readFileSync } from "node:fs";
import { sep } from "node:path";
import { ACCEPTED_GATE_DECISIONS, REPORT_SUMMARY_NEXT_ACTIONS, isLocalDoneDecision } from "./dispatch-work-contracts.ts";
import { isReportFilename, reportRoleFromFilename } from "./dispatch-work-paths.ts";

type Level = "blocker" | "warning";

type AddFinding = (level: Level, code: string, message: string, path?: string) => void;

export type ReportRecord = {
  path: string;
  role: "execute" | "implement" | "review" | "verify";
  verdict?: string;
  outcome?: string;
  recommendation?: string;
  summary?: ReportSummary;
};

export type ReportRole = ReportRecord["role"];

type ReportSummary = {
  keys: string[];
  values: Record<string, string>;
};

const IMPLEMENT_OUTCOMES = new Set(["done", "failed"]);
const REPORT_VERDICTS = new Set(["pass", "block", "risk"]);
export const RECOMMENDATIONS = new Set(ACCEPTED_GATE_DECISIONS);
export const REQUIRED_ROLES: ReportRole[] = ["execute", "implement", "review", "verify"];
const REQUIRED_REPORT_SUMMARY_KEYS = ["status", "changed_files", "tests", "blockers", "next_action"];
const REPORT_SUMMARY_STATUS_VALUES = new Set(["pass", "risk", "block", "done", "failed"]);
const REPORT_SUMMARY_NEXT_ACTION_VALUES = new Set(REPORT_SUMMARY_NEXT_ACTIONS);

export function isReportFile(file: string): boolean {
  const base = file.split(sep).pop() ?? "";
  return isReportFilename(base);
}

export function parseReport(file: string): ReportRecord | undefined {
  const base = file.split(sep).pop() ?? "";
  const role = reportRoleFromFilename(base);
  if (!role) return undefined;
  const raw = readFileSync(file, "utf8");
  const field = (name: string) => {
    const match = new RegExp(`^\\s*${name}\\s*:\\s*([A-Za-z_-]+)\\s*$`, "im").exec(raw);
    return match?.[1]?.toLowerCase();
  };
  return {
    path: file,
    role,
    verdict: field("verdict"),
    outcome: field("outcome"),
    recommendation: field("recommendation"),
    summary: parseReportSummary(raw),
  };
}

export function validateReport(report: ReportRecord, add: AddFinding) {
  validateReportSummary(report, add);
  if (report.role === "implement") {
    if (!report.outcome) add("blocker", "missing_report_outcome", "Implement report missing Outcome", report.path);
    else if (!IMPLEMENT_OUTCOMES.has(report.outcome)) add("blocker", "invalid_report_outcome", `invalid Implement outcome ${report.outcome}`, report.path);
  } else {
    if (!report.verdict) add("blocker", "missing_report_verdict", `${report.role} report missing Verdict`, report.path);
    else if (!REPORT_VERDICTS.has(report.verdict)) add("blocker", "invalid_report_verdict", `invalid ${report.role} verdict ${report.verdict}`, report.path);
  }
  if (report.recommendation && !RECOMMENDATIONS.has(report.recommendation)) {
    add("blocker", "invalid_recommendation", `invalid recommendation ${report.recommendation}`, report.path);
  }
}

export function validateReportSummary(report: ReportRecord, add: AddFinding) {
  if (!report.summary) {
    add("blocker", "missing_report_summary", `${report.role} report missing summary block near top`, report.path);
    return;
  }
  const keys = report.summary.keys;
  for (let index = 0; index < REQUIRED_REPORT_SUMMARY_KEYS.length; index += 1) {
    const expected = REQUIRED_REPORT_SUMMARY_KEYS[index];
    const actual = keys[index];
    if (!keys.includes(expected)) add("blocker", "missing_report_summary_key", `${report.role} report summary missing ${expected}`, report.path);
    else if (actual !== expected) add("blocker", "invalid_report_summary_order", `${report.role} report summary key ${expected} must appear at position ${index + 1}`, report.path);
  }
  const status = report.summary.values.status?.toLowerCase();
  if (status && !REPORT_SUMMARY_STATUS_VALUES.has(status)) {
    add("blocker", "invalid_report_summary_value", `${report.role} report summary status ${status} is invalid`, report.path);
  }
  const nextAction = report.summary.values.next_action?.toLowerCase();
  if (nextAction && !REPORT_SUMMARY_NEXT_ACTION_VALUES.has(nextAction)) {
    add("blocker", "invalid_report_summary_value", `${report.role} report summary next_action ${nextAction} is invalid`, report.path);
  }
}

export function parseReportSummary(raw: string): ReportSummary | undefined {
  const keys: string[] = [];
  const values: Record<string, string> = {};
  const lines = raw.split(/\r?\n/).slice(0, 40);
  let inSummary = false;
  for (const line of lines) {
    if (/^\s*#{1,3}\s+summary\s*$/i.test(line) || /^\s*report_summary\s*:\s*$/i.test(line)) {
      inSummary = true;
      continue;
    }
    if (!inSummary) continue;
    if (inSummary && /^\s*#{1,3}\s+\S/.test(line)) break;
    const match = /^\s*(?:[-*]\s*)?(status|changed_files|tests|blockers|next_action)\s*:\s*(\S.*)?$/i.exec(line);
    if (!match) continue;
    if (match[2] === undefined || match[2].trim().length === 0) continue;
    const key = match[1].toLowerCase();
    if (!Object.hasOwn(values, key)) keys.push(key);
    values[key] = match[2].trim();
  }
  return keys.length > 0 ? { keys, values } : undefined;
}

export function validateRequiredRoleReports(reports: ReportRecord[], add: AddFinding, roundPath: string) {
  if (!reports.some((report) => report.role === "execute")) add("blocker", "missing_execute_report", "Execute report missing", roundPath);
  if (!reports.some((report) => report.role === "implement")) add("blocker", "missing_implement_report", "Implement report missing", roundPath);
  if (!reports.some((report) => report.role === "review")) add("blocker", "missing_review_report", "Review report missing", roundPath);
  if (!reports.some((report) => report.role === "verify")) add("blocker", "missing_verify_report", "Verify report missing", roundPath);
  for (const role of ["execute", "implement"] as ReportRole[]) {
    if (reports.filter((report) => report.role === role).length > 1) {
      add("blocker", "ambiguous_role_report", `multiple ${role} reports in selected round`, roundPath);
    }
  }
}

export function validateExecuteCompatibility(reports: ReportRecord[], add: AddFinding) {
  for (const report of reports.filter((item) => item.role === "execute")) {
    if (!report.recommendation) {
      add("blocker", "missing_execute_recommendation", "Execute report missing Recommendation", report.path);
      continue;
    }
    if (isLocalDoneDecision(report.recommendation) && report.verdict !== "pass") {
      add("blocker", "execute_done_without_pass", `Execute recommendation done incompatible with verdict ${report.verdict ?? "<missing>"}`, report.path);
    }
    if (report.verdict === "pass" && !isLocalDoneDecision(report.recommendation)) {
      add("warning", "execute_pass_not_done", `Execute verdict pass with recommendation ${report.recommendation}`, report.path);
    }
  }
}
