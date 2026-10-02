#!/bin/bash
# Host-side weekly agent review: run the skill inside the devcontainer, then email the review.
# Mail settings: ~/.config/agent-review/mail.env (RESEND_API_KEY, MAIL_TO, optional MAIL_FROM).
# Runs once per ISO week on Sat/Sun; a missed weekend is caught up on the next weekday the machine is on.
# The timer fires hourly; failures (container, mail) leave the week undone so the next hour retries.
#   --force      run even if this week is done    --no-mail   skip sending
#   --mail-only  resend the newest review without running a new one
set -euo pipefail

REPO=$(git -C "$(dirname "$(realpath "$0")")" rev-parse --show-toplevel)
ENV_FILE="${AGENT_REVIEW_MAIL:-$HOME/.config/agent-review/mail.env}"
DONE_FILE="${XDG_STATE_HOME:-$HOME/.local/state}/agent-review/last-week"
WEEK=$(date +%G-W%V)
MODE="${1:-}"

DONE=$(cat "$DONE_FILE" 2>/dev/null || true)
LAST_WEEK=$(date -d '7 days ago' +%G-W%V)
if [ "$MODE" != "--force" ] && [ "$MODE" != "--mail-only" ]; then
  [ "$DONE" = "$WEEK" ] && exit 0
  if [ "$(date +%u)" -lt 6 ]; then
    # Weekday: only catch up a missed weekend, and record it as last week's run.
    [[ "$DONE" < "$LAST_WEEK" ]] || exit 0
    WEEK=$LAST_WEEK
  fi
fi

if [ "$MODE" != "--mail-only" ]; then
  # The devcontainer that bind-mounts this repo at /workspace; start it if stopped.
  CONTAINER=""
  for id in $(docker ps -aq --filter label=devpod.user); do
    if docker inspect "$id" --format '{{range .Mounts}}{{.Source}}={{.Destination}} {{end}}' | grep -q "$REPO=/workspace "; then
      CONTAINER=$id
      break
    fi
  done
  [ -n "$CONTAINER" ] || { echo "no devcontainer found for $REPO" >&2; exit 1; }
  docker start "$CONTAINER" >/dev/null

  # Prompt goes first: --allowedTools is variadic. --setting-sources project drops the
  # container's user-level Bash(*) allow, so the allowlist actually restricts.
  docker exec -u agent -w /workspace "$CONTAINER" claude -p \
    "Run the agent-review skill for the last 7 days. Write the review file; do not edit anything else." \
    --effort medium --setting-sources project \
    --allowedTools "Bash(python3:*) Bash(jq:*) Read Grep Glob Write"
fi

REVIEW=$(ls -t "$REPO"/.agent-reviews/*.md | head -1)
if [ "$MODE" != "--no-mail" ]; then
  set -a; . "$ENV_FILE"; set +a
  python3 - "$REVIEW" <<'EOF'
import html, json, os, sys, urllib.request
path = sys.argv[1]
text = open(path).read()
try:
    import markdown
    body_html = markdown.markdown(text, extensions=["tables"])
except ImportError:
    body_html = f"<pre>{html.escape(text)}</pre>"
css = ("body{font:15px/1.5 -apple-system,Segoe UI,sans-serif;max-width:760px;margin:auto;padding:16px;color:#222}"
       "h1{font-size:22px}h2{font-size:18px;border-bottom:1px solid #ddd;padding-bottom:4px;margin-top:28px}"
       "h3{font-size:16px;margin-bottom:4px}table{border-collapse:collapse;width:100%;font-size:14px}"
       "th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f5f5f5}"
       "code{background:#f3f3f3;padding:1px 4px;border-radius:3px;font-size:13px}")
body = {"from": os.environ.get("MAIL_FROM") or "onboarding@resend.dev", "to": [os.environ["MAIL_TO"]],
        "subject": f"Agent review {os.path.basename(path)[:-3]}", "text": text,
        "html": f"<html><head><style>{css}</style></head><body>{body_html}</body></html>"}
req = urllib.request.Request("https://api.resend.com/emails", data=json.dumps(body).encode(), headers={
    "Authorization": f"Bearer {os.environ['RESEND_API_KEY']}", "Content-Type": "application/json",
    "User-Agent": "agent-review/1"})  # the default Python-urllib UA can be blocked at the API edge
try:
    urllib.request.urlopen(req, timeout=30).read()
except urllib.error.HTTPError as e:
    sys.exit(f"Resend {e.code}: {e.read().decode()}")
EOF
  echo "mailed $REVIEW"
fi

[ "$MODE" = "--mail-only" ] || { mkdir -p "$(dirname "$DONE_FILE")"; echo "$WEEK" > "$DONE_FILE"; }
