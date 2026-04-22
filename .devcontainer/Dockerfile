FROM node:20

ARG TZ
ENV TZ="$TZ"

# Install basic development tools.
# `locales` + locale-gen: VS Code forwards LC_ALL=en_US.UTF-8 from the host,
# but the base node:20 image ships no generated locales, so every bash launch
# prints a `setlocale: cannot change locale` warning. Generating en_US.UTF-8
# silences it.
RUN apt-get update && apt-get install -y --no-install-recommends \
    bubblewrap fzf git gh jq less locales man-db nano procps rclone rsync sudo unzip vim zsh && \
  echo "en_US.UTF-8 UTF-8" > /etc/locale.gen && locale-gen && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

# Rename the pre-existing node user to agent (UID 1000 preserved)
ARG USERNAME=agent
RUN usermod -l $USERNAME -d /home/$USERNAME -m node && \
  groupmod -n $USERNAME node

# Root-level filesystem setup in one layer:
#   - npm global prefix (agent-owned so `npm install -g` works without sudo)
#   - /commandhistory mount point for the bash/zsh history volume
#   - /workspace + per-tool home dirs (named volumes overlay these at runtime)
#   - passwordless sudo for agent (entrypoint uses it for first-boot chown)
RUN mkdir -p /usr/local/share/npm-global /commandhistory /workspace \
             /home/$USERNAME/.claude /home/$USERNAME/.codex /home/$USERNAME/.gemini /home/$USERNAME/.forge && \
  touch /commandhistory/.bash_history && \
  chown -R $USERNAME:$USERNAME /usr/local/share/npm-global /commandhistory /workspace \
             /home/$USERNAME/.claude /home/$USERNAME/.codex /home/$USERNAME/.gemini /home/$USERNAME/.forge && \
  echo "$USERNAME ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$USERNAME-all && \
  chmod 0440 /etc/sudoers.d/$USERNAME-all

ENV DEVCONTAINER=true
WORKDIR /workspace

# Install Docker CLI. Note: the docker group GID is aligned at runtime in the
# entrypoint (host's /var/run/docker.sock GID varies by host), so we don't
# hardcode a GID here — just create the group so `usermod -aG` works.
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

# Install rtk (Rust Token Killer) — PreToolUse hook that compresses Bash
# output before it reaches Claude, typically 60-90% token savings. Pinned
# to a release so rebuilds are reproducible.
ARG RTK_VERSION=v0.35.0
RUN curl -fsSL "https://github.com/rtk-ai/rtk/releases/download/${RTK_VERSION}/rtk-x86_64-unknown-linux-musl.tar.gz" \
    | tar -xz -C /usr/local/bin rtk && \
  chmod 0755 /usr/local/bin/rtk

# Install Archon CLI. State lives at $ARCHON_HOME=/workspace/.archon (set in
# devcontainer.json); see entrypoint.sh step 1c. Pinned + checksum-verified.
# Final `rm -rf /tmp/claude-agent-sdk-*` is load-bearing: `archon version`
# extracts the bundled Claude Agent SDK cli.js as root at build time, which
# causes EACCES for the agent user at runtime.
ARG ARCHON_VERSION=v0.3.5
RUN curl -fsSL "https://github.com/coleam00/Archon/releases/download/${ARCHON_VERSION}/archon-linux-x64" \
      -o /tmp/archon-linux-x64 && \
    curl -fsSL "https://github.com/coleam00/Archon/releases/download/${ARCHON_VERSION}/checksums.txt" \
      -o /tmp/archon-checksums.txt && \
    ( cd /tmp && grep 'archon-linux-x64$' archon-checksums.txt | sha256sum -c - ) && \
    install -m 0755 /tmp/archon-linux-x64 /usr/local/bin/archon && \
    rm /tmp/archon-linux-x64 /tmp/archon-checksums.txt && \
    /usr/local/bin/archon version | head -1 && \
    rm -rf /tmp/claude-agent-sdk-*

# Install Forge (forgecode.dev) CLI. Bypasses the upstream curl|sh installer so
# we can (a) install to /usr/local/bin instead of mutating the agent's
# ~/.local/bin and ~/.zshrc (which zsh-in-docker manages), and (b) skip its
# fzf/bat/fd side-installs (fzf is already in apt above). Floats to latest
# like the other coding CLIs above — rebuild to update.
# Using the musl (statically-linked) variant: the GNU build requires
# glibc >= 2.38, but node:20 (Debian Bookworm) ships glibc 2.36.
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
ARG ZSH_IN_DOCKER_VERSION=1.2.0
RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/v${ZSH_IN_DOCKER_VERSION}/zsh-in-docker.sh)" -- \
  -p git \
  -p fzf \
  -a "source /usr/share/doc/fzf/examples/key-bindings.zsh" \
  -a "source /usr/share/doc/fzf/examples/completion.zsh" \
  -a "export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  -x

# Install coding CLIs (Claude Code, OpenAI Codex, Gemini) via bun.
# Placed before the home/ COPY so edits to seeded config don't bust this cache.
#
# Workaround: @anthropic-ai/claude-code ships a `prepare` script that
# `process.exit(1)`s unless AUTHORIZED is set (a republish-guard). bun runs
# prepare during global installs and then silently skips the bin symlink,
# leaving the package files in place but no `claude` on PATH. Codex and
# Gemini symlinks are created fine. We recreate the missing symlink by hand.
RUN bun install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli && \
  ln -sf ../install/global/node_modules/@anthropic-ai/claude-code/cli.js \
    /home/agent/.bun/bin/claude

# Bake reproducible home-dir defaults into the image at /opt/devcontainer-home.
# Entrypoint rsyncs these into the named volumes on every container start.
# Placed after bun install -g so edits here are cheap to iterate on.
COPY --chown=$USERNAME:$USERNAME home/ /opt/devcontainer-home/

# Bake rtk's Claude hook into the image defaults.
# rtk init writes to $HOME/.claude; we seed settings.json from our baked
# defaults first so rtk *merges* its PreToolUse hook into our permissions
# block, then copy the patched settings.json and the extracted hook script
# back to /opt/devcontainer-home so the entrypoint's rsync propagates both
# into the volume on every container start.
RUN cp /opt/devcontainer-home/.claude/settings.json /home/agent/.claude/settings.json && \
  rtk init -g --auto-patch && \
  cp /home/agent/.claude/settings.json /opt/devcontainer-home/.claude/settings.json && \
  mkdir -p /opt/devcontainer-home/.claude/hooks && \
  install -m 0755 /home/agent/.claude/hooks/rtk-rewrite.sh \
    /opt/devcontainer-home/.claude/hooks/rtk-rewrite.sh

# Bake rtk's Gemini hook into the image defaults.
# Same pattern as Claude: rtk writes a BeforeTool hook into
# /home/agent/.gemini/settings.json (absolute hook path, so HOME must be
# /home/agent at build time — which it is via ENV above). Copy the generated
# settings.json, GEMINI.md, and hook script into /opt/devcontainer-home so
# the entrypoint propagates them into the volume on every boot.
RUN rtk init -g --gemini --auto-patch && \
  mkdir -p /opt/devcontainer-home/.gemini/hooks && \
  cp /home/agent/.gemini/settings.json /opt/devcontainer-home/.gemini/settings.json && \
  cp /home/agent/.gemini/GEMINI.md     /opt/devcontainer-home/.gemini/GEMINI.md && \
  install -m 0755 /home/agent/.gemini/hooks/rtk-hook-gemini.sh \
    /opt/devcontainer-home/.gemini/hooks/rtk-hook-gemini.sh

# Bake rtk's Codex instructions into the image defaults.
# Codex has no hook mechanism; rtk installs prompt-level guidance via
# AGENTS.md + RTK.md that asks the model to prefix shell commands with `rtk`.
# Weaker savings than Claude/Gemini (depends on model compliance), but still
# worth having. --auto-patch is rejected with --codex, so we run it plain.
RUN rtk init -g --codex && \
  mkdir -p /opt/devcontainer-home/.codex && \
  cp /home/agent/.codex/AGENTS.md /opt/devcontainer-home/.codex/AGENTS.md && \
  cp /home/agent/.codex/RTK.md    /opt/devcontainer-home/.codex/RTK.md

# Entrypoint handles first-boot volume ownership, config seeding, and auth import.
# Placed last so entrypoint.sh edits only invalidate this one layer.
COPY --chmod=0755 entrypoint.sh /usr/local/bin/devcontainer-entrypoint

ENTRYPOINT ["/usr/local/bin/devcontainer-entrypoint"]
CMD ["sleep", "infinity"]
