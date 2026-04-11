FROM node:20

ARG TZ
ENV TZ="$TZ"

# Install basic development tools
RUN apt-get update && apt-get install -y --no-install-recommends \
  less \
  git \
  procps \
  sudo \
  fzf \
  zsh \
  man-db \
  unzip \
  gnupg2 \
  gh \
  jq \
  nano \
  vim \
  rsync \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Rename the pre-existing node user to agent (UID 1000 preserved)
ARG USERNAME=agent
RUN usermod -l $USERNAME -d /home/$USERNAME -m node && \
  groupmod -n $USERNAME node

# Ensure agent user has access to /usr/local/share/npm-global
RUN mkdir -p /usr/local/share/npm-global && \
  chown $USERNAME:$USERNAME /usr/local/share/npm-global

# Persist bash history
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  && mkdir /commandhistory \
  && touch /commandhistory/.bash_history \
  && chown -R $USERNAME /commandhistory

ENV DEVCONTAINER=true

# Create workspace and tool home directories (volumes will mount on top of these)
RUN mkdir -p /workspace /home/$USERNAME/.claude /home/$USERNAME/.codex /home/$USERNAME/.gemini && \
  chown -R $USERNAME:$USERNAME /workspace /home/$USERNAME/.claude /home/$USERNAME/.codex /home/$USERNAME/.gemini

# Host-side bind-mount targets (read-only dirs for first-boot auth import)
RUN mkdir -p /mnt/host-claude /mnt/host-codex /mnt/host-gemini

WORKDIR /workspace

# Install Docker CLI
RUN install -m 0755 -d /etc/apt/keyrings && \
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc && \
  chmod a+r /etc/apt/keyrings/docker.asc && \
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list && \
  apt-get update && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin docker-buildx-plugin && \
  apt-get clean && rm -rf /var/lib/apt/lists/* && \
  groupadd -g 999 docker && usermod -aG docker $USERNAME

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Install bun (system-wide binary; globals still land in $HOME/.bun)
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

# Grant agent passwordless sudo (needed by entrypoint for first-boot volume chown;
# also useful for interactive apt installs). Done before USER switch so we only
# flip user once, below.
RUN echo "$USERNAME ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$USERNAME-all && \
  chmod 0440 /etc/sudoers.d/$USERNAME-all

# Bake reproducible home-dir defaults into the image at /opt/devcontainer-home.
# Entrypoint rsyncs these into the named volumes on every container start.
COPY --chown=$USERNAME:$USERNAME home/ /opt/devcontainer-home/

# Entrypoint handles first-boot volume ownership, config seeding, and auth import.
COPY --chown=root:root --chmod=0755 entrypoint.sh /usr/local/bin/devcontainer-entrypoint

USER $USERNAME

ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV BUN_INSTALL=/home/agent/.bun
ENV PATH=$PATH:/usr/local/share/npm-global/bin:/home/agent/.local/bin:/home/agent/.bun/bin
ENV SHELL=/bin/zsh
ENV EDITOR=nano
ENV VISUAL=nano

# Install zsh with plugins
ARG ZSH_IN_DOCKER_VERSION=1.2.0
RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/v${ZSH_IN_DOCKER_VERSION}/zsh-in-docker.sh)" -- \
  -p git \
  -p fzf \
  -a "source /usr/share/doc/fzf/examples/key-bindings.zsh" \
  -a "source /usr/share/doc/fzf/examples/completion.zsh" \
  -a "export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  -x

# Install coding CLIs (Claude Code, OpenAI Codex, Gemini) via bun
RUN bun install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli

ENTRYPOINT ["/usr/local/bin/devcontainer-entrypoint"]
CMD ["sleep", "infinity"]
