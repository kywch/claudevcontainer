#!/usr/bin/env bun
// Focused Codex local-state maintenance: thread metadata repair + log rotation.
// Default mode is a read-only report. Use --apply to mutate.

import { Database } from "bun:sqlite";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { execSync } from "node:child_process";

const DEFAULT_TITLE_LIMIT = 120;
const DEFAULT_PREVIEW_LIMIT = 240;
const DEFAULT_LOG_THRESHOLD_MB = 64;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

type Args = {
  apply: boolean;
  codexHome: string;
  titleLimit: number;
  previewLimit: number;
  logThresholdMb: number;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    apply: false,
    codexHome: process.env.CODEX_HOME || join(homedir(), ".codex"),
    titleLimit: DEFAULT_TITLE_LIMIT,
    previewLimit: DEFAULT_PREVIEW_LIMIT,
    logThresholdMb: DEFAULT_LOG_THRESHOLD_MB,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") {
      args.apply = true;
    } else if (a === "--codex-home") {
      args.codexHome = argv[++i];
    } else if (a === "--title-limit") {
      args.titleLimit = Number(argv[++i]);
    } else if (a === "--preview-limit") {
      args.previewLimit = Number(argv[++i]);
    } else if (a === "--log-threshold-mb") {
      args.logThresholdMb = Number(argv[++i]);
    } else if (a === "-h" || a === "--help") {
      console.log(
        "usage: cleanup-codex.ts [--apply] [--codex-home PATH] [--title-limit N] [--preview-limit N] [--log-threshold-mb N]",
      );
      process.exit(0);
    } else {
      console.error(`unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function backupRoot(): string {
  const docs = join(homedir(), "Documents", "Codex", "codex-backups");
  const docsParent = join(homedir(), "Documents", "Codex");
  if (existsSync(docsParent)) return docs;
  return join(homedir(), ".codex", "backups");
}

function codexIsRunning(): boolean {
  try {
    if (process.platform === "win32") {
      const out = execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object Name,ProcessId,CommandLine | ConvertTo-Json -Compress"',
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      );
      if (!out.trim()) return false;
      const rows = JSON.parse(out);
      const list = Array.isArray(rows) ? rows : [rows];
      return list.some((r: any) => {
        const name = String(r.Name ?? "");
        const cmd = String(r.CommandLine ?? "");
        return (
          name === "Codex.exe" ||
          (name === "codex.exe" &&
            (cmd.includes("app-server") || cmd.includes("OpenAI.Codex")))
        );
      });
    }
    const out = execSync("ps -axo pid=,comm=,args=", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return out.split("\n").some((line) => {
      const l = line.toLowerCase();
      return (
        l.includes("codex") &&
        (l.includes("app-server") ||
          l.includes("openai.codex") ||
          l.includes("codex desktop"))
      );
    });
  } catch {
    return false;
  }
}

function boundedText(value: string, limit: number): string {
  const text = value.split(/\s+/).join(" ");
  if (text.length <= limit) return text;
  if (limit <= 3) return text.slice(0, limit);
  return text.slice(0, limit - 3).trimEnd() + "...";
}

function tableColumns(db: Database, table: string): Set<string> {
  const rows = db.prepare(`pragma table_info("${table}")`).all() as {
    name: string;
  }[];
  return new Set(rows.map((r) => r.name));
}

// ---------------------------------------------------------------------------
// Diagnose threads
// ---------------------------------------------------------------------------

type Repair = {
  threadId: string;
  oldTitle: string;
  newTitle: string;
  oldPreview: string;
  newPreview: string;
};

function diagnoseThreads(
  codexHome: string,
  titleLimit: number,
  previewLimit: number,
): Repair[] {
  const dbPath = join(codexHome, "state_5.sqlite");
  if (!existsSync(dbPath)) {
    console.log("thread_metadata skipped (state_5.sqlite not found)");
    return [];
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const cols = tableColumns(db, "threads");
    if (!cols.has("id") || !cols.has("title")) {
      console.log("thread_metadata skipped (missing id/title columns)");
      return [];
    }

    const hasPreview = cols.has("first_user_message");
    const archivedExpr = cols.has("archived")
      ? "COALESCE(archived,0)=0"
      : "archived_at is null";

    // summary stats
    const summarySQL = hasPreview
      ? `select count(*) as cnt,
           coalesce(sum(length(title)),0) as tc,
           coalesce(sum(length(first_user_message)),0) as pc,
           coalesce(max(length(title)),0) as mt,
           coalesce(max(length(first_user_message)),0) as mp,
           sum(case when length(title)>${titleLimit} then 1 else 0 end) as tov,
           sum(case when length(first_user_message)>${previewLimit} then 1 else 0 end) as pov
         from threads where ${archivedExpr}`
      : `select count(*) as cnt,
           coalesce(sum(length(title)),0) as tc, 0 as pc,
           coalesce(max(length(title)),0) as mt, 0 as mp,
           sum(case when length(title)>${titleLimit} then 1 else 0 end) as tov, 0 as pov
         from threads where ${archivedExpr}`;

    const s = db.prepare(summarySQL).get() as any;
    console.log(`thread_active_rows ${s.cnt}`);
    console.log(`thread_title_chars ${s.tc}`);
    console.log(`thread_preview_chars ${s.pc}`);
    console.log(`thread_max_title_len ${s.mt}`);
    console.log(`thread_max_preview_len ${s.mp}`);
    console.log(`thread_titles_over_limit ${s.tov ?? 0}`);
    console.log(`thread_previews_over_limit ${s.pov ?? 0}`);

    // find repair candidates
    const selectPreview = hasPreview ? "first_user_message" : "''";
    const wherePreview = hasPreview
      ? `or length(first_user_message)>${previewLimit}`
      : "";
    const previewAlias = hasPreview ? "first_user_message as preview" : "'' as preview";
    const rows = db
      .prepare(
        `select id, title, ${previewAlias} from threads
         where ${archivedExpr} and (length(title)>${titleLimit} ${wherePreview})`,
      )
      .all() as { id: string; title: string; preview: string }[];

    const repairs: Repair[] = [];
    for (const row of rows) {
      const oldTitle = row.title ?? "";
      const oldPreview = row.preview ?? "";
      const newTitle = boundedText(oldTitle, titleLimit);
      const newPreview = hasPreview
        ? boundedText(oldPreview, previewLimit)
        : "";
      if (newTitle !== oldTitle || newPreview !== oldPreview) {
        repairs.push({
          threadId: String(row.id),
          oldTitle,
          newTitle,
          oldPreview,
          newPreview,
        });
      }
    }

    console.log(`thread_repair_candidates ${repairs.length}`);
    return repairs;
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Diagnose logs
// ---------------------------------------------------------------------------

function diagnoseLogs(
  codexHome: string,
  thresholdMb: number,
): { totalMb: number; files: string[] } {
  const files: string[] = [];
  let total = 0;
  try {
    for (const name of readdirSync(codexHome)) {
      if (name.startsWith("logs_2.sqlite")) {
        const full = join(codexHome, name);
        const sz = statSync(full).size;
        total += sz;
        files.push(full);
      }
    }
  } catch {
    /* codex home may not exist */
  }
  console.log(`logs_total_mb ${mb(total)}`);
  console.log(
    `logs_over_threshold ${total > thresholdMb * 1024 * 1024 ? "yes" : "no"}`,
  );
  return { totalMb: total / 1024 / 1024, files };
}

// ---------------------------------------------------------------------------
// Apply: thread repair
// ---------------------------------------------------------------------------

function applyThreadRepair(
  codexHome: string,
  backupDir: string,
  repairs: Repair[],
): void {
  if (repairs.length === 0) return;

  const dbPath = join(codexHome, "state_5.sqlite");

  // backup via VACUUM INTO
  const backupPath = join(backupDir, "state_5.sqlite");
  {
    const src = new Database(dbPath, { readonly: true });
    src.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
    src.close();
  }
  console.log(`backed_up state_5.sqlite -> ${backupPath}`);

  // write manifest
  const manifest = join(backupDir, "thread-metadata-repairs.jsonl");
  const lines = repairs.map((r) =>
    JSON.stringify({
      thread_id: r.threadId,
      old_title: r.oldTitle,
      new_title: r.newTitle,
      old_first_user_message: r.oldPreview,
      new_first_user_message: r.newPreview,
    }),
  );
  writeFileSync(manifest, lines.join("\n") + "\n", "utf-8");

  // update threads
  const db = new Database(dbPath);
  const cols = tableColumns(db, "threads");
  const hasPreview = cols.has("first_user_message");
  db.exec("pragma busy_timeout=10000");

  const tx = db.transaction(() => {
    for (const r of repairs) {
      if (hasPreview) {
        db.prepare(
          "update threads set title=?, first_user_message=? where id=?",
        ).run(r.newTitle, r.newPreview, r.threadId);
      } else {
        db.prepare("update threads set title=? where id=?").run(
          r.newTitle,
          r.threadId,
        );
      }
    }
  });
  tx();
  db.close();

  // append to session_index.jsonl
  const indexPath = join(codexHome, "session_index.jsonl");
  for (const r of repairs) {
    if (r.newTitle && r.newTitle !== r.oldTitle) {
      const entry = JSON.stringify({
        id: r.threadId,
        thread_name: r.newTitle,
        updated_at: new Date().toISOString(),
      });
      appendFileSync(indexPath, entry + "\n", "utf-8");
    }
  }

  console.log(`thread_repair applied ${repairs.length} threads`);
  console.log(`thread_repair manifest ${manifest}`);
}

// ---------------------------------------------------------------------------
// Apply: log rotation
// ---------------------------------------------------------------------------

function applyLogRotation(
  codexHome: string,
  files: string[],
  ts: string,
): void {
  if (files.length === 0) return;
  const archiveDir = join(codexHome, "archived_logs", `cleanup-codex-${ts}`);
  mkdirSync(archiveDir, { recursive: true });
  for (const f of files) {
    const dest = join(archiveDir, basename(f));
    renameSync(f, dest);
  }
  console.log(`logs_rotated ${files.length} files -> ${archiveDir}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs();

  console.log(`mode ${args.apply ? "apply" : "report"}`);
  console.log(`codex_home ${args.codexHome}`);

  const repairs = diagnoseThreads(
    args.codexHome,
    args.titleLimit,
    args.previewLimit,
  );
  const logs = diagnoseLogs(args.codexHome, args.logThresholdMb);

  if (!args.apply) {
    console.log("done (report only, re-run with --apply to fix)");
    return;
  }

  // gate: codex must not be running
  if (codexIsRunning()) {
    console.error("ERROR: Codex is running. Close it before applying.");
    process.exit(1);
  }

  const ts = stamp();
  const bkRoot = join(backupRoot(), `cleanup-codex-${ts}`);
  mkdirSync(bkRoot, { recursive: true });
  console.log(`backup_root ${bkRoot}`);

  applyThreadRepair(args.codexHome, bkRoot, repairs);

  if (logs.totalMb > args.logThresholdMb) {
    applyLogRotation(args.codexHome, logs.files, ts);
  }

  console.log("done");
}

main();
