#!/usr/bin/env bash

set -euo pipefail

extension_id="openai.chatgpt"
expected_version="${OPENAI_CHATGPT_REMOTE_VERSION:-0.4.78}"
minimum_codex_cli_version="${OPENAI_CHATGPT_MIN_CODEX_CLI_VERSION:-0.130.0}"

extension_roots=(
  "$HOME/.vscode/extensions"
  "$HOME/.vscode-oss/extensions"
  "$HOME/.vscodium/extensions"
  "$HOME/.vscodium-server/extensions"
  "$HOME/.vscode-server/extensions"
  "$HOME/.vscode-server-insiders/extensions"
  "$HOME/.openvscode-server/extensions"
  "$HOME/.cursor-server/extensions"
  "$HOME/.windsurf-server/extensions"
)

find_editor_cli() {
  if command -v codium >/dev/null 2>&1; then
    command -v codium
    return 0
  fi
  if command -v code >/dev/null 2>&1; then
    command -v code
    return 0
  fi

  find "$HOME/.vscodium-server/bin" "$HOME/.vscode-server/bin" \
    "$HOME/.vscode-server-insiders/bin" "$HOME/.openvscode-server/bin" \
    "$HOME/.cursor-server/bin" "$HOME/.windsurf-server/bin" \
    -path "*/bin/remote-cli/codium" -o \
    -path "*/bin/remote-cli/code" \
    2>/dev/null | sort -V | tail -n 1
}

installed_version_from_disk() {
  local root package_json

  for root in "${extension_roots[@]}"; do
    [ -d "$root" ] || continue
    find "$root" -maxdepth 2 -type f -path "*/package.json" -print
  done | while IFS= read -r package_json; do
    node -e '
      const fs = require("fs");
      const p = process.argv[1];
      const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
      if (pkg.publisher === "openai" && pkg.name === "chatgpt") {
        console.log(pkg.version);
      }
    ' "$package_json" 2>/dev/null || true
  done | sort -V | tail -n 1
}

installed_version_from_cli() {
  local editor_cli="$1"

  if [ -z "$editor_cli" ]; then
    return 0
  fi

  "$editor_cli" --list-extensions --show-versions 2>/dev/null |
    awk -F@ -v ext="$extension_id" '$1 == ext { print $2; exit }'
}

version_lt() {
  [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n 1)" != "$2" ]
}

codex_version() {
  local codex_bin="$1"

  [ -x "$codex_bin" ] || return 0
  "$codex_bin" --version 2>/dev/null | awk '{ print $2; exit }'
}

codex_platform_dir() {
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) echo "linux-x86_64" ;;
    Linux-aarch64|Linux-arm64) echo "linux-aarch64" ;;
    Darwin-x86_64) echo "macos-x86_64" ;;
    Darwin-arm64) echo "macos-aarch64" ;;
  esac
}

find_cli_codex_binary() {
  local candidate

  for candidate in \
    "$HOME/.bun/install/global/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex/codex" \
    "$HOME/.bun/install/global/node_modules/@openai/codex-linux-arm64/vendor/aarch64-unknown-linux-musl/codex/codex" \
    "$HOME"/.nvm/versions/node/*/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex/codex \
    "$HOME"/.nvm/versions/node/*/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-arm64/vendor/aarch64-unknown-linux-musl/codex/codex \
    "$(command -v codex 2>/dev/null || true)"
  do
    [ -x "$candidate" ] || continue
    echo "$candidate"
    return 0
  done
}

patch_extension_codex_binary() {
  local root extension_dir bundled_bin bundled_version cli_bin cli_version platform_dir

  cli_bin="$(find_cli_codex_binary || true)"
  [ -n "$cli_bin" ] || return 0
  cli_version="$(codex_version "$cli_bin" || true)"
  [ -n "$cli_version" ] || return 0
  if version_lt "$cli_version" "$minimum_codex_cli_version"; then
    return 0
  fi
  platform_dir="$(codex_platform_dir || true)"
  [ -n "$platform_dir" ] || return 0

  for root in "${extension_roots[@]}"; do
    [ -d "$root" ] || continue
    for extension_dir in "$root"/openai.chatgpt-*; do
      [ -d "$extension_dir" ] || continue
      bundled_bin="$extension_dir/bin/$platform_dir/codex"
      [ -e "$bundled_bin" ] || continue
      bundled_version="$(codex_version "$bundled_bin" || true)"
      if [ -z "$bundled_version" ] || version_lt "$bundled_version" "$minimum_codex_cli_version"; then
        cp -f "$cli_bin" "$bundled_bin"
        chmod 755 "$bundled_bin"
        echo "[codex-vsix] Patched extension Codex CLI ${bundled_version:-unknown} -> $cli_version at ${bundled_bin#$HOME/}."
      fi
    done
  done
}

find_cached_vsix() {
  local cache_dir

  for cache_dir in \
    /mnt/host-vscodium-vsix-cache \
    /mnt/host-vscode-vsix-cache
  do
    [ -d "$cache_dir" ] || continue
    find "$cache_dir" -maxdepth 1 -type f \
      \( -name "${extension_id}-${expected_version}*.vsix" \
         -o -name "${extension_id}-${expected_version}*" \) \
      -print
  done | sort -V | tail -n 1
}

current_version="$(installed_version_from_disk || true)"
if [ "$current_version" = "$expected_version" ]; then
  patch_extension_codex_binary
  echo "[codex-vsix] Remote $extension_id is $current_version."
  exit 0
fi

editor_cli="$(find_editor_cli || true)"
cli_version="$(installed_version_from_cli "$editor_cli" || true)"
if [ "$cli_version" = "$expected_version" ]; then
  patch_extension_codex_binary
  echo "[codex-vsix] Remote $extension_id is $cli_version."
  exit 0
fi

source_vsix="$(find_cached_vsix || true)"
if [ -n "$source_vsix" ] && [ -n "$editor_cli" ]; then
  tmp_vsix="$(mktemp --suffix=.vsix)"
  cleanup() {
    rm -f "$tmp_vsix"
  }
  trap cleanup EXIT

  cp "$source_vsix" "$tmp_vsix"
  echo "[codex-vsix] Installing remote $extension_id from $(basename "$source_vsix")."
  "$editor_cli" --uninstall-extension "$extension_id" >/dev/null 2>&1 || true
  "$editor_cli" --install-extension "$tmp_vsix" --force >/dev/null 2>&1 || true
fi

current_version="$(installed_version_from_disk || true)"
if [ "$current_version" = "$expected_version" ]; then
  patch_extension_codex_binary
  echo "[codex-vsix] Remote $extension_id is now $current_version."
  exit 0
fi

if [ -z "${VSCODE_IPC_HOOK:-}" ] && [ -z "${VSCODE_IPC_HOOK_CLI:-}" ]; then
  echo "[codex-vsix] Expected $extension_id $expected_version, found ${current_version:-none}; waiting for editor extension sync."
  exit 0
fi

if [ -n "$editor_cli" ]; then
  echo "[codex-vsix] Installing remote $extension_id from the editor marketplace."
  if ! "$editor_cli" --install-extension "$extension_id" --force; then
    echo "[codex-vsix] Editor CLI install failed."
  fi
fi

current_version="$(installed_version_from_disk || true)"
if [ "$current_version" = "$expected_version" ]; then
  patch_extension_codex_binary
  echo "[codex-vsix] Remote $extension_id is now $current_version."
else
  echo "[codex-vsix] Expected $extension_id $expected_version, found ${current_version:-none}."
fi
