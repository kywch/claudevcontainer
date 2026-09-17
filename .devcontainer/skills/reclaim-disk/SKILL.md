---
name: reclaim-disk
description: Scan /workspace and Docker disk usage, then remove only explicitly approved 14+-day secondary Git worktrees, unreferenced 14+-day Docker images, or unreferenced Docker-marked anonymous local volumes. Use for workspace or Docker cleanup audits; never for primary worktree, container, named-volume, or build-cache deletion.
---

# Reclaim Disk

Use bundled scripts for deterministic discovery and mutation. Default to scan mode.

## Scan

Run:

```bash
python3 <skill-dir>/scripts/scan_reclaim.py \
  --workspace /workspace \
  --output /tmp/reclaim-disk-report.json
```

Scanning is read-only. Summarize `eligible`, `review`, and `protected` totals separately. State that Docker image and cache estimates can overlap through shared layers.

Read [references/safety-policy.md](references/safety-policy.md) before proposing deletion. Read [references/report-schema.md](references/report-schema.md) when interpreting JSON or debugging validation.

After scanning, stop and show every exact candidate, reasons or warnings, report path, report SHA-256, and expiry. For worktrees, show path, age, size, branch/detached state, dirty state, and preservation-ref result. Do not summarize away candidates before requesting approval. Do not treat a scan request as deletion permission.

## Delete

Require a later explicit request naming the report SHA-256 and exact target IDs. `all eligible in report <sha256>` is acceptable only after every eligible target was listed; expand it to exact IDs before running the applier. Phrases such as `clean it`, `prune Docker`, or `delete old stuff` are insufficient.

Run only after valid approval:

```bash
python3 <skill-dir>/scripts/apply_reclaim.py \
  --report /tmp/reclaim-disk-report.json \
  --approve <report-sha256> \
  --target <exact-id> \
  --result /tmp/reclaim-disk-result.json
```

Applier accepts only eligible secondary worktrees, old unreferenced Docker images, and anonymous Docker volumes. It revalidates exact path/device/inode and Git state for worktrees; exact image ID or 64-hex volume name, age, references, fingerprint, daemon/context, report hash, plus anonymous label and local driver for volumes. Drift causes a skip. It runs only report-recorded exact commands.

After application, report target outcomes plus measured filesystem free-space delta. Re-scan when requested or when report expired.

## Boundaries

- Docker daemon is global. Only local volumes whose exact 64-lowercase-hex name and `com.docker.volume.anonymous` label both prove anonymous creation can become eligible.
- Docker images become eligible only when at least 14 days old and unreferenced by every container. Tagged and dangling images use same rule.
- Secondary Git worktrees become eligible at 14 days based on HEAD commit age. Dirty, detached, and unpreserved-commit states are explicit warnings, not blockers.
- Primary, locked, active, outside-workspace, missing, or incompletely inspected worktrees are never eligible.
- Docker containers, named volumes, build cache, referenced images, referenced volumes, and current dev-container resources are never eligible.
- Anonymous volumes do not require BenchFlow ownership labels.
- Never invoke Docker prune commands or select targets by prefix, glob, tag, or display name. Multi-tag images may use their complete report-bound exact tag list for removal.
- Fail closed on timeouts, truncated output, missing capabilities, permission gaps, path escape, or incomplete scans.
- Never create a temporary container to inspect a volume without separate user authorization.

Resolve `<skill-dir>` to directory containing this `SKILL.md`. Run non-mutating self-check after skill changes:

```bash
python3 <skill-dir>/scripts/self_check.py
```
