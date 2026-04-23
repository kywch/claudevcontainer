# claudevcontainer

Devcontainer + VPS deployment for AI-assisted development with Claude Code, Codex, Gemini CLI, and Forge, plus Archon as a Telegram/Slack/Discord bot.

## Architecture

Two deployment modes share one repo:

- **Local**: VS Code devcontainer (`sleep infinity`), user-driven. Image built from `.devcontainer/Dockerfile`.
- **VPS**: `ghcr.io/coleam00/archon` as a long-lived bot, plus an optional workstation container (same devcontainer image).

Both containers bind-mount `./` to `/workspace`. The bot's Archon state (`/.archon`, named volume) is separate from the CLI's (`/workspace/.archon`, bind mount) — no shared SQLite, no race conditions. Git branches are shared via the same `.git` directory.

```
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
| `.devcontainer/Dockerfile` | Devcontainer image: bun, node 20, Claude/Codex/Gemini/Forge CLIs, rtk hooks, Archon CLI |
| `.devcontainer/entrypoint.sh` | First-boot: volume chown, config seeding, host auth import, transcript relocation, Docker GID alignment |
| `.devcontainer/devcontainer.json` | VS Code config: GPU passthrough (`--gpus=all`), volume mounts, host auth bind mounts |
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
6. **Docker GID alignment** — aligns the container's `docker` group GID with the host socket's GID so `docker` commands work without sudo.

## Environment variables (VPS)

See `.env.vps.example` for the full list. Key options:

- Claude auth (pick one): `CLAUDE_USE_GLOBAL_AUTH=true` (subscription — Max/Team/Enterprise, run `claude /login` after boot), `CLAUDE_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, or third-party provider via `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`
- `DEFAULT_AI_ASSISTANT` — `claude` (default) or `codex`
- `TELEGRAM_STREAMING_MODE` — `stream` (real-time edits) or `batch` (complete response)
- `GH_TOKEN` — optional, for cloning private repos and creating PRs
- `ARCHON_VERSION` — not in the template; set it in `.env.vps` or edit the image tag in `docker-compose.vps.yml` directly

## GPU support

`devcontainer.json` has `"--gpus=all"` commented out in `runArgs` and sets `NVIDIA_VISIBLE_DEVICES=all` in `containerEnv`. Uncomment the `runArgs` line to enable GPU passthrough (requires NVIDIA GPU + drivers on host).
