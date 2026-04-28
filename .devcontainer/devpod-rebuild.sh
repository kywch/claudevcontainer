#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: .devcontainer/devpod-rebuild.sh [options]

Rebuild or create this repo's DevPod workspace without relying on the
flaky DevPod desktop integration.

Options:
  --workspace NAME   Override the DevPod workspace id. Default: repo folder name
  --provider NAME    DevPod provider to use. Default: docker
  --ide NAME         IDE mode for DevPod. Default: codium
                     Common values: codium, none, openvscode
  --gpu              Use the GPU-enabled devcontainer profile
  --devcontainer PATH
                     Override the devcontainer config path explicitly
  --open             Allow DevPod to open the chosen IDE after startup
  --reset            Fully reset the workspace instead of recreating the container
  --path PATH        Workspace source path. Default: repo root
  --dry-run          Print the resolved devpod command without running it
  -h, --help         Show this help text

Examples:
  .devcontainer/devpod-rebuild.sh
  .devcontainer/devpod-rebuild.sh --gpu
  .devcontainer/devpod-rebuild.sh --open
  .devcontainer/devpod-rebuild.sh --ide openvscode --open
  .devcontainer/devpod-rebuild.sh --workspace docker --dry-run
EOF
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

workspace_path="$repo_root"
workspace_id="$(basename "$repo_root")"
provider="docker"
ide="codium"
open_ide=false
gpu=false
reset=false
dry_run=false
devcontainer_path=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace)
      workspace_id="${2:?missing workspace name}"
      shift 2
      ;;
    --provider)
      provider="${2:?missing provider name}"
      shift 2
      ;;
    --ide)
      ide="${2:?missing ide name}"
      shift 2
      ;;
    --open)
      open_ide=true
      shift
      ;;
    --gpu)
      gpu=true
      shift
      ;;
    --reset)
      reset=true
      shift
      ;;
    --devcontainer)
      devcontainer_path="${2:?missing devcontainer path}"
      shift 2
      ;;
    --path)
      workspace_path="${2:?missing workspace path}"
      shift 2
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo >&2
      usage >&2
      exit 1
      ;;
  esac
done

workspace_path="$(cd "$workspace_path" && pwd)"

if ! command -v devpod >/dev/null 2>&1; then
  echo "devpod is not installed or not on PATH" >&2
  exit 1
fi

if ! devpod provider list | sed $'s/\x1b\\[[0-9;]*m//g' | awk 'NR > 2 {print $1}' | grep -Fxq "$provider"; then
  echo "Initializing DevPod provider: $provider"
  devpod provider add "$provider"
fi

devpod provider use "$provider" >/dev/null

workspace_exists=false
if devpod list | sed $'s/\x1b\\[[0-9;]*m//g' | awk 'NR > 2 {print $1}' | grep -Fxq "$workspace_id"; then
  workspace_exists=true
fi

cmd=(devpod up --provider "$provider" --ide "$ide")
if [[ "$open_ide" == false ]]; then
  cmd+=(--open-ide=false)
fi

if [[ -z "$devcontainer_path" ]]; then
  if [[ "$gpu" == true ]]; then
    devcontainer_path=".devcontainer/devcontainer.gpu.json"
  else
    devcontainer_path=".devcontainer/devcontainer.json"
  fi
fi

if [[ -n "$devcontainer_path" ]]; then
  cmd+=(--devcontainer-path "$devcontainer_path")
fi

if [[ "$workspace_exists" == true ]]; then
  cmd+=("$workspace_id")
  if [[ "$reset" == true ]]; then
    cmd+=(--reset)
  else
    cmd+=(--recreate)
  fi
else
  cmd+=("$workspace_path" --id "$workspace_id")
fi

printf 'Workspace: %s\n' "$workspace_id"
printf 'Provider:  %s\n' "$provider"
printf 'IDE:       %s\n' "$ide"
printf 'GPU:       %s\n' "$gpu"
printf 'Config:    %s\n' "${devcontainer_path:-.devcontainer/devcontainer.json}"
printf 'Path:      %s\n' "$workspace_path"
printf 'Mode:      %s\n' "$([[ "$workspace_exists" == true ]] && { [[ "$reset" == true ]] && echo reset || echo recreate; } || echo create)"
printf 'Command:   '
printf '%q ' "${cmd[@]}"
printf '\n'

if [[ "$dry_run" == true ]]; then
  exit 0
fi

"${cmd[@]}"
