#!/usr/bin/env python3
"""Read-only /workspace and Docker reclaim scanner."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from decimal import Decimal
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
SCANNER_VERSION = "1.4.0"
BENCHFLOW_MANAGED = "io.benchflow.managed"
BENCHFLOW_EPHEMERAL = "io.benchflow.ephemeral"
DOCKER_ANONYMOUS = "com.docker.volume.anonymous"
ANONYMOUS_VOLUME_NAME = re.compile(r"[0-9a-f]{64}")
SENSITIVE_VOLUME = re.compile(
    r"(?:^vscode$|^(?:codex|claude|forge|gemini|cursor)-home-|^gh-config-|history|credential|config|state)",
    re.IGNORECASE,
)


class ScanError(RuntimeError):
    pass


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def canonical_bytes(value: dict[str, Any]) -> bytes:
    payload = dict(value)
    payload.pop("report_sha256", None)
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def report_hash(value: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def run(
    argv: list[str], timeout: float, max_output: int, *, allow_failure: bool = False
) -> subprocess.CompletedProcess[bytes]:
    try:
        result = subprocess.run(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ScanError(f"command failed: {argv[0]}: {exc}") from exc
    if len(result.stdout) + len(result.stderr) > max_output:
        raise ScanError(f"command output exceeded {max_output} bytes: {argv[0]}")
    if result.returncode and not allow_failure:
        detail = result.stderr.decode(errors="replace").strip()[:500]
        raise ScanError(f"command exited {result.returncode}: {argv[0]}: {detail}")
    return result


def text(argv: list[str], timeout: float, max_output: int, *, allow_failure: bool = False) -> str:
    return (
        run(argv, timeout, max_output, allow_failure=allow_failure)
        .stdout.decode(errors="replace")
        .strip()
    )


def git(
    path: str,
    args: list[str],
    timeout: float,
    max_output: int,
    *,
    allow_failure: bool = False,
) -> str:
    return text(["git", "-C", path, *args], timeout, max_output, allow_failure=allow_failure)


def parse_size(value: str) -> int:
    match = re.fullmatch(r"([0-9.]+)([kMGTPE]?B)", value.strip())
    if not match:
        return 0
    scale = {
        "B": 1,
        "kB": 10**3,
        "MB": 10**6,
        "GB": 10**9,
        "TB": 10**12,
        "PB": 10**15,
        "EB": 10**18,
    }
    return int(Decimal(match.group(1)) * scale[match.group(2)])


def within(child: str, parent: str) -> bool:
    try:
        return os.path.commonpath((os.path.realpath(child), parent)) == parent
    except ValueError:
        return False


def path_is_active(path: str, links: set[str]) -> bool:
    real = os.path.realpath(path)
    prefix = real + os.sep
    return any(link == real or link.startswith(prefix) for link in links)


def process_links(max_items: int) -> tuple[set[str], bool, int]:
    links: set[str] = set()
    denied = 0
    seen = 0
    for proc in Path("/proc").glob("[0-9]*"):
        candidates = [proc / "cwd", proc / "root"]
        try:
            candidates.extend((proc / "fd").iterdir())
        except (FileNotFoundError, PermissionError):
            denied += 1
        for candidate in candidates:
            seen += 1
            if seen > max_items:
                return links, False, denied
            try:
                target = os.path.realpath(os.readlink(candidate))
            except (FileNotFoundError, PermissionError, OSError):
                continue
            if target.startswith("/workspace/") or target == "/workspace":
                links.add(target.removesuffix(" (deleted)"))
    return links, denied == 0, denied


def worktree_records(raw: str) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    current: dict[str, str] = {}
    for line in raw.splitlines() + [""]:
        if not line:
            if current:
                records.append(current)
                current = {}
            continue
        key, _, value = line.partition(" ")
        current[key] = value or "true"
    return records


def add_error(report: dict[str, Any], section: str, message: str, *, fatal: bool = True) -> None:
    if len(report["errors"]) < 100:
        report["errors"].append({"section": section, "message": message[:1000]})
    if fatal:
        report["complete"] = False


def scan_git(
    report: dict[str, Any],
    workspace: str,
    args: argparse.Namespace,
    active: set[str],
    active_complete: bool,
) -> None:
    try:
        raw = run(
            ["find", workspace, "-xdev", "-name", ".git", "-print0"],
            args.command_timeout,
            args.max_output_bytes,
        ).stdout
    except ScanError as exc:
        add_error(report, "git", str(exc))
        return
    markers = [item.decode(errors="surrogateescape") for item in raw.split(b"\0") if item]
    if len(markers) > args.max_items:
        add_error(report, "git", "Git marker count exceeded item limit")
        return

    groups: dict[str, str] = {}
    for marker in markers:
        repo = os.path.dirname(marker)
        try:
            common = git(
                repo,
                ["rev-parse", "--path-format=absolute", "--git-common-dir"],
                args.command_timeout,
                args.max_output_bytes,
            )
            groups.setdefault(os.path.realpath(common), repo)
        except ScanError as exc:
            add_error(report, "git", f"ignored marker {repo}: {exc}", fatal=False)

    now_ts = utc_now().timestamp()
    for common, repo in sorted(groups.items()):
        try:
            records = worktree_records(
                git(
                    repo,
                    ["worktree", "list", "--porcelain"],
                    args.command_timeout,
                    args.max_output_bytes,
                )
            )
        except ScanError as exc:
            add_error(report, "git", f"{repo}: {exc}", fatal=False)
            continue
        if len(records) > args.max_items:
            add_error(
                report,
                "git",
                f"{repo}: worktree count exceeded item limit",
                fatal=False,
            )
            continue
        if len(records) < 2:
            continue
        primary = os.path.realpath(records[0].get("worktree", "")) if records else ""
        for record in records[1:]:
            path = record.get("worktree", "")
            real = os.path.realpath(path)
            reasons: list[str] = []
            warnings: list[str] = []
            blockers: list[str] = []
            resource: dict[str, Any] = {
                "id": "git-worktree:" + hashlib.sha256(real.encode()).hexdigest()[:20],
                "kind": "git_worktree",
                "locator": {"path": path, "realpath": real, "admin_repo": primary},
                "estimated_bytes": 0,
                "reason_keys": reasons,
            }
            if not path or not within(real, workspace) or real == workspace:
                reasons.append("path_outside_workspace")
                blockers.append("path_outside_workspace")
            if real == primary:
                reasons.append("primary_worktree")
                blockers.append("primary_worktree")
            if "locked" in record:
                reasons.append("locked")
                blockers.append("locked")
            if "prunable" in record:
                reasons.append("prunable_registration")
                blockers.append("prunable_registration")
            if not os.path.isdir(real):
                reasons.append("missing_path")
                blockers.append("missing_path")
                resource["class"] = "protected"
                resource["fingerprint"] = {"common_dir": common}
                report["resources"].append(resource)
                continue
            try:
                stat = os.stat(real, follow_symlinks=False)
                resource["fingerprint"] = {
                    "device": stat.st_dev,
                    "inode": stat.st_ino,
                    "common_dir": common,
                }
                size_raw = text(
                    ["du", "-sx", "-B1", "--", real],
                    args.command_timeout,
                    args.max_output_bytes,
                )
                resource["estimated_bytes"] = int(size_raw.split()[0])
                head = git(real, ["rev-parse", "HEAD"], args.command_timeout, args.max_output_bytes)
                branch = git(
                    real,
                    ["symbolic-ref", "-q", "HEAD"],
                    args.command_timeout,
                    args.max_output_bytes,
                    allow_failure=True,
                )
                commit_ts = int(
                    git(
                        real,
                        ["show", "-s", "--format=%ct", "HEAD"],
                        args.command_timeout,
                        args.max_output_bytes,
                    )
                )
                status = run(
                    ["git", "-C", real, "status", "--porcelain=v1", "-z", "--untracked-files=all"],
                    args.command_timeout,
                    args.max_output_bytes,
                ).stdout
                ignored_raw = run(
                    ["git", "-C", real, "status", "--porcelain=v1", "-z", "--ignored=matching"],
                    args.command_timeout,
                    args.max_output_bytes,
                ).stdout
                entries = [item for item in status.split(b"\0") if item]
                ignored = [item for item in ignored_raw.split(b"\0") if item.startswith(b"!!")]
                dirty = bool(entries)
                if dirty:
                    warnings.append("dirty")
                if not branch:
                    warnings.append("detached_head")
                branch_head = ""
                if branch:
                    branch_head = git(
                        real, ["rev-parse", branch], args.command_timeout, args.max_output_bytes
                    )
                    if branch_head != head:
                        reasons.append("branch_head_mismatch")
                default_ref = git(
                    real,
                    ["symbolic-ref", "-q", "refs/remotes/origin/HEAD"],
                    args.command_timeout,
                    args.max_output_bytes,
                    allow_failure=True,
                )
                if not default_ref:
                    for candidate in ("refs/heads/main", "refs/heads/master"):
                        probe = git(
                            real,
                            ["show-ref", "--verify", "--hash", candidate],
                            args.command_timeout,
                            args.max_output_bytes,
                            allow_failure=True,
                        )
                        if probe:
                            default_ref = candidate
                            break
                upstream = git(
                    real,
                    ["rev-parse", "--symbolic-full-name", "@{upstream}"],
                    args.command_timeout,
                    args.max_output_bytes,
                    allow_failure=True,
                )
                preserving_refs: list[str] = []
                for candidate in dict.fromkeys((default_ref, upstream)):
                    if not candidate:
                        continue
                    contains = run(
                        ["git", "-C", real, "merge-base", "--is-ancestor", head, candidate],
                        args.command_timeout,
                        args.max_output_bytes,
                        allow_failure=True,
                    )
                    if contains.returncode == 0:
                        preserving_refs.append(candidate)
                if not preserving_refs:
                    warnings.append("head_not_on_default_or_upstream")
                age_days = max(0, int((now_ts - commit_ts) // 86400))
                if age_days < args.worktree_min_age_days:
                    reasons.append("too_recent")
                    blockers.append("too_recent")
                active_here = path_is_active(real, active)
                if active_here:
                    reasons.append("active_process")
                    blockers.append("active_process")
                if not active_complete:
                    warnings.append("process_visibility_incomplete")
                resource.update(
                    {
                        "commit_time": iso(dt.datetime.fromtimestamp(commit_ts, dt.timezone.utc)),
                        "age_days": age_days,
                        "git": {
                            "head": head,
                            "branch": branch or None,
                            "branch_head": branch_head or None,
                            "default_ref": default_ref or None,
                            "upstream": upstream or None,
                            "preserving_refs": preserving_refs,
                            "status_entries": len(entries),
                            "ignored_entries": len(ignored),
                            "active": active_here,
                            "process_visibility_complete": active_complete,
                        },
                        "warning_keys": warnings,
                    }
                )
                resource["fingerprint"].update(
                    {
                        "head": head,
                        "branch": branch or None,
                        "status_sha256": hashlib.sha256(status).hexdigest(),
                        "ignored_sha256": hashlib.sha256(ignored_raw).hexdigest(),
                    }
                )
                eligible = not blockers
                resource["class"] = "eligible" if eligible else "protected"
                if eligible:
                    resource["proposed_argv"] = [
                        "git",
                        "-C",
                        primary,
                        "worktree",
                        "remove",
                        "--force",
                        path,
                    ]
            except (ScanError, OSError, ValueError) as exc:
                reasons.append("inspection_failed")
                resource["class"] = "protected"
                resource["inspection_error"] = str(exc)[:1000]
                add_error(report, "git", f"{real}: {exc}", fatal=False)
            report["resources"].append(resource)


def docker_batches(
    command: list[str], values: list[str], args: argparse.Namespace
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for start in range(0, len(values), 100):
        raw = text(
            [*command, *values[start : start + 100]],
            args.command_timeout,
            args.max_output_bytes,
        )
        parsed = json.loads(raw or "[]")
        if isinstance(parsed, dict):
            parsed = [parsed]
        items.extend(parsed)
    return items


def docker_labels_owned(labels: Any) -> bool:
    labels = labels or {}
    return (
        str(labels.get(BENCHFLOW_MANAGED, "")).lower() == "true"
        and str(labels.get(BENCHFLOW_EPHEMERAL, "")).lower() == "true"
    )


def is_anonymous_volume(name: str, labels: Any) -> bool:
    """Recognize only Docker-marked, engine-generated anonymous volume names."""
    return ANONYMOUS_VOLUME_NAME.fullmatch(name) is not None and DOCKER_ANONYMOUS in (labels or {})


def public_docker_labels(labels: Any) -> dict[str, str]:
    return {
        str(key): str(value)
        for key, value in (labels or {}).items()
        if str(key).startswith("io.benchflow.") or str(key) == DOCKER_ANONYMOUS
    }


def docker_created(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def docker_image_remove_argv(ident: str, tags: list[str]) -> list[str]:
    """Use exact tags when an image ID has multiple repository references."""
    return ["docker", "image", "rm", *(tags if len(tags) > 1 else [ident])]


def docker_df(
    timeout: float, max_output: int
) -> tuple[dict[str, Any], dict[str, int], dict[str, int]]:
    raw = text(["docker", "system", "df", "-v"], timeout, max_output)
    summary: dict[str, Any] = {}
    volume_sizes: dict[str, int] = {}
    image_unique_sizes: dict[str, int] = {}
    section = ""
    for line in raw.splitlines():
        if line.endswith("space usage:"):
            section = line.split()[0].lower()
            continue
        fields = line.split()
        if section == "images" and len(fields) >= 9 and fields[2] != "IMAGE":
            image_unique_sizes[fields[2]] = parse_size(fields[-2])
        if section == "local" and len(fields) == 3 and fields[1].isdigit():
            volume_sizes[fields[0]] = parse_size(fields[2])
    brief = text(
        ["docker", "system", "df", "--format", "{{json .}}"],
        timeout,
        max_output,
        allow_failure=True,
    )
    rows = []
    for line in brief.splitlines():
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    summary["rows"] = rows
    return summary, volume_sizes, image_unique_sizes


def scan_docker(report: dict[str, Any], args: argparse.Namespace) -> None:
    if not shutil.which("docker"):
        report["docker"] = {"available": False}
        add_error(report, "docker", "docker executable unavailable")
        return
    try:
        context = text(["docker", "context", "show"], args.command_timeout, args.max_output_bytes)
        info = json.loads(
            text(
                ["docker", "info", "--format", "{{json .}}"],
                args.command_timeout,
                args.max_output_bytes,
            )
        )
        daemon_id = str(info.get("ID", ""))
        df_summary, volume_sizes, image_unique_sizes = docker_df(
            args.docker_df_timeout, args.max_output_bytes
        )
        report["docker"] = {
            "available": True,
            "context": context,
            "daemon_id": daemon_id,
            "root_dir": info.get("DockerRootDir"),
            "global_scope_warning": True,
            "disk_summary": df_summary,
        }

        container_ids = sorted(
            set(
                text(
                    ["docker", "container", "ls", "-aq", "--no-trunc"],
                    args.command_timeout,
                    args.max_output_bytes,
                ).splitlines()
            )
        )
        image_ids = sorted(
            set(
                text(
                    ["docker", "image", "ls", "-aq", "--no-trunc"],
                    args.command_timeout,
                    args.max_output_bytes,
                ).splitlines()
            )
        )
        volume_names = sorted(
            set(
                text(
                    ["docker", "volume", "ls", "-q"],
                    args.command_timeout,
                    args.max_output_bytes,
                ).splitlines()
            )
        )
        if max(len(container_ids), len(image_ids), len(volume_names)) > args.max_items:
            raise ScanError("Docker resource count exceeded item limit")

        containers = docker_batches(
            ["docker", "container", "inspect", "--size"], container_ids, args
        )
        images = docker_batches(["docker", "image", "inspect"], image_ids, args)
        volumes = docker_batches(["docker", "volume", "inspect"], volume_names, args)
        image_refs = {str(item.get("Image", "")) for item in containers}
        volume_refs = {
            str(mount.get("Name", ""))
            for item in containers
            for mount in item.get("Mounts", [])
            if mount.get("Type") == "volume"
        }
        now = utc_now()

        for item in containers:
            ident = str(item.get("Id", ""))
            labels = item.get("Config", {}).get("Labels") or {}
            status = str(item.get("State", {}).get("Status", "unknown"))
            created = docker_created(str(item["Created"]))
            age_days = max(0, (now - created).days)
            owned = docker_labels_owned(labels)
            reasons: list[str] = []
            if status != "exited":
                reasons.append("container_not_exited")
            if not owned:
                reasons.append("ownership_labels_missing")
            if age_days < args.min_age_days:
                reasons.append("too_recent")
            reasons.append("cleanup_not_supported")
            report["resources"].append(
                {
                    "id": f"docker-container:{ident}",
                    "kind": "docker_container",
                    "class": "protected",
                    "reason_keys": reasons,
                    "locator": {"id": ident, "name": str(item.get("Name", "")).lstrip("/")},
                    "fingerprint": {
                        "created": item["Created"],
                        "image": item.get("Image"),
                        "daemon_id": daemon_id,
                    },
                    "created_at": iso(created),
                    "age_days": age_days,
                    "estimated_bytes": int(item.get("SizeRw") or 0),
                    "docker": {
                        "status": status,
                        "owned": owned,
                        "labels": public_docker_labels(labels),
                    },
                }
            )

        for item in images:
            ident = str(item.get("Id", ""))
            labels = item.get("Config", {}).get("Labels") or {}
            tags = item.get("RepoTags") or []
            dangling = not tags
            referenced = ident in image_refs
            created = docker_created(str(item["Created"]))
            age_days = max(0, (now - created).days)
            owned = docker_labels_owned(labels)
            reasons: list[str] = []
            if referenced:
                reasons.append("container_reference")
            if age_days < args.image_min_age_days:
                reasons.append("too_recent")
            eligible = not reasons
            unique_size = image_unique_sizes.get(ident.removeprefix("sha256:")[:12], 0)
            proposed_argv = docker_image_remove_argv(ident, tags)
            report["resources"].append(
                {
                    "id": f"docker-image:{ident}",
                    "kind": "docker_image",
                    "class": "eligible" if eligible else ("protected" if referenced else "review"),
                    "reason_keys": reasons,
                    "locator": {"id": ident, "tags": tags},
                    "fingerprint": {
                        "created": item["Created"],
                        "rootfs": item.get("RootFS"),
                        "tags": tags,
                        "daemon_id": daemon_id,
                    },
                    "created_at": iso(created),
                    "age_days": age_days,
                    "estimated_bytes": unique_size,
                    "docker": {
                        "dangling": dangling,
                        "referenced": referenced,
                        "owned": owned,
                        "labels": public_docker_labels(labels),
                        "size_bytes": int(item.get("Size") or 0),
                        "unique_size_lower_bound": unique_size,
                    },
                    **({"proposed_argv": proposed_argv} if eligible else {}),
                }
            )

        for item in volumes:
            name = str(item.get("Name", ""))
            labels = item.get("Labels") or {}
            referenced = name in volume_refs
            sensitive = bool(SENSITIVE_VOLUME.search(name))
            anonymous = is_anonymous_volume(name, labels)
            local = item.get("Driver") == "local"
            created_raw = str(item.get("CreatedAt", ""))
            created = docker_created(created_raw)
            age_days = max(0, (now - created).days)
            reasons: list[str] = []
            if referenced:
                reasons.append("container_reference")
            if sensitive:
                reasons.append("sensitive_volume_name")
            if not anonymous:
                reasons.append("not_anonymous_volume")
            if not local:
                reasons.append("non_local_volume")
            if age_days < args.min_age_days:
                reasons.append("too_recent")
            eligible = not reasons
            report["resources"].append(
                {
                    "id": f"docker-volume:{name}",
                    "kind": "docker_volume",
                    "class": "eligible"
                    if eligible
                    else (
                        "protected"
                        if referenced or sensitive or not anonymous or not local
                        else "review"
                    ),
                    "reason_keys": reasons,
                    "locator": {"name": name},
                    "fingerprint": {
                        "created": created_raw,
                        "driver": item.get("Driver"),
                        "mountpoint": item.get("Mountpoint"),
                        "daemon_id": daemon_id,
                    },
                    "created_at": iso(created),
                    "age_days": age_days,
                    "estimated_bytes": volume_sizes.get(name, 0),
                    "docker": {
                        "referenced": referenced,
                        "sensitive": sensitive,
                        "anonymous": anonymous,
                        "local": local,
                        "labels": public_docker_labels(labels),
                    },
                    **({"proposed_argv": ["docker", "volume", "rm", name]} if eligible else {}),
                }
            )
        build_cache_reclaimable = 0
        for row in df_summary.get("rows", []):
            if row.get("Type") == "Build Cache":
                build_cache_reclaimable = parse_size(str(row.get("Reclaimable", "")).split()[0])
        report["resources"].append(
            {
                "id": "docker-build-cache:global",
                "kind": "docker_build_cache",
                "class": "protected",
                "reason_keys": ["global_build_cache", "record_ids_not_fixed"],
                "locator": {"context": context, "daemon_id": daemon_id},
                "fingerprint": {"daemon_id": daemon_id},
                "estimated_bytes": build_cache_reclaimable,
            }
        )
    except (ScanError, ValueError, KeyError, json.JSONDecodeError) as exc:
        report["docker"] = {**report.get("docker", {}), "available": False}
        add_error(report, "docker", str(exc))


def summarize(report: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"counts": {}, "estimated_bytes": {}}
    for resource in report["resources"]:
        key = f"{resource['kind']}:{resource['class']}"
        result["counts"][key] = result["counts"].get(key, 0) + 1
        result["estimated_bytes"][key] = result["estimated_bytes"].get(key, 0) + int(
            resource.get("estimated_bytes") or 0
        )
    result["docker_shared_layer_warning"] = True
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", default="/workspace")
    parser.add_argument("--output", required=True)
    parser.add_argument("--min-age-days", type=int, default=30)
    parser.add_argument("--image-min-age-days", type=int, default=14)
    parser.add_argument("--worktree-min-age-days", type=int, default=14)
    parser.add_argument("--report-hours", type=int, default=24)
    parser.add_argument("--command-timeout", type=float, default=30)
    parser.add_argument("--docker-df-timeout", type=float, default=90)
    parser.add_argument("--max-output-bytes", type=int, default=8_000_000)
    parser.add_argument("--max-items", type=int, default=20_000)
    values = parser.parse_args()
    if (
        values.min_age_days < 1
        or values.image_min_age_days < 1
        or values.worktree_min_age_days < 1
        or values.report_hours < 1
    ):
        parser.error("age and report lifetime must be positive")
    return values


def main() -> int:
    args = parse_args()
    requested = os.path.abspath(args.workspace)
    workspace = os.path.realpath(requested)
    if not os.path.isdir(workspace):
        raise SystemExit(f"workspace is not a directory: {requested}")
    output = Path(args.output).resolve()
    if within(str(output), workspace):
        raise SystemExit("report must be stored outside workspace")
    stat = os.stat(workspace, follow_symlinks=False)
    disk = shutil.disk_usage(workspace)
    now = utc_now()
    report: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "scanner_version": SCANNER_VERSION,
        "generated_at": iso(now),
        "expires_at": iso(now + dt.timedelta(hours=args.report_hours)),
        "host": {
            "boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip()
            if Path("/proc/sys/kernel/random/boot_id").is_file()
            else None
        },
        "workspace": {
            "requested": requested,
            "realpath": workspace,
            "device": stat.st_dev,
            "inode": stat.st_ino,
            "disk": {"total": disk.total, "used": disk.used, "free": disk.free},
        },
        "docker": {},
        "limits": {
            "min_age_days": args.min_age_days,
            "image_min_age_days": args.image_min_age_days,
            "worktree_min_age_days": args.worktree_min_age_days,
            "command_timeout": args.command_timeout,
            "docker_df_timeout": args.docker_df_timeout,
            "max_output_bytes": args.max_output_bytes,
            "max_items": args.max_items,
        },
        "errors": [],
        "complete": True,
        "resources": [],
    }
    active, active_complete, denied = process_links(args.max_items)
    report["host"]["process_visibility_complete"] = active_complete
    report["host"]["process_dirs_denied"] = denied
    scan_git(report, workspace, args, active, active_complete)
    scan_docker(report, args)
    report["summary"] = summarize(report)
    report["report_sha256"] = report_hash(report)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(
        json.dumps(
            {
                "report": str(output.resolve()),
                "report_sha256": report["report_sha256"],
                "expires_at": report["expires_at"],
                "complete": report["complete"],
                "summary": report["summary"],
                "errors": report["errors"],
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0 if report["complete"] else 2


if __name__ == "__main__":
    sys.exit(main())
