#!/usr/bin/env python3
"""Collect the last N days of Claude Code and Codex usage as compact JSON."""
import argparse
import json
import re
import statistics
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

HOME = Path.home()
SKILL_READ = re.compile(r"skills/([\w-]+)/SKILL\.md")
IDLE_GAP = 30 * 60  # gaps longer than this are not counted as active time


def epoch(iso):
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except (AttributeError, ValueError):
        return None


def session_row(tool, kind, where, stamps, turns):
    stamps.sort()
    active = sum(min(b - a, IDLE_GAP) for a, b in zip(stamps, stamps[1:]) if b - a <= IDLE_GAP)
    return {"tool": tool, "kind": kind, "where": where, "start": time.strftime("%m-%d %H:%M", time.localtime(stamps[0])),
            "active_min": round(active / 60), "span_min": round((stamps[-1] - stamps[0]) / 60), "user_turns": turns}


def typed(text):
    """True for text the user typed, not harness-injected context (<tags>, AGENTS.md dumps)."""
    text = text.lstrip()
    return bool(text) and not text.startswith(("<", "# AGENTS.md", "Caveat:"))


def jsonl(path):
    with open(path, errors="replace") as f:
        for line in f:
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--max-chars", type=int, default=240)
    args = ap.parse_args()
    since = time.time() - args.days * 86400

    prompts, slash = [], Counter()

    def add(tool, ts, project, session, text):
        text = " ".join(text.split())
        if not text:
            return
        if text.startswith("/") and " " not in text:
            slash[text] += 1
            return
        day = time.strftime("%Y-%m-%d", time.localtime(ts))
        prompts.append({"tool": tool, "ts": ts, "day": day, "project": project, "session": session,
                         "text": text[: args.max_chars]})

    claude_hist = HOME / ".claude/history.jsonl"
    if claude_hist.exists():
        for r in jsonl(claude_hist):
            ts = r.get("timestamp", 0) / 1000
            if ts >= since:
                add("claude", ts, r.get("project", ""), r.get("sessionId", ""), r.get("display", ""))
    codex_hist = HOME / ".codex/history.jsonl"
    if codex_hist.exists():
        for r in jsonl(codex_hist):
            ts = r.get("ts", 0)
            if ts >= since:
                add("codex", ts, r.get("session_id", ""), r.get("session_id", ""), r.get("text", ""))
    prompts.sort(key=lambda p: p["ts"])

    tools = {"claude": Counter(), "codex": Counter()}
    agent_models, skills, codex_skills, modes = Counter(), Counter(), Counter(), Counter()
    sessions, codex_cwd = [], {}

    for f in (HOME / ".claude/projects").glob("*/*.jsonl"):
        if f.stat().st_mtime < since:
            continue
        stamps, turns = [], 0
        for r in jsonl(f):
            if (t := epoch(r.get("timestamp"))) is not None:
                stamps.append(t)
            msg = r.get("message", {}).get("content")
            if r.get("type") == "user" and isinstance(msg, str) and typed(msg):
                turns += 1
            if r.get("type") == "user" and r.get("permissionMode"):
                modes[r["permissionMode"]] += 1
            if r.get("type") != "assistant":
                continue
            content = r.get("message", {}).get("content")
            for c in content if isinstance(content, list) else []:
                if c.get("type") != "tool_use":
                    continue
                tools["claude"][c["name"]] += 1
                inp = c.get("input", {})
                if c["name"] == "Agent":
                    agent_models[f"{inp.get('subagent_type', 'general-purpose')}:{inp.get('model', 'inherit')}"] += 1
                elif c["name"] == "Skill":
                    skills[inp.get("skill", "?")] += 1
        if stamps:
            sessions.append(session_row("claude", "main", f.parent.name, stamps, turns))

    for f in (HOME / ".codex/sessions").glob("*/*/*/*.jsonl"):
        if f.stat().st_mtime < since:
            continue
        stamps, turns, kind, where = [], 0, "main", ""
        session_skills = set()
        for r in jsonl(f):
            if (t := epoch(r.get("timestamp"))) is not None:
                stamps.append(t)
            p = r.get("payload") or {}
            if r.get("type") == "session_meta":
                src, where = p.get("source"), p.get("cwd", "")
                codex_cwd[p.get("id")] = where
                kind = "subagent" if isinstance(src, dict) else ("exec" if src == "exec" else "main")
            elif r.get("type") == "response_item" and p.get("type") == "message" and p.get("role") == "user":
                turns += any(typed(c.get("text", "")) for c in p.get("content", []))
            elif r.get("type") == "response_item" and p.get("type") in ("function_call", "custom_tool_call"):
                tools["codex"][p.get("name", "?")] += 1
                session_skills.update(SKILL_READ.findall(str(p.get("arguments") or p.get("input") or "")))
        for name in session_skills:
            codex_skills[name] += 1
        if stamps:
            sessions.append(session_row("codex", kind, where, stamps, turns))

    missing = {pr["session"] for pr in prompts if pr["tool"] == "codex"} - set(codex_cwd)
    for f in (HOME / ".codex/sessions").glob("*/*/*/*.jsonl"):
        if not missing or f.stat().st_mtime >= since:
            continue
        hit = next((sid for sid in missing if sid in f.name), None)
        if not hit:
            continue
        with open(f, errors="replace") as fh:
            try:
                r = json.loads(fh.readline())
            except json.JSONDecodeError:
                continue
        if r.get("type") == "session_meta":
            codex_cwd[hit] = (r.get("payload") or {}).get("cwd", "")
            missing.discard(hit)

    for pr in prompts:
        if pr["tool"] == "codex":
            pr["project"] = codex_cwd.get(pr["session"], "")

    summary = {}
    for key in sorted({(s["tool"], s["kind"]) for s in sessions}):
        rows = [s for s in sessions if (s["tool"], s["kind"]) == key]
        summary[":".join(key)] = {"n": len(rows), "active_h": round(sum(s["active_min"] for s in rows) / 60, 1),
                                  "median_active_min": statistics.median(s["active_min"] for s in rows),
                                  "user_turns": sum(s["user_turns"] for s in rows)}
    main = sorted((s for s in sessions if s["kind"] == "main"), key=lambda s: -s["active_min"])

    print(json.dumps({
        "window_days": args.days,
        "sessions": summary,
        "longest_sessions": main[:8],
        "prompt_counts": Counter(p["tool"] for p in prompts),
        "slash_commands": slash,
        "permission_modes": modes,
        "tool_calls": {k: dict(v.most_common(15)) for k, v in tools.items()},
        "claude_subagents": agent_models,
        "claude_skills": skills,
        "codex_skill_reads": codex_skills,
        "prompts": prompts,
    }, indent=1))


if __name__ == "__main__":
    main()
