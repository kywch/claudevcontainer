---
name: agent-review
description: Weekly review of how the user works with Claude Code and Codex — score against the eight levels of AI adoption, mine repeated corrections into proposed rule/skill diffs, flag missed delegation opportunities, and pick one experiment for next week. Report-only; proposals are applied only after explicit approval. Use when the user asks for an agent review, weekly review, lessons, or "what level am I".
effort: medium
---

# Agent Review

Read-only coach. Evidence from the user's own sessions, never generic advice. Do not edit any config or skill during the review.

## 1. Collect

Run where the agents' homes live — inside the devcontainer. From the host, go through the container (`docker ps` to find it):

```bash
python3 <skill-dir>/scripts/collect.py --days 7 > /tmp/agent-review.json   # in the container
docker exec -i -u agent <container> python3 - --days 7 < <skill-dir>/scripts/collect.py > /tmp/agent-review.json   # from the host
```

If sessions total fewer than ~10, say the data looks thin and check you are reading the right home before scoring.

It emits per-kind session summaries (main / subagent / exec; active hours from gaps ≤30 min, user turns), the longest main sessions, prompt/slash counts, slash commands, permission modes, tool calls, Claude subagent `type:model` pairs, skills used (Claude Skill calls, Codex SKILL.md reads), and every typed prompt (truncated, pasted content excluded). The output is large (~250KB for a busy week): read it with `jq 'del(.prompts)'` first, then filter `.prompts` by tool, project, or keyword. Open specific transcripts (`~/.claude/projects/*/<sessionId>.jsonl`, `~/.codex/sessions/`) only to confirm a pattern.

Read the newest previous review in `${AGENT_REVIEW_DIR:-$HOME/.agent-reviews}/`: its level, its experiment, and its proposals. None → mark this as the first review and omit deltas.

Every claim must cite the collected data or a transcript; do not credit work that only appears as discussion.

## 2. Analyze

**Level** (Every's eight levels; higher is not always better — match level to stakes):
1 Chatbot · 2 Copilot · 3 Agent (approves steps) · 4 Autopilot (reviews only final output) · 5 Workflows (skills, quality gates) · 6 Assistant (proactive background work) · 7 Multi-agent (several long-running agents) · 8 Orchestrator (a manager agent runs the team).
Score to one decimal with 3 evidence bullets, and the change vs last week.

**Lessons** — cluster prompts where the user corrects, restates, or blocks the agent ("no", "don't", "wait", "instead", "again", "concise", "do not edit/commit", repeated instructions). A cluster qualifies at ≥2 occurrences, or once if severe (agent edited or committed after being told not to, destroyed work, leaked a secret). For each, grep the shared configs before proposing — resolve `D=$(realpath <skill-dir>)` first, since installed skill dirs are symlinks:

- `$D/../../home/.claude/CLAUDE.md`, `$D/../../home/.codex/AGENTS.md`, `$D/../*/SKILL.md`

Rule missing → propose adding it. Rule exists but was violated → propose sharper wording, moving it to the skill that was active, or a hook — never a duplicate rule.

**Missed opportunities** — repeated manual chains an existing skill already covers (e.g. implement → verify → commit by hand instead of `ship`); subagents left on `inherit` where a cheaper tier fits; chores done by hand more than once.

**Last week's experiment** — tried or not, and what the sessions show.

## 3. Write the review

Write `${AGENT_REVIEW_DIR:-$HOME/.agent-reviews}/<YYYY>-W<ww>.md` (ISO week):

```markdown
# Agent review <YYYY>-W<ww> (<start>–<end>)
Level: <x.y> (<±d> vs last week) — <one-line why>
Activity: <claude n sessions / m prompts>, <codex n / m>; subagents <n> (<inherit k>); skills <names>

## Evidence
- …

## Lessons (proposed — not applied)
L1. <pattern> — seen <n>× (<day tool "short quote">) → <file>: <exact line(s) to add/replace>

## Missed opportunities
- …

## Last week's experiment
<name>: <tried | not tried> — <result>

## Next experiment
<one concrete thing to try, with the first command or prompt>
```

Quote at most ~15 words per example; never copy secrets, tokens, or pasted content.

## 4. Report and stop

Show ≤20 lines: level and delta, top 3 lesson ids with one line each, next experiment, and the review path; drop evidence and missed opportunities first when over budget. Then stop.

When the user approves ids (e.g. "apply L1 L3"), apply exactly those edits, show the diff, and stop before commit. If skills changed, remind them to run `.devcontainer/update-skills.sh`.

## Headless weekly run

For a scheduled run, keep it read-only except for the review file, e.g.:

```bash
claude -p --effort medium --allowedTools "Bash(python3:*) Read Grep Glob Write" \
  "Run the agent-review skill for the last 7 days."
```

Deliver the written review (file, Telegram, or email) outside the agent.
