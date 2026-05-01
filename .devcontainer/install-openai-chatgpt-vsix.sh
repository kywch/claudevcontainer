#!/usr/bin/env bash

set -euo pipefail

extension_id="openai.chatgpt"
target_major="${OPENAI_CHATGPT_REMOTE_MAJOR:-26}"
target_platform="${OPENAI_CHATGPT_REMOTE_PLATFORM:-linux-x64}"

if command -v codium >/dev/null 2>&1; then
  editor_cli="codium"
elif command -v code >/dev/null 2>&1; then
  editor_cli="code"
else
  echo "[codex-vsix] Skipping: no VS Code-compatible CLI found in container."
  exit 0
fi

if [ -z "${VSCODE_IPC_HOOK:-}" ] && [ -z "${VSCODE_IPC_HOOK_CLI:-}" ]; then
  echo "[codex-vsix] Skipping: no attached editor IPC hook found."
  exit 0
fi

current_version="$("$editor_cli" --list-extensions --show-versions 2>/dev/null | awk -F@ -v ext="$extension_id" '$1 == ext { print $2; exit }')"
if [[ "$current_version" == "$target_major".* ]]; then
  echo "[codex-vsix] Remote $extension_id already on $current_version."
  exit 0
fi

find_cached_vsix() {
  local cache_dir

  for cache_dir in \
    /mnt/host-vscodium-vsix-cache \
    /mnt/host-vscode-vsix-cache
  do
    [ -d "$cache_dir" ] || continue
    find "$cache_dir" -maxdepth 1 -type f \
      -name "${extension_id}-${target_major}.*-${target_platform}" \
      -print
  done | sort -V | tail -n 1
}

source_vsix="$(find_cached_vsix || true)"
if [ -z "$source_vsix" ]; then
  echo "[codex-vsix] No cached ${target_major}.x VSIX found on the host; keeping ${current_version:-marketplace install}."
  exit 0
fi

tmp_vsix="$(mktemp --suffix=.vsix)"
cleanup() {
  rm -f "$tmp_vsix"
}
trap cleanup EXIT

cp "$source_vsix" "$tmp_vsix"

echo "[codex-vsix] Installing remote $extension_id from $(basename "$source_vsix")."
"$editor_cli" --uninstall-extension "$extension_id" >/dev/null 2>&1 || true
if ! "$editor_cli" --install-extension "$tmp_vsix" --force >/dev/null 2>&1; then
  echo "[codex-vsix] VSIX install failed; leaving the current remote extension state unchanged."
  exit 0
fi

installed_version="$("$editor_cli" --list-extensions --show-versions 2>/dev/null | awk -F@ -v ext="$extension_id" '$1 == ext { print $2; exit }')"
if [[ "$installed_version" == "$target_major".* ]]; then
  echo "[codex-vsix] Remote $extension_id is now $installed_version."
else
  echo "[codex-vsix] Install completed, but the active remote version is ${installed_version:-unknown}."
fi
