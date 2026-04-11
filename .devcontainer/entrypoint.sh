#!/bin/bash
# devcontainer-entrypoint: first-boot volume chown, config seeding, and
# first-boot auth import. Runs on every container start, idempotent.
#
# Layout assumptions:
#   /opt/devcontainer-home/.<tool>/   Baked-in defaults (from COPY at build)
#   /home/agent/.<tool>/              Named Docker volume (runtime state)
#   /mnt/host-<tool>/                 Read-only host bind (auth source)

set -e

DEFAULTS_ROOT=/opt/devcontainer-home
AGENT_HOME=/home/agent
TOOLS=(claude codex gemini)

# 1. Fix volume ownership on first boot.
#    Docker creates empty named volumes as root:root; the agent user cannot
#    write to them until we reclaim ownership. Harmless on subsequent boots.
for tool in "${TOOLS[@]}"; do
  sudo chown -R agent:agent "$AGENT_HOME/.$tool" 2>/dev/null || true
done
# gh token volume (mounted at .config/gh) — not in TOOLS loop because of path shape.
sudo chown -R agent:agent "$AGENT_HOME/.config/gh" 2>/dev/null || true

# 2. Seed config from image defaults.
#    Top-level files: overwrite from defaults on every boot (so repo edits
#      propagate after rebuild).
#    Managed subdirs (commands/, agents/, skills/, hooks/): mirror with
#      --delete so files removed from the repo disappear from the volume too.
#    Everything else in the volume (projects/, sessions/, todos/, plugins/,
#      shell-snapshots/, .credentials.json, etc.) is untouched.
MANAGED_SUBDIRS=(commands agents skills hooks)

for tool in "${TOOLS[@]}"; do
  src="$DEFAULTS_ROOT/.$tool"
  dst="$AGENT_HOME/.$tool"
  [ -d "$src" ] || continue

  # Top-level config files (e.g. settings.json, CLAUDE.md)
  find "$src" -maxdepth 1 -type f -print0 2>/dev/null | \
    while IFS= read -r -d '' f; do
      cp -f "$f" "$dst/$(basename "$f")"
    done

  # Managed subdirs: content mirror (delete stale entries)
  for subdir in "${MANAGED_SUBDIRS[@]}"; do
    [ -d "$src/$subdir" ] || continue
    mkdir -p "$dst/$subdir"
    rsync -a --delete --no-owner --no-group \
      "$src/$subdir/" "$dst/$subdir/"
  done
done

# 3. First-boot auth import: copy host credential files into the volume
#    iff the target does not already exist. After first boot the volume owns
#    the credentials and the in-container CLI can refresh them freely.
import_auth() {
  local src="$1" dst="$2"
  if [ -f "$src" ] && [ ! -f "$dst" ]; then
    cp -f "$src" "$dst"
    chmod 600 "$dst"
  fi
}

import_auth /mnt/host-claude/.credentials.json "$AGENT_HOME/.claude/.credentials.json"
import_auth /mnt/host-codex/auth.json           "$AGENT_HOME/.codex/auth.json"
import_auth /mnt/host-gemini/oauth_creds.json   "$AGENT_HOME/.gemini/oauth_creds.json"

# 4. Align docker group with the host's /var/run/docker.sock GID.
#    The Dockerfile creates an empty `docker` group (no fixed GID) and adds
#    agent to it; the host's socket GID varies per host (often 999, 998, 979,
#    or 0 on macOS/OrbStack), so we realign at runtime. Idempotent: becomes a
#    no-op once matched.
#
#    Subsequent `docker exec`s (e.g. VS Code shells) re-read /etc/group and
#    pick up the new GID, so interactive sessions can hit docker.sock even
#    though our already-running entrypoint process can't.
if [ -S /var/run/docker.sock ]; then
  sock_gid=$(stat -c '%g' /var/run/docker.sock)
  current_gid=$(getent group docker | cut -d: -f3 || true)
  if [ "$current_gid" != "$sock_gid" ]; then
    if ! sudo groupmod -g "$sock_gid" docker 2>/dev/null; then
      # GID already owned by another group (e.g. staff on GID 50) — add agent
      # to that group instead of fighting the collision.
      sock_group=$(getent group "$sock_gid" | cut -d: -f1 || true)
      [ -n "$sock_group" ] && sudo usermod -aG "$sock_group" agent
    fi
  fi
fi

# 5. Hand off to whatever CMD the container was launched with.
exec "$@"
