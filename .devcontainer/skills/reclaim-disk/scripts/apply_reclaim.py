#!/usr/bin/env python3
"""Remove exact eligible Docker images or anonymous volumes from an approved report."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from scan_reclaim import (
    ScanError,
    docker_batches,
    docker_created,
    docker_image_remove_argv,
    git,
    is_anonymous_volume,
    iso,
    path_is_active,
    process_links,
    report_hash,
    run,
    text,
    utc_now,
    within,
    worktree_records,
)

SUPPORTED_KINDS = {"docker_image", "docker_volume", "git_worktree"}


class ValidationError(RuntimeError):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", required=True)
    parser.add_argument("--approve", required=True)
    parser.add_argument("--target", action="append", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--command-timeout", type=float, default=30)
    parser.add_argument("--max-output-bytes", type=int, default=2_000_000)
    parser.add_argument("--max-targets", type=int, default=1000)
    parser.add_argument("--max-estimated-bytes", type=int, default=100_000_000_000)
    parser.add_argument("--max-process-items", type=int, default=20_000)
    return parser.parse_args()


def load_report(path: str, approval: str) -> dict[str, Any]:
    try:
        report = json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ValidationError(f"cannot read report: {exc}") from exc
    if report.get("schema_version") != 1:
        raise ValidationError("unsupported report schema")
    actual = report_hash(report)
    recorded = report.get("report_sha256")
    if not recorded or recorded != actual or approval != actual:
        raise ValidationError("report SHA-256 or approval mismatch")
    try:
        expires = dt.datetime.fromisoformat(str(report["expires_at"]).replace("Z", "+00:00"))
    except (KeyError, ValueError) as exc:
        raise ValidationError("invalid report expiry") from exc
    if utc_now() >= expires:
        raise ValidationError("report expired; rescan required")
    if not report.get("complete"):
        raise ValidationError("report incomplete; rescan required")
    return report


def validate_workspace(report: dict[str, Any]) -> tuple[str, os.stat_result]:
    expected = report["workspace"]
    path = os.path.realpath(str(expected["realpath"]))
    try:
        stat = os.stat(path, follow_symlinks=False)
    except OSError as exc:
        raise ValidationError(f"workspace unavailable: {exc}") from exc
    if stat.st_dev != expected["device"] or stat.st_ino != expected["inode"]:
        raise ValidationError("workspace identity changed")
    current_boot = Path("/proc/sys/kernel/random/boot_id")
    if current_boot.is_file() and report.get("host", {}).get("boot_id"):
        if current_boot.read_text().strip() != report["host"]["boot_id"]:
            raise ValidationError("host boot identity changed")
    return path, stat


def validate_docker(report: dict[str, Any], args: argparse.Namespace) -> None:
    expected = report.get("docker", {})
    if not expected.get("available"):
        raise ValidationError("Docker was unavailable during scan")
    context = text(["docker", "context", "show"], args.command_timeout, args.max_output_bytes)
    info = json.loads(
        text(
            ["docker", "info", "--format", "{{json .}}"],
            args.command_timeout,
            args.max_output_bytes,
        )
    )
    if context != expected.get("context") or str(info.get("ID", "")) != expected.get("daemon_id"):
        raise ValidationError("Docker context or daemon identity changed")


def all_containers(args: argparse.Namespace) -> list[dict[str, Any]]:
    ids = text(
        ["docker", "container", "ls", "-aq", "--no-trunc"],
        args.command_timeout,
        args.max_output_bytes,
    ).splitlines()
    if not ids:
        return []
    return docker_batches(["docker", "container", "inspect"], ids, args)


def validate_selection(selected: list[dict[str, Any]]) -> None:
    if any(item.get("class") != "eligible" for item in selected):
        raise ValidationError("every target must be eligible")
    if any(item.get("kind") not in SUPPORTED_KINDS for item in selected):
        raise ValidationError(
            "only eligible worktree, Docker image, and anonymous volume targets are supported"
        )


def validate_worktree(
    resource: dict[str, Any],
    report: dict[str, Any],
    args: argparse.Namespace,
) -> list[str]:
    if resource.get("kind") != "git_worktree":
        raise ValidationError("target is not a Git worktree")
    locator = resource["locator"]
    path = str(locator["path"])
    real = os.path.realpath(path)
    workspace = os.path.realpath(str(report["workspace"]["realpath"]))
    if real != locator["realpath"] or not within(real, workspace) or real == workspace:
        raise ValidationError("worktree path escaped workspace")
    stat = os.stat(path, follow_symlinks=False)
    fingerprint = resource["fingerprint"]
    if stat.st_dev != fingerprint["device"] or stat.st_ino != fingerprint["inode"]:
        raise ValidationError("worktree identity changed")

    admin_repo = str(locator["admin_repo"])
    records = worktree_records(
        git(
            admin_repo,
            ["worktree", "list", "--porcelain"],
            args.command_timeout,
            args.max_output_bytes,
        )
    )
    matches = [
        (index, record)
        for index, record in enumerate(records)
        if os.path.realpath(record.get("worktree", "")) == real
    ]
    if len(matches) != 1 or matches[0][0] == 0:
        raise ValidationError("worktree registration changed or became primary")
    record = matches[0][1]
    if "locked" in record or "prunable" in record:
        raise ValidationError("worktree became locked or prunable")
    common = os.path.realpath(
        git(
            real,
            ["rev-parse", "--path-format=absolute", "--git-common-dir"],
            args.command_timeout,
            args.max_output_bytes,
        )
    )
    head = git(real, ["rev-parse", "HEAD"], args.command_timeout, args.max_output_bytes)
    branch = git(
        real,
        ["symbolic-ref", "-q", "HEAD"],
        args.command_timeout,
        args.max_output_bytes,
        allow_failure=True,
    )
    status = run(
        ["git", "-C", real, "status", "--porcelain=v1", "-z", "--untracked-files=all"],
        args.command_timeout,
        args.max_output_bytes,
    ).stdout
    ignored = run(
        ["git", "-C", real, "status", "--porcelain=v1", "-z", "--ignored=matching"],
        args.command_timeout,
        args.max_output_bytes,
    ).stdout
    if (
        common != os.path.realpath(str(fingerprint["common_dir"]))
        or head != fingerprint["head"]
        or (branch or None) != fingerprint["branch"]
        or hashlib.sha256(status).hexdigest() != fingerprint["status_sha256"]
        or hashlib.sha256(ignored).hexdigest() != fingerprint["ignored_sha256"]
    ):
        raise ValidationError("worktree Git state changed")
    commit_ts = int(
        git(
            real,
            ["show", "-s", "--format=%ct", "HEAD"],
            args.command_timeout,
            args.max_output_bytes,
        )
    )
    age_days = max(0, int((utc_now().timestamp() - commit_ts) // 86400))
    if age_days < int(report["limits"]["worktree_min_age_days"]):
        raise ValidationError("worktree no longer meets age policy")
    active, _, _ = process_links(args.max_process_items)
    if path_is_active(real, active):
        raise ValidationError("worktree gained active process")
    expected = ["git", "-C", admin_repo, "worktree", "remove", "--force", path]
    if resource.get("proposed_argv") != expected:
        raise ValidationError("Git action mismatch")
    return expected


def validate_unused_image(
    resource: dict[str, Any],
    report: dict[str, Any],
    args: argparse.Namespace,
    containers: list[dict[str, Any]],
) -> list[str]:
    if resource.get("kind") != "docker_image":
        raise ValidationError("target is not a Docker image")
    ident = str(resource["locator"]["id"])
    item = json.loads(
        text(["docker", "image", "inspect", ident], args.command_timeout, args.max_output_bytes)
    )[0]
    fingerprint = resource["fingerprint"]
    tags = item.get("RepoTags") or []
    if (
        item.get("Id") != ident
        or item.get("Created") != fingerprint["created"]
        or item.get("RootFS") != fingerprint["rootfs"]
        or tags != fingerprint["tags"]
        or tags != resource["locator"]["tags"]
    ):
        raise ValidationError("image identity or tags changed")
    if any(container.get("Image") == ident for container in containers):
        raise ValidationError("image gained container reference")
    created = docker_created(str(item["Created"]))
    if (utc_now() - created).days < int(report["limits"]["image_min_age_days"]):
        raise ValidationError("image no longer meets age policy")
    if fingerprint.get("daemon_id") != report["docker"]["daemon_id"]:
        raise ValidationError("resource daemon identity mismatch")
    expected = docker_image_remove_argv(ident, tags)
    if resource.get("proposed_argv") != expected:
        raise ValidationError("Docker action mismatch")
    return expected


def validate_anonymous_volume(
    resource: dict[str, Any], report: dict[str, Any], args: argparse.Namespace
) -> list[str]:
    if resource.get("kind") != "docker_volume":
        raise ValidationError("only anonymous Docker volumes are supported")
    name = str(resource["locator"]["name"])
    item = json.loads(
        text(["docker", "volume", "inspect", name], args.command_timeout, args.max_output_bytes)
    )[0]
    fingerprint = resource["fingerprint"]
    if (
        item.get("Name") != name
        or item.get("CreatedAt") != fingerprint["created"]
        or item.get("Driver") != fingerprint["driver"]
        or item.get("Mountpoint") != fingerprint["mountpoint"]
    ):
        raise ValidationError("volume identity changed")
    if item.get("Driver") != "local":
        raise ValidationError("volume is not local")
    if not is_anonymous_volume(name, item.get("Labels")):
        raise ValidationError("volume is not Docker-marked anonymous volume")
    for container in all_containers(args):
        if any(
            mount.get("Type") == "volume" and mount.get("Name") == name
            for mount in container.get("Mounts", [])
        ):
            raise ValidationError("volume gained container reference")
    created = str(item["CreatedAt"])
    if (utc_now() - docker_created(created)).days < int(report["limits"]["min_age_days"]):
        raise ValidationError("volume no longer meets age policy")
    if fingerprint.get("daemon_id") != report["docker"]["daemon_id"]:
        raise ValidationError("resource daemon identity mismatch")
    expected = ["docker", "volume", "rm", name]
    if resource.get("proposed_argv") != expected:
        raise ValidationError("Docker action mismatch")
    return expected


def mutate(argv: list[str], args: argparse.Namespace) -> tuple[str, str]:
    try:
        result = subprocess.run(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=args.command_timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("mutation timed out; outcome unknown") from exc
    except OSError as exc:
        raise ValidationError(f"mutation could not start: {exc}") from exc
    if len(result.stdout) + len(result.stderr) > args.max_output_bytes:
        raise RuntimeError("mutation output exceeded limit; outcome unknown")
    stdout = result.stdout.decode(errors="replace").strip()
    stderr = result.stderr.decode(errors="replace").strip()
    if result.returncode:
        raise RuntimeError(f"mutation exited {result.returncode}; outcome unknown: {stderr[:500]}")
    return stdout, stderr


def verify_removed(resource: dict[str, Any], args: argparse.Namespace) -> bool:
    if resource["kind"] == "git_worktree":
        path = resource["locator"]["path"]
        if os.path.lexists(path):
            return False
        outcome = run(
            ["git", "-C", resource["locator"]["admin_repo"], "worktree", "list", "--porcelain"],
            args.command_timeout,
            args.max_output_bytes,
        )
        records = worktree_records(outcome.stdout.decode(errors="replace"))
        real = resource["locator"]["realpath"]
        return not any(os.path.realpath(item.get("worktree", "")) == real for item in records)
    if resource["kind"] == "docker_image":
        argv = ["docker", "image", "inspect", resource["locator"]["id"]]
        absent_text = "no such image"
    else:
        argv = ["docker", "volume", "inspect", resource["locator"]["name"]]
        absent_text = "no such volume"
    outcome = run(
        argv,
        args.command_timeout,
        args.max_output_bytes,
        allow_failure=True,
    )
    if outcome.returncode == 0:
        return False
    return absent_text in outcome.stderr.decode(errors="replace").lower()


def write_result(path: str, result: dict[str, Any]) -> None:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")


def main() -> int:
    args = parse_args()
    if len(args.target) != len(set(args.target)):
        raise SystemExit("duplicate target IDs")
    if len(args.target) > args.max_targets:
        raise SystemExit("target count exceeds limit")
    try:
        report = load_report(args.report, args.approve)
        workspace, _ = validate_workspace(report)
        result_path = Path(args.result).resolve()
        if os.path.commonpath((str(result_path), workspace)) == workspace:
            raise ValidationError("result must be stored outside workspace")
        report_path = Path(args.report).resolve()
        if os.path.commonpath((str(report_path), workspace)) == workspace:
            raise ValidationError("report must be stored outside workspace")
        resources = {item["id"]: item for item in report["resources"]}
        missing = [ident for ident in args.target if ident not in resources]
        if missing:
            raise ValidationError(f"targets absent from report: {', '.join(missing)}")
        selected = [resources[ident] for ident in args.target]
        validate_selection(selected)
        estimated = sum(int(item.get("estimated_bytes") or 0) for item in selected)
        if estimated > args.max_estimated_bytes:
            raise ValidationError("estimated bytes exceed apply limit")
        containers: list[dict[str, Any]] = []
        if any(item["kind"].startswith("docker_") for item in selected):
            validate_docker(report, args)
            containers = all_containers(args)
    except (
        ValidationError,
        ScanError,
        OSError,
        KeyError,
        TypeError,
        ValueError,
        json.JSONDecodeError,
    ) as exc:
        raise SystemExit(f"refusing apply: {exc}") from exc

    before = shutil.disk_usage(workspace)
    result: dict[str, Any] = {
        "schema_version": 1,
        "report_sha256": report["report_sha256"],
        "approved_targets": args.target,
        "started_at": iso(utc_now()),
        "before": {"total": before.total, "used": before.used, "free": before.free},
        "targets": [],
    }
    stop = False
    for resource in selected:
        entry: dict[str, Any] = {"id": resource["id"], "kind": resource["kind"]}
        if stop:
            entry.update({"status": "skipped", "detail": "stopped after uncertain prior outcome"})
            result["targets"].append(entry)
            continue
        try:
            if resource["kind"].startswith("docker_"):
                validate_docker(report, args)
            if resource["kind"] == "git_worktree":
                argv = validate_worktree(resource, report, args)
            elif resource["kind"] == "docker_image":
                argv = validate_unused_image(resource, report, args, containers)
            else:
                argv = validate_anonymous_volume(resource, report, args)
            stdout, stderr = mutate(argv, args)
            if not verify_removed(resource, args):
                raise RuntimeError("post-mutation verification failed; outcome unknown")
            entry.update({"status": "removed", "stdout": stdout[:1000], "stderr": stderr[:1000]})
        except ValidationError as exc:
            entry.update({"status": "skipped", "detail": str(exc)})
        except (
            RuntimeError,
            ScanError,
            OSError,
            KeyError,
            TypeError,
            ValueError,
            json.JSONDecodeError,
        ) as exc:
            entry.update({"status": "unknown", "detail": str(exc)})
            stop = True
        result["targets"].append(entry)
        write_result(args.result, result)
    after = shutil.disk_usage(workspace)
    result.update(
        {
            "finished_at": iso(utc_now()),
            "after": {"total": after.total, "used": after.used, "free": after.free},
            "measured_free_delta": after.free - before.free,
        }
    )
    write_result(args.result, result)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 3 if any(item["status"] == "unknown" for item in result["targets"]) else 0


if __name__ == "__main__":
    sys.exit(main())
