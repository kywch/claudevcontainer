# claudevcontainer

A devcontainer for AI-assisted development with [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://github.com/openai/codex), and [Gemini CLI](https://github.com/google/gemini-cli), plus a VPS deployment path that exposes the same workspace via Telegram (Slack/Discord optional).

## Local dev setup

Prerequisites: [Docker](https://docs.docker.com/get-docker/) + [VS Code](https://code.visualstudio.com/) with the [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension.

> **GPU note:** To enable GPU passthrough, uncomment `"--gpus=all"` in `runArgs` in `.devcontainer/devcontainer.json`.

1. Clone and open in VS Code:
   ```bash
   git clone git@github.com:kywch/claudevcontainer.git && code claudevcontainer
   ```
2. **Reopen in Container** (or Cmd/Ctrl+Shift+P → "Dev Containers: Reopen in Container"). First build takes a few minutes; rebuilds are cached.
3. Authenticate the CLIs you want to use:
   ```bash
   claude        # subscription login (Max/Team/Enterprise) or API key
   codex login
   gemini        # OAuth flow
   gh auth login
   ```
   If you're already authenticated on the host, credentials are imported automatically. Host credentials are also refreshed into the container on restart when the host copy is newer, so renew browser-based auth on the host rather than inside Docker. Credentials persist in named Docker volumes across rebuilds. For third-party API providers (e.g. [Z.AI](https://docs.z.ai/devpack/tool/claude)), configure `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` in Claude's settings.

   To recover from expired Claude auth in the container:
   ```bash
   claude auth login          # on the host
   # then restart/rebuild the devcontainer so the entrypoint refreshes ~/.claude
   ```

### What's in the image

- **Claude Code**, **Codex**, **Gemini CLI** — installed via bun, with [rtk](https://github.com/rtk-ai/rtk) token-compression hooks (~60–90% savings on tool output)
- **Archon CLI** (v0.3.5) — `archon workflow run`, `archon chat`, `archon serve`
- **Docker CLI** — host socket pass-through
- **Dev tools** — zsh + plugins, fzf, gh, jq, nano, vim, uv, bun, node 20

### Testing workflows locally

```bash
archon workflow list                                    # see what's available
archon workflow run archon-assist "explain this repo"   # one-shot
archon chat "what does the orchestrator do?"            # conversational
```

Workflow files are in [.archon/workflows/](.archon/workflows/). Edit any YAML, save, run — changes take effect immediately. See [.archon/workflows/README.md](.archon/workflows/README.md) for details.

## VPS deployment

Deploy the Archon server as a Telegram bot (with optional Slack/Discord) on any Linux VPS with Docker.

### First-time setup

```bash
ssh your-vps
git clone git@github.com:kywch/claudevcontainer.git ~/deploy && cd ~/deploy
cp .env.vps.example .env.vps
```

Edit `.env.vps`:

1. **Telegram** — get a bot token from [@BotFather](https://t.me/BotFather), set `TELEGRAM_BOT_TOKEN`. Optionally restrict access with `TELEGRAM_ALLOWED_USER_IDS` (get your ID from [@userinfobot](https://t.me/userinfobot)).
2. **Claude auth** — pick one:
   - **Subscription** (Max/Team/Enterprise) — set `CLAUDE_USE_GLOBAL_AUTH=true`, then `docker exec -it archon claude /login` after first boot.
   - **API key** — `CLAUDE_API_KEY=sk-ant-...`
   - **OAuth token** — `CLAUDE_CODE_OAUTH_TOKEN=...`
   - **Third-party provider** — set `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` (e.g. [Z.AI devpack](https://docs.z.ai/devpack/tool/claude)).

See `.env.vps.example` for all options (`DEFAULT_AI_ASSISTANT`, `GH_TOKEN`, streaming modes, Slack/Discord tokens).

Start the bot:

```bash
docker compose -f docker-compose.vps.yml up -d archon
docker compose -f docker-compose.vps.yml logs -f archon   # verify startup
```

The bot uses outbound connections only (Telegram long-polling) — no ports need to be exposed.

### Adding projects

Archon doesn't clone repos — you do that manually. Clone into the deployment directory and Archon picks them up via Git:

```bash
cd ~/deploy && git clone git@github.com:org/my-project.git
```

No restart needed; the bot can operate on any repo under `/workspace`.

### Optional: workstation container on VPS

```bash
docker compose -f docker-compose.vps.yml up -d              # starts both services
docker exec -it workstation zsh                              # attach
```

Or connect via VS Code: Remote-SSH to the VPS, then "Dev Containers: Attach to Running Container" → `workstation`.

## Workflow: local → VPS

```
 LOCAL                                  VPS
 ─────                                  ───
 1. Edit .archon/workflows/*.yaml
 2. Test: archon workflow run <name>
 3. git commit && git push
                                        4. git pull
                                        5. docker compose -f docker-compose.vps.yml restart archon
                                        6. Chat via Telegram — bot uses updated workflows
```

## Upgrading Archon

**Local dev:** bump `ARCHON_VERSION` in [.devcontainer/Dockerfile](.devcontainer/Dockerfile) and rebuild the devcontainer.

**VPS:** edit the image tag in [docker-compose.vps.yml](docker-compose.vps.yml) (or set `ARCHON_VERSION` in `.env.vps`), then:

```bash
docker compose -f docker-compose.vps.yml pull archon
docker compose -f docker-compose.vps.yml up -d archon
```

After upgrading, diff your committed workflows against upstream defaults. See [.archon/workflows/README.md](.archon/workflows/README.md#how-to-upgrade-archon) for the procedure.

## Repository structure

```
.
├── .devcontainer/          # Dockerfile, entrypoint, baked home-dir defaults
├── .archon/workflows/      # Archon workflow YAMLs (committed, editable)
├── CLAUDE.md               # Agent context: architecture, internals, env vars
├── docker-compose.vps.yml  # VPS deployment: archon bot + workstation
├── .env.vps.example        # Template for VPS env vars
└── <project dirs>/         # Your work (auto-research, benchflow, etc.)
```
