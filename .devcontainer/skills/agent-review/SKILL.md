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

`<repo>` is `git -C "$(realpath <skill-dir>)" rev-parse --show-toplevel` — the same bind-mounted folder from host and container. Read the newest previous review in `<repo>/.agent-reviews/`: its level, its experiment, and its proposals. None → mark this as the first review and omit deltas.

Every claim must cite the collected data or a transcript; do not credit work that only appears as discussion.

## 2. Analyze

**Level** (Every's eight levels; higher is not always better — match level to stakes):
1 Chatbot · 2 Copilot · 3 Agent (approves steps) · 4 Autopilot (reviews only final output) · 5 Workflows (skills, quality gates) · 6 Assistant (proactive background work) · 7 Multi-agent (several long-running agents) · 8 Orchestrator (a manager agent runs the team).
Score to one decimal with 3 evidence bullets, and the change vs last week.

**What agents did** — group prompts and sessions by project; per project, summarize outcomes (shipped, fixed, investigated, abandoned) from the prompts, not tool counts.

**Lessons** — cluster prompts where the user corrects, restates, or blocks the agent ("no", "don't", "wait", "instead", "again", "concise", "do not edit/commit", repeated instructions). A cluster qualifies at ≥2 occurrences, or once if severe (agent edited or committed after being told not to, destroyed work, leaked a secret). For each, grep the shared configs before proposing — resolve `D=$(realpath <skill-dir>)` first, since installed skill dirs are symlinks:

- `$D/../../home/.claude/CLAUDE.md`, `$D/../../home/.codex/AGENTS.md`, `$D/../*/SKILL.md`

Rule missing → propose adding it. Rule exists but was violated → propose sharper wording, moving it to the skill that was active, or a hook — never a duplicate rule.

**Missed opportunities** — repeated manual chains an existing skill already covers (e.g. implement → verify → commit by hand instead of `ship`); subagents left on `inherit` where a cheaper tier fits; chores done by hand more than once.

**Last week's experiment** — tried or not, and what the sessions show.

## 3. Write the review

Write `<repo>/.agent-reviews/<YYYY>-W<ww>.md` (ISO week):

```markdown
# Agent review <YYYY>-W<ww> · <Mon d>–<Mon d>

**At a glance**
- **Did:** <one line: the main things agents worked on>
- **Biggest opportunity:** <one line>
- **Level:** <x.y> (<±d> vs last week) · <claude n sessions, codex n sessions, active h>

## What agents did last week

| Project | Tool | Sessions | Active h | What got done |
|---|---|---|---|---|
| <project> | <claude/codex> | <n> | <h> | <one line, outcome not activity> |

## Opportunities

### 1. <short title>
- **Seen:** <what happened, with count and a ≤15-word quote>
- **Try instead:** <skill, rule, or command>
- **Gain:** <time, turns, or errors saved>
- **Proposed rule (L1):** `<file>`: <exact line to add/replace> — only when a config/skill change is the fix

## Last week's experiment
**<name>** — <tried | not tried>: <result>

## Next experiment
**<name>** — <why>. Start with: `<command or prompt>`
```

Keep it scannable: ≤8 table rows (group small projects as "other"), ≤4 opportunities ranked by payoff, no paragraphs over 2 lines. Opportunities cover both lessons (repeated corrections) and efficiency (manual chains, polling, wrong model tier, chores done by hand).

Quote at most ~15 words per example; never copy secrets, tokens, or pasted content.

## 4. Report and stop

Show ≤20 lines: the At a glance block, opportunity titles with their L ids, next experiment, and the review path. Then stop.

When the user approves ids (e.g. "apply L1 L3"), apply exactly those edits, show the diff, and stop before commit. If skills changed, remind them to run `.devcontainer/update-skills.sh`.

## Weekly run

`scripts/weekly.sh` (host) starts the devcontainer if it is stopped, runs this skill headless inside it, and emails the newest review as HTML through the Resend API (stdlib `urllib`). It runs once per ISO week on Sat/Sun, catches up a missed weekend on the next weekday the machine is on, and leaves the week undone after any failure so the next hourly tick retries. Flags: `--force` reruns a finished week, `--mail-only` resends the newest review, `--no-mail` skips sending.

Files (host):

- `~/.config/agent-review/mail.env` (mode 600): `RESEND_API_KEY` (send-only key), `MAIL_TO` (your Resend account email), `MAIL_FROM="Agent Review <onboarding@resend.dev>"` — quote it; without a verified domain Resend only sends from that address.
- `~/.local/state/agent-review/last-week`: last completed ISO week.
- `<repo>/.agent-reviews/<week>.md`: the reviews (gitignored).
- Logs: `journalctl --user -u agent-review`; next/last run: `systemctl --user list-timers agent-review.timer`.

Setup — create the two units, then `systemctl --user daemon-reload && systemctl --user enable --now agent-review.timer`. User timers run only while logged in unless `loginctl enable-linger` is set.

```ini
# ~/.config/systemd/user/agent-review.service
[Unit]
Description=Weekly agent review (runs in devcontainer, emails result)

[Service]
Type=oneshot
ExecStart=<repo>/.devcontainer/skills/agent-review/scripts/weekly.sh
TimeoutStartSec=1800

# ~/.config/systemd/user/agent-review.timer
[Unit]
Description=Weekly agent review

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```
