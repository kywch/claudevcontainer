#!/bin/bash
# Sync repo-managed skills into agent tool homes without rebuilding.

set -euo pipefail

AGENT_HOME="${AGENT_HOME:-/home/agent}"
SHARED_SKILLS="${SHARED_SKILLS:-/workspace/.devcontainer/skills}"
TOOLS="${TOOLS:-claude codex gemini forge}"

if [ ! -d "$SHARED_SKILLS" ]; then
  echo "skills source missing: $SHARED_SKILLS" >&2
  exit 1
fi

for tool in $TOOLS; do
  dst="$AGENT_HOME/.$tool"
  [ -d "$dst" ] || continue
  target="$dst/skills"

  if [ "$tool" = "codex" ]; then
    # Codex owns ~/.codex/skills/.system, so keep skills/ real and link user
    # skills one by one.
    if [ -L "$target" ]; then
      rm "$target"
    fi
    mkdir -p "$target"
    find "$target" -maxdepth 1 -type l -lname "$SHARED_SKILLS/*" -delete 2>/dev/null || true
    for skill_dir in "$SHARED_SKILLS"/*/; do
      [ -d "$skill_dir" ] || continue
      skill_name=$(basename "$skill_dir")
      ln -sfn "$SHARED_SKILLS/$skill_name" "$target/$skill_name"
    done
    continue
  fi

  if [ -L "$target" ] && [ "$(readlink "$target")" = "$SHARED_SKILLS" ]; then
    continue
  fi
  rm -rf "$target"
  ln -sfn "$SHARED_SKILLS" "$target"
done

echo "skills synced from $SHARED_SKILLS"
echo "restart Codex session to reload skill registry"
