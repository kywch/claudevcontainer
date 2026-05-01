# claudevcontainer

Mirror of `CLAUDE.md` for tools that read `AGENTS.md`. Keep both files in sync.

Devcontainer + VPS deployment for AI-assisted development with Claude Code, Codex, Gemini CLI, and Forge, plus Archon as a Telegram/Slack/Discord bot.

## Architecture

Two deployment modes share one repo:

- **Local**: VS Code devcontainer (`sleep infinity`), user-driven. Image built from `.devcontainer/Dockerfile`.
- **VPS**: `ghcr.io/coleam00/archon` as a long-lived bot, plus an optional workstation container (same devcontainer image).

Both containers bind-mount `./` to `/workspace`. The bot's Archon state (`/.archon`, named volume) is separate from the CLI's (`/workspace/.archon`, bind mount) — no shared SQLite, no race conditions. Git branches are shared via the same `.git` directory.

```text
docker-compose.vps.yml
├── archon   (ghcr.io/coleam00/archon:0.3.9)
│   ├── bind: ./  →  /workspace
│   ├── vol:  archon_state → /.archon
│   └── env:  TELEGRAM_BOT_TOKEN, PORT=3000, ARCHON_DOCKER=true
│
└── workstation   (.devcontainer image, optional)
    ├── bind: ./  →  /workspace
    ├── bind: /var/run/docker.sock  (host Docker access)
    └── vol:  claude-home, codex-home, gemini-home, forge-home, gh-config
```

## Key files

| File | Purpose |
|---|---|
| `.devcontainer/Dockerfile` | Devcontainer image: bun, node 20, Claude/Codex/Gemini/Forge CLIs, Claude rtk hook, Archon CLI |
| `.devcontainer/entrypoint.sh` | First-boot: volume chown, config seeding, host auth import, transcript relocation, DevPod Docker credstore removal, Docker GID alignment |
| `.devcontainer/devcontainer.json` | Shared VS Code/VSCodium config: volume mounts, host auth bind mounts, and the Codium-safe extension set |
| `.devcontainer/devcontainer.gpu.json` | Shared GPU-enabled variant for hosts with NVIDIA passthrough configured |
| `.devcontainer/install-openai-chatgpt-vsix.sh` | Post-attach helper that upgrades the remote `openai.chatgpt` extension to the newest cached host-side `26.x` VSIX when available |
| `.devcontainer/devpod-rebuild.sh` | Preferred local DevPod rebuild wrapper for agents after `.devcontainer/` edits |
| `docker-compose.vps.yml` | VPS services: archon bot + workstation |
| `.env.vps.example` | Template for VPS env vars (auth, bot tokens, streaming mode) |
| `.archon/workflows/` | Archon workflow YAMLs — committed, editable, take effect immediately for CLI |

## Entrypoint behavior (`entrypoint.sh`)

Runs on every container start, idempotent:

1. **Volume ownership** — `chown agent:agent` on tool home dirs (Docker creates volumes as root).
2. **Transcript relocation** — symlinks Claude `projects/`, `todos/`, `shell-snapshots/` and Gemini `tmp/` to `/workspace/.agent-state/` so transcripts are visible on the host bind mount.
3. **Archon symlinks** — bridges `/workspace/.archon/.archon/workflows` for global workflow discovery and `workspaces` → `~/.archon-worktrees` for worktree I/O.
4. **Config seeding** — copies baked-in defaults from `/opt/devcontainer-home/` into tool home volumes. Top-level files overwrite every boot; managed subdirs (`commands`, `agents`, `skills`, `hooks`) mirror with `--delete`.
5. **Host auth import** — on first boot (and refreshes when the host copy is newer) copies `.credentials.json` / `auth.json` / `oauth_creds.json` / `.mcp-credentials.json` from read-only host bind mounts (`/mnt/host-*`) into volumes. If already authenticated on the host, no re-auth needed.
6. **DevPod Docker credstore removal** — removes `credsStore: devpod` and DevPod-specific `credHelpers` from `~/.docker/config.json` so `docker login` inside the container controls Docker Hub pushes.
7. **Docker GID alignment** — aligns the container's `docker` group GID with the host socket's GID so `docker` commands work without sudo.

## Environment variables (VPS)

See `.env.vps.example` for the full list. Key options:

- Claude auth (pick one): `CLAUDE_USE_GLOBAL_AUTH=true` (subscription — Max/Team/Enterprise, run `claude /login` after boot), `CLAUDE_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, or third-party provider via `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`
- `DEFAULT_AI_ASSISTANT` — `claude` (default) or `codex`
- `TELEGRAM_STREAMING_MODE` — `stream` (real-time edits) or `batch` (complete response)
- `GH_TOKEN` — optional, for cloning private repos and creating PRs
- `ARCHON_VERSION` — not in the template; set it in `.env.vps` or edit the image tag in `docker-compose.vps.yml` directly

## GPU support

`devcontainer.json` keeps GPU passthrough commented out by default. Uncomment the GPU-related `runArgs` and `containerEnv` lines only on hosts with the required NVIDIA/runtime or `/dev/dri` device support.

For DevPod rebuilds on NVIDIA hosts, prefer `./.devcontainer/devpod-rebuild.sh --gpu`. That uses `.devcontainer/devcontainer.gpu.json` so the workspace starts with GPU device requests and `nvidia-smi` access.

The helper uses `.devcontainer/devcontainer.json` by default and switches to `.devcontainer/devcontainer.gpu.json` when `--gpu` is passed.

## Agent workflow

When an agent changes `.devcontainer/Dockerfile`, `.devcontainer/devcontainer.json`, or `.devcontainer/entrypoint.sh`, prefer rebuilding through `./.devcontainer/devpod-rebuild.sh` instead of the VSCodium DevPod UI command.

- Default rebuild: `./.devcontainer/devpod-rebuild.sh`
- GPU rebuild: `./.devcontainer/devpod-rebuild.sh --gpu`
- Rebuild and open Codium: `./.devcontainer/devpod-rebuild.sh --open`
- Browser fallback if Codium attach is flaky: `./.devcontainer/devpod-rebuild.sh --ide openvscode --open`
- Explicit profile override: `./.devcontainer/devpod-rebuild.sh --devcontainer <path>`
