#!/usr/bin/env python3
"""Non-mutating checks for reclaim-disk report primitives."""

from __future__ import annotations

import datetime as dt
import json
import tempfile
from pathlib import Path

from apply_reclaim import SUPPORTED_KINDS, ValidationError, load_report, validate_selection
from scan_reclaim import (
    DOCKER_ANONYMOUS,
    SENSITIVE_VOLUME,
    docker_image_remove_argv,
    docker_labels_owned,
    is_anonymous_volume,
    iso,
    parse_size,
    report_hash,
    utc_now,
    worktree_records,
)


def main() -> None:
    assert parse_size("4.233GB") == 4_233_000_000
    assert parse_size("188.8MB") == 188_800_000
    assert docker_labels_owned(
        {
            "io.benchflow.managed": "true",
            "io.benchflow.ephemeral": "TRUE",
        }
    )
    assert not docker_labels_owned({"io.benchflow.managed": "true"})
    assert docker_image_remove_argv("sha256:abc", []) == [
        "docker",
        "image",
        "rm",
        "sha256:abc",
    ]
    assert docker_image_remove_argv("sha256:abc", ["repo:a", "repo:b"]) == [
        "docker",
        "image",
        "rm",
        "repo:a",
        "repo:b",
    ]
    anonymous_name = "a" * 64
    assert is_anonymous_volume(anonymous_name, {DOCKER_ANONYMOUS: ""})
    assert not is_anonymous_volume("named-volume", {DOCKER_ANONYMOUS: ""})
    assert not is_anonymous_volume(anonymous_name, {})
    assert not is_anonymous_volume("A" * 64, {DOCKER_ANONYMOUS: ""})
    assert SUPPORTED_KINDS == {"docker_image", "docker_volume", "git_worktree"}
    validate_selection([{"class": "eligible", "kind": "docker_image"}])
    validate_selection([{"class": "eligible", "kind": "docker_volume"}])
    validate_selection([{"class": "eligible", "kind": "git_worktree"}])
    try:
        validate_selection([{"class": "eligible", "kind": "docker_container"}])
    except ValidationError:
        pass
    else:
        raise AssertionError("unsupported apply target accepted")
    assert SENSITIVE_VOLUME.search("codex-home-example")
    assert SENSITIVE_VOLUME.search("cursor-home-example")
    assert SENSITIVE_VOLUME.search("cursor-config-example")
    assert SENSITIVE_VOLUME.search("vscode")
    records = worktree_records(
        "worktree /workspace/repo\nHEAD abc\nbranch refs/heads/main\n\n"
        "worktree /workspace/repo-wt\nHEAD def\nlocked reason\n"
    )
    assert records[1]["locked"] == "reason"

    now = utc_now()
    report = {
        "schema_version": 1,
        "expires_at": iso(now + dt.timedelta(hours=1)),
        "complete": True,
        "resources": [],
    }
    report["report_sha256"] = report_hash(report)
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "report.json"
        path.write_text(json.dumps(report))
        assert load_report(str(path), report["report_sha256"]) == report
        report["complete"] = False
        path.write_text(json.dumps(report))
        try:
            load_report(str(path), report["report_sha256"])
        except ValidationError:
            pass
        else:
            raise AssertionError("tampered report accepted")
    print("self-check passed")


if __name__ == "__main__":
    main()
