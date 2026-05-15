---
name: cleanup-codex
description: Use when Codex Desktop feels slow due to thread metadata bloat or oversized telemetry logs.
---

# cleanup-codex

Diagnose and fix the two most common sources of Codex Desktop slowness: bloated thread titles/previews in `state_5.sqlite` and oversized `logs_2.sqlite` telemetry files.

## Safety Rules

- First run is always report-only. Do not pass `--apply` until the user has seen the report.
- Codex must not be running when applying changes. The script exits if it detects a running Codex process.
- Back up `state_5.sqlite` via `VACUUM INTO` before any mutation.
- Archive log files instead of deleting them.
- Never touch session conversation files, config.toml, worktrees, or credentials.

## Workflow

Use the script from this skill directory. In the commands below,
`<cleanup-codex-skill-dir>` is the directory that contains this `SKILL.md`.

1. Run report mode:

```bash
bun <cleanup-codex-skill-dir>/scripts/cleanup-codex.ts
```

2. Summarize the output: thread metadata candidates (count, total excess chars, max lengths) and log file size.

3. If the user wants to apply, ask them to close Codex Desktop, then run:

```bash
bun <cleanup-codex-skill-dir>/scripts/cleanup-codex.ts --apply
```

4. Re-run report mode to verify the fix took effect.

## What Apply Does

- Backs up `state_5.sqlite` to the backup directory.
- Trims oversized `threads.title` values to 120 characters and `threads.first_user_message` values to 240 characters.
- Writes a repair manifest (`thread-metadata-repairs.jsonl`) with old/new values for reversal.
- Appends shortened titles to `session_index.jsonl` so the sidebar reflects the new names.
- Moves `logs_2.sqlite*` files into `~/.codex/archived_logs/cleanup-codex-{timestamp}/`.

## What This Skill Does NOT Do

- Archive or move session conversation files.
- Prune config.toml project entries.
- Handle worktrees.
- Normalize Windows extended paths.
- Kill processes.

## CLI Reference

| Flag | Default | Description |
|------|---------|-------------|
| `--apply` | off | Mutate. Without this flag the script only reports. |
| `--codex-home PATH` | `~/.codex` | Override Codex home directory. Respects `CODEX_HOME` env var. |
| `--title-limit N` | 120 | Max characters for thread titles. |
| `--preview-limit N` | 240 | Max characters for first_user_message previews. |
| `--log-threshold-mb N` | 64 | Rotate logs_2.sqlite when total size exceeds this. |
