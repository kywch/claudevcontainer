#!/bin/bash
# devcontainer-entrypoint: first-boot volume chown, config seeding, and
# first-boot auth import. Runs on every container start, idempotent.
#
# Layout:
#   /opt/devcontainer-home/.<tool>/   Baked-in defaults (COPY at build)
#   /home/agent/.<tool>/              Named Docker volume (runtime state)
#   /mnt/host-<tool>/                 Read-only host bind (auth source)

set -e

DEFAULTS_ROOT=/opt/devcontainer-home
AGENT_HOME=/home/agent
AGENT_STATE=/workspace/.agent-state
TOOLS=(claude codex gemini forge)

# 1. Fix volume ownership on first boot (Docker creates volumes as root:root).
for tool in "${TOOLS[@]}"; do
  sudo chown -R agent:agent "$AGENT_HOME/.$tool" 2>/dev/null || true
done
sudo chown -R agent:agent "$AGENT_HOME/.config/gh" 2>/dev/null || true

# 1b. Relocate Claude + Gemini transcript dirs to /workspace bind mount for
#     host-visible analysis. Claude auto-memory (projects/<hash>/memory/) rides
#     along as a child of projects/. Codex skipped: guards against symlinked
#     state roots. Must run pre-session — live fds would be severed.
relocate_symlink() {
  local vol_path="$1"
  local ws_path="$2"
  mkdir -p "$ws_path"
  if [ -d "$vol_path" ] && [ ! -L "$vol_path" ]; then
    rsync -a "$vol_path/" "$ws_path/" 2>/dev/null || true
    rm -rf "$vol_path"
  fi
  ln -sfn "$ws_path" "$vol_path"
}

for sub in projects todos shell-snapshots; do
  relocate_symlink "$AGENT_HOME/.claude/$sub" "$AGENT_STATE/claude/$sub"
done
relocate_symlink "$AGENT_HOME/.gemini/tmp" "$AGENT_STATE/gemini/tmp"

# Migration: sessions/ is per-PID liveness metadata (not transcripts) — was
# pointless to relocate. Clean up stale symlink + orphan workspace dir.
if [ -L "$AGENT_HOME/.claude/sessions" ]; then
  rm "$AGENT_HOME/.claude/sessions"
fi
rm -rf "$AGENT_STATE/claude/sessions"

# 1c. Archon: ARCHON_HOME=/workspace/.archon (set in devcontainer.json) makes
#     state persist on the bind mount. workspaces symlink still required for
#     worktree I/O (archon-paths.ts:251). Legacy .archon/.archon/workflows
#     bridge dropped — current archon reads /workspace/.archon/workflows
#     directly; old nested dir is cleaned up if present.
rm -f "$AGENT_HOME/.archon"
ARCHON_ROOT=/workspace/.archon
mkdir -p "$ARCHON_ROOT/workflows" "$AGENT_HOME/.archon-worktrees"
rm -rf "$ARCHON_ROOT/.archon"
ln -sfn "$AGENT_HOME/.archon-worktrees" "$ARCHON_ROOT/workspaces"

# 2. Seed config from image defaults.
#    Top-level files: overwrite every boot so repo edits propagate.
#    Managed subdirs: mirror with --delete (stale entries removed).
#    Other volume content (projects/, .credentials.json, etc.) is untouched.
MANAGED_SUBDIRS=(commands agents hooks)

for tool in "${TOOLS[@]}"; do
  src="$DEFAULTS_ROOT/.$tool"
  dst="$AGENT_HOME/.$tool"
  [ -d "$src" ] || continue

  find "$src" -maxdepth 1 -type f -print0 2>/dev/null | \
    while IFS= read -r -d '' f; do
      cp -f "$f" "$dst/$(basename "$f")"
    done

  for subdir in "${MANAGED_SUBDIRS[@]}"; do
    [ -d "$src/$subdir" ] || continue
    mkdir -p "$dst/$subdir"
    rsync -a --delete --no-owner --no-group \
      "$src/$subdir/" "$dst/$subdir/"
  done
done

# 2a. Shared skills dir: one canonical location at /workspace/.devcontainer/skills,
#     symlinked into every tool's home. Bind-mounted, host-editable.
SHARED_SKILLS=/workspace/.devcontainer/skills
for tool in "${TOOLS[@]}"; do
  dst="$AGENT_HOME/.$tool"
  [ -d "$dst" ] || continue
  target="$dst/skills"
  if [ -L "$target" ] && [ "$(readlink "$target")" = "$SHARED_SKILLS" ]; then
    continue
  fi
  rm -rf "$target"
  ln -sfn "$SHARED_SKILLS" "$target"
done

# 2b. Install Claude Code plugins (idempotent — skips if already installed).
#     Registration lives in ~/.claude.json inside the volume, so this must run
#     at boot (not build time). Needs network on first install.
if command -v claude >/dev/null 2>&1; then
  if ! claude plugin list 2>/dev/null | grep -q "codex@openai-codex"; then
    claude plugin marketplace add openai/codex-plugin-cc 2>&1 || true
    claude plugin install codex@openai-codex --scope user 2>&1 || true
  fi
fi

# 3. Auth import from host binds.
#    Import on first boot, then refresh when the host credential is newer. This
#    keeps browser-based OAuth on the host, where localhost callbacks work, while
#    letting the container recover from expired copied credentials after restart.
import_auth() {
  local src="$1" dst="$2"
  if [ ! -f "$src" ]; then
    return
  fi

  if [ ! -f "$dst" ] || [ "$src" -nt "$dst" ]; then
    if [ -f "$dst" ]; then
      cp -f "$dst" "$dst.backup.$(date +%s)" 2>/dev/null || true
    fi
    cp -f "$src" "$dst"
    chmod 600 "$dst"
  fi
}

import_auth /mnt/host-claude/.credentials.json "$AGENT_HOME/.claude/.credentials.json"
import_auth /mnt/host-codex/auth.json           "$AGENT_HOME/.codex/auth.json"
import_auth /mnt/host-gemini/oauth_creds.json   "$AGENT_HOME/.gemini/oauth_creds.json"
import_auth /mnt/host-forge/.credentials.json     "$AGENT_HOME/.forge/.credentials.json"
import_auth /mnt/host-forge/.mcp-credentials.json "$AGENT_HOME/.forge/.mcp-credentials.json"

# 4. Align docker group GID with host's /var/run/docker.sock (varies per host).
#    New docker execs re-read /etc/group, so interactive shells pick up the
#    realigned GID even though the entrypoint process itself can't.
if [ -S /var/run/docker.sock ]; then
  sock_gid=$(stat -c '%g' /var/run/docker.sock)
  current_gid=$(getent group docker | cut -d: -f3 || true)
  if [ "$current_gid" != "$sock_gid" ]; then
    if ! sudo groupmod -g "$sock_gid" docker 2>/dev/null; then
      # GID collision (e.g. staff on 50) — add agent to the owning group instead.
      sock_group=$(getent group "$sock_gid" | cut -d: -f1 || true)
      [ -n "$sock_group" ] && sudo usermod -aG "$sock_group" agent
    fi
  fi
fi

# 5. Hand off to CMD.
exec "$@"
