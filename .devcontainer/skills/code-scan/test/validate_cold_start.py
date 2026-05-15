#!/usr/bin/env python3
"""Validate code-scan cold-start findings."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ORACLE = ROOT / "oracles" / "cold-start.json"
TAG_RE = re.compile(r"^\[([a-z0-9-]+)\]\s+\S+")


REQUIRED_FIELDS = {
    "schema_version",
    "id",
    "fingerprint",
    "target",
    "category",
    "primary_location",
    "locations",
    "description",
    "risk",
    "evidence",
    "reachability",
    "confidence",
    "impact_scope",
    "suggested_fix",
    "mechanical",
    "site_count",
}

ENUMS = {
    "category": {"correctness", "test-gap", "duplication", "magic-value", "complexity"},
    "evidence": {"observed", "inferred", "needs_confirmation"},
    "reachability": {"confirmed", "probable", "unknown"},
    "confidence": {"high", "medium", "low"},
    "impact_scope": {"data-loss", "security", "crash", "wrong-behavior", "maintenance"},
}


def load_jsonl(path: Path) -> list[dict]:
    records: list[dict] = []
    for line_no, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip():
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError as exc:
            raise SystemExit(f"{path}:{line_no}: invalid JSON: {exc}") from exc
    return records


def location_values(finding: dict) -> list[dict]:
    locations = finding.get("locations")
    if isinstance(locations, list) and locations:
        return locations
    primary = finding.get("primary_location")
    return [primary] if isinstance(primary, dict) else []


def normalized_file(location: dict) -> str:
    return str(location.get("file", "")).replace("\\", "/")


def has_expected_location(finding: dict, expected: dict) -> bool:
    for location in location_values(finding):
        if not normalized_file(location).endswith(expected["file"]):
            continue
        if location.get("line") != expected["line"]:
            continue
        if str(location.get("snippet", "")).strip() != expected["snippet"]:
            continue
        return True
    return False


def finding_tag(finding: dict) -> str | None:
    match = TAG_RE.match(str(finding.get("risk", "")))
    return match.group(1) if match else None


def validate_schema(finding: dict, index: int) -> list[str]:
    errors: list[str] = []
    missing = sorted(REQUIRED_FIELDS - set(finding))
    if missing:
        errors.append(f"record {index}: missing fields: {', '.join(missing)}")

    for field, allowed in ENUMS.items():
        if field in finding and finding[field] not in allowed:
            errors.append(f"record {index}: invalid {field}: {finding[field]!r}")

    risk = str(finding.get("risk", ""))
    if not TAG_RE.match(risk):
        errors.append(f"record {index}: risk must start with [tag] plus mechanism")

    locations = location_values(finding)
    if not locations:
        errors.append(f"record {index}: missing locations")
    for loc_index, location in enumerate(locations):
        for field in ("file", "line", "snippet"):
            if field not in location:
                errors.append(f"record {index} location {loc_index}: missing {field}")
        if not isinstance(location.get("redacted", False), bool):
            errors.append(f"record {index} location {loc_index}: redacted must be bool")

    site_count = finding.get("site_count")
    if not isinstance(site_count, int) or site_count < 1:
        errors.append(f"record {index}: site_count must be positive int")
    elif locations and site_count < len(locations):
        errors.append(f"record {index}: site_count smaller than locations length")

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_cold_start.py <merged-findings.jsonl>", file=sys.stderr)
        return 2

    findings_path = Path(sys.argv[1])
    oracle = json.loads(ORACLE.read_text())
    findings = load_jsonl(findings_path)

    errors: list[str] = []
    for index, finding in enumerate(findings, 1):
        errors.extend(validate_schema(finding, index))

    for expected in oracle["required"]:
        matches = [
            finding
            for finding in findings
            if finding_tag(finding) == expected["tag"]
            and finding.get("tier") == expected["tier"]
            and int(finding.get("site_count", 0)) >= expected["min_sites"]
            and has_expected_location(finding, expected)
        ]
        if not matches:
            errors.append(
                "missing expected finding: "
                f"{expected['file']}:{expected['line']} [{expected['tag']}]"
            )

    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1

    print(f"cold-start validation passed: {len(findings)} findings")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
