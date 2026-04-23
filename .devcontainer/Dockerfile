FROM node:20

ARG TZ
ENV TZ="$TZ"

# Base tools. Generating en_US.UTF-8 silences setlocale warnings from VS
# Code's forwarded LC_ALL (node:20 ships no generated locales).
RUN apt-get update && apt-get install -y --no-install-recommends \
    bubblewrap fzf git gh jq less locales man-db nano procps rclone rsync sudo unzip vim zsh && \
  echo "en_US.UTF-8 UTF-8" > /etc/locale.gen && locale-gen && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

# Rename the pre-existing node user to agent (UID 1000 preserved)
ARG USERNAME=agent
RUN usermod -l $USERNAME -d /home/$USERNAME -m node && \
  groupmod -n $USERNAME node

# Filesystem setup: npm global prefix, shell history mount, workspace,
# per-tool home dirs (named volumes overlay these at runtime), and
# passwordless sudo for agent (entrypoint uses it for first-boot chown).
RUN mkdir -p /usr/local/share/npm-global /commandhistory /workspace \
             /home/$USERNAME/.claude /home/$USERNAME/.codex /home/$USERNAME/.gemini /home/$USERNAME/.forge && \
  touch /commandhistory/.bash_history && \
  chown -R $USERNAME:$USERNAME /usr/local/share/npm-global /commandhistory /workspace \
             /home/$USERNAME/.claude /home/$USERNAME/.codex /home/$USERNAME/.gemini /home/$USERNAME/.forge && \
  echo "$USERNAME ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$USERNAME-all && \
  chmod 0440 /etc/sudoers.d/$USERNAME-all

ENV DEVCONTAINER=true
WORKDIR /workspace

# Docker CLI. The docker group GID is aligned at runtime in the entrypoint
# (host socket GID varies by host), so we just create the group here.
RUN install -m 0755 -d /etc/apt/keyrings && \
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc && \
  chmod a+r /etc/apt/keyrings/docker.asc && \
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list && \
  apt-get update && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin docker-buildx-plugin && \
  apt-get clean && rm -rf /var/lib/apt/lists/* && \
  groupadd -f docker && usermod -aG docker $USERNAME

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Install bun (system-wide binary; globals still land in $HOME/.bun)
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

# rtk (Rust Token Killer) — PreToolUse hook, 60-90% token savings on Bash
# output. Pinned for reproducible rebuilds.
ARG RTK_VERSION=v0.37.2
RUN curl -fsSL "https://github.com/rtk-ai/rtk/releases/download/${RTK_VERSION}/rtk-x86_64-unknown-linux-musl.tar.gz" \
    | tar -xz -C /usr/local/bin rtk && \
  chmod 0755 /usr/local/bin/rtk

# Archon CLI. State at $ARCHON_HOME=/workspace/.archon (set in
# devcontainer.json). Pinned + checksum-verified. Final `rm -rf
# /tmp/claude-agent-sdk-*` is load-bearing: `archon version` extracts the
# bundled SDK as root at build time, causing EACCES for agent at runtime.
ARG ARCHON_VERSION=v0.3.9
RUN curl -fsSL "https://github.com/coleam00/Archon/releases/download/${ARCHON_VERSION}/archon-linux-x64" \
      -o /tmp/archon-linux-x64 && \
    curl -fsSL "https://github.com/coleam00/Archon/releases/download/${ARCHON_VERSION}/checksums.txt" \
      -o /tmp/archon-checksums.txt && \
    ( cd /tmp && grep 'archon-linux-x64$' archon-checksums.txt | sha256sum -c - ) && \
    install -m 0755 /tmp/archon-linux-x64 /usr/local/bin/archon && \
    rm /tmp/archon-linux-x64 /tmp/archon-checksums.txt && \
    /usr/local/bin/archon version | head -1 && \
    rm -rf /tmp/claude-agent-sdk-*

# Forge CLI. Bypasses upstream curl|sh so we install to /usr/local/bin
# (not the agent's ~/.local/bin + ~/.zshrc, which zsh-in-docker manages)
# and skip its fzf/bat/fd side-installs. Floats to latest — rebuild to
# update. musl build: node:20 (Bookworm) glibc 2.36 < GNU build's 2.38.
RUN curl -fsSL "https://github.com/tailcallhq/forgecode/releases/latest/download/forge-x86_64-unknown-linux-musl" \
      -o /tmp/forge && \
    install -m 0755 /tmp/forge /usr/local/bin/forge && \
    rm /tmp/forge && \
    /usr/local/bin/forge --version

USER $USERNAME

ENV HOME=/home/agent
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV BUN_INSTALL=/home/agent/.bun
ENV PATH=$PATH:/usr/local/share/npm-global/bin:/home/agent/.local/bin:/home/agent/.bun/bin
ENV SHELL=/bin/zsh
ENV EDITOR=nano
ENV VISUAL=nano
# Opt out of rtk telemetry (anonymous but on-by-default upstream)
ENV RTK_TELEMETRY_DISABLED=1

# Install zsh with plugins
ARG ZSH_IN_DOCKER_VERSION=1.2.1
RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/v${ZSH_IN_DOCKER_VERSION}/zsh-in-docker.sh)" -- \
  -p git \
  -p fzf \
  -a "source /usr/share/doc/fzf/examples/key-bindings.zsh" \
  -a "source /usr/share/doc/fzf/examples/completion.zsh" \
  -a "export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  -x

# Coding CLIs (Claude Code, Codex, Gemini) via bun. Before home/ COPY so
# config edits don't bust this cache.
# Workaround: @anthropic-ai/claude-code ships a republish-guard `prepare`
# script that exits 1 unless AUTHORIZED is set; bun runs it and silently
# skips both the bin symlink AND the `postinstall` that copies the native
# binary over bin/claude.exe. We run install.cjs by hand, then symlink.
RUN bun install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli && \
  node /home/agent/.bun/install/global/node_modules/@anthropic-ai/claude-code/install.cjs && \
  ln -sf ../install/global/node_modules/@anthropic-ai/claude-code/bin/claude.exe \
    /home/agent/.bun/bin/claude

# Home-dir defaults. Entrypoint rsyncs these into the named volumes on
# every container start. After bun install so edits are cheap to iterate.
COPY --chown=$USERNAME:$USERNAME home/ /opt/devcontainer-home/

# Bake rtk's Claude hook. Seed settings.json from baked defaults so rtk
# merges its hook into our permissions block, then copy the patched file
# back for the entrypoint's rsync. rtk >=0.37 uses an inline binary hook
# (`rtk hook claude`) — no script to copy.
RUN cp /opt/devcontainer-home/.claude/settings.json /home/agent/.claude/settings.json && \
  rtk init -g --auto-patch && \
  cp /home/agent/.claude/settings.json /opt/devcontainer-home/.claude/settings.json

# Codex prompt-level guidance (caveman style + rtk usage) is authored
# directly in .devcontainer/home/.codex/AGENTS.md and placed by the COPY
# above. `rtk init -g --codex` is intentionally NOT run — it would
# overwrite AGENTS.md with a minimal @RTK.md stub.

# Entrypoint: first-boot volume ownership, config seeding, auth import.
# Last so entrypoint.sh edits only invalidate this layer.
COPY --chmod=0755 entrypoint.sh /usr/local/bin/devcontainer-entrypoint

ENTRYPOINT ["/usr/local/bin/devcontainer-entrypoint"]
CMD ["sleep", "infinity"]
