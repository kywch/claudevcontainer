# Archon workflows

This directory holds the Archon workflow YAMLs this container runs. They are
committed to the outer `claudevcontainer` repo so they're transparent (you can
read them alongside any other repo file), editable (changes take effect
immediately), and version-controlled (git history tracks your customizations).

**Mental model**: Archon the CLI is the execution engine (plumbing, easily
upgraded). These YAMLs are the content (what actually runs when you invoke a
workflow). You own the workflows; the engine is a dependency.

## How discovery works

The devcontainer sets `ARCHON_HOME=/workspace/.archon` (see
`.devcontainer/devcontainer.json`). Archon's workflow discovery has three
tiers, in priority order (from
`packages/workflows/src/workflow-discovery.ts` in the Archon source):

1. **Binary defaults** — bundled in the `archon` binary at compile time.
2. **Global** — `$ARCHON_HOME/.archon/workflows/*.yaml` — overrides defaults
   by filename. The devcontainer entrypoint (step 1c in
   `.devcontainer/entrypoint.sh`) maintains a symlink at
   `$ARCHON_HOME/.archon/workflows` → this directory so the literal
   `$ARCHON_HOME/.archon/workflows/` path Archon looks at actually resolves
   here.
3. **Repo** — `<cwd>/.archon/workflows/*.yaml` — overrides global by filename,
   but only discovered when archon is invoked from that repo's cwd.

In practice: the 13 YAMLs in this directory override the binary bundles by
filename, so when you run `archon workflow list`, these are what Archon sees
and executes. Adding a new file here makes a new workflow available.

## What's here

Initially seeded from the 13 workflows bundled in **Archon v0.3.5**, copied
verbatim from `/workspace/Archon/.archon/workflows/defaults/*.yaml` at the
`v0.3.5` tag. They're the same content the binary would use on its own —
committing them here just makes them visible and editable.

| File | Purpose (one-liner) |
|---|---|
| `archon-assist.yaml` | Fallback: full Claude Code agent with all tools. Used when no other workflow matches. |
| `archon-fix-github-issue.yaml` | Classify → investigate → plan → implement → validate → PR. (Has unresolved command refs — see below.) |
| `archon-comprehensive-pr-review.yaml` | 5 parallel review agents → synthesize → auto-fix CRITICAL/HIGH issues. |
| `archon-smart-pr-review.yaml` | Lighter PR review. (Requires `.archon/mcp/ntfy.json` — see below.) |
| `archon-validate-pr.yaml` | CI-style validation: lint, test, coverage checks. |
| `archon-resolve-conflicts.yaml` | Analyze conflicts, auto-resolve simple ones, present options for complex. |
| `archon-create-issue.yaml` | Reproduce-then-file with reproduction gate. (Requires `agent-browser` skill — see below.) |
| `archon-feature-development.yaml` | Implement a feature from an existing plan → create PR. |
| `archon-piv-loop.yaml` | Plan-implement-validate loop with human gates via `interactive: true` loop nodes. |
| `archon-interactive-prd.yaml` | Interactive product requirements doc authoring. |
| `archon-adversarial-dev.yaml` | Dev + adversarial test generation in parallel. |
| `archon-remotion-generate.yaml` | Remotion (React video) specific. (Requires `remotion-best-practices` skill.) |
| `archon-workflow-builder.yaml` | Meta: builds new workflow YAMLs. |

## Known upstream gaps (from `archon validate workflows`)

These validation errors come from the upstream v0.3.5 bundles and are **not
caused by our copies** (verified by running `archon validate workflows` with
the copies moved aside — same errors appear). They're setup gaps you'd hit
running the bundled versions too.

- **`archon-fix-github-issue` (ERROR)**: references 7 commands not bundled in
  the binary: `archon-web-research`, `archon-create-plan`, `archon-fix-issue`,
  `archon-validate`, `archon-self-fix-all`, `archon-simplify-changes`,
  `archon-issue-completion-report`. Either upstream forgot to bundle them, or
  they're expected to be created manually at `.archon/commands/*.md`. To use
  this workflow, you'll need to create those command definitions.

- **`archon-smart-pr-review` (ERROR)**: requires MCP config at
  `.archon/mcp/ntfy.json` (for ntfy.sh push notifications). Create the file
  or strip the `notify` node from the workflow.

- **`archon-create-issue` (WARNING)**: references `agent-browser` skill not
  installed. Install it with `archon setup` or manually at
  `~/.claude/skills/agent-browser/SKILL.md`.

- **`archon-remotion-generate` (WARNING)**: references `remotion-best-practices`
  skill not installed. Same story as above.

## How to customize

1. **Edit in place**. Open any YAML here, change the prompt / node / model /
   allowed tools, save, run. No rename needed — your edits are the source of
   truth for this container now.

2. **Add a new workflow**. Drop a new `.yaml` file here. Make sure the `name:`
   field inside matches the filename (minus `.yaml`). Archon will pick it up
   on the next `archon workflow list`.

3. **Commit**. Use git normally. Your workflow edits are part of the
   `claudevcontainer` repo's history — you can see every change over time,
   revert, cherry-pick, etc.

## How to upgrade Archon

When a new `archon` binary release comes out:

1. Update the binary: `curl -fsSL https://archon.diy/install | bash`
   (or rebuild the devcontainer if the new version is baked into the
   Dockerfile).
2. Check out the matching tag in the reference clone:
   `cd /workspace/Archon && git fetch --tags && git checkout vX.Y.Z`
3. Diff your committed copies against the new upstream versions:
   `diff -u /workspace/Archon/.archon/workflows/defaults/archon-fix-github-issue.yaml /workspace/.archon/workflows/archon-fix-github-issue.yaml`
4. Selectively cherry-pick any upstream improvements you like, or leave your
   copies as-is if you're happy with them. Commit the sync if you make any
   changes.

This is a small maintenance ritual on upgrade, but it's explicit — you see
exactly what changed upstream and choose what to adopt, instead of silently
getting new behavior on every upgrade.

## Files that do NOT live here

Runtime state is kept in `/workspace/.archon/` at the parent level but
gitignored: `archon.db`, `archon.db-wal`, `archon.db-shm`, `config.yaml`,
`update-check.json`, `web-dist/`, the two entrypoint-managed symlinks
(`.archon/.archon/` bridge and `workspaces` redirect), and `.env` if you ever
run `archon setup` to configure platform webhooks.

Worktrees live at `/home/agent/.archon-worktrees/` (container overlay FS,
ephemeral across rebuilds but swept automatically by Archon's orphan recovery
on startup).

The upstream Archon repo itself is at `/workspace/Archon/` (shallow clone,
gitignored by the outer repo). Use it as a reference to read the full source,
docs, and compare against upstream on upgrade.
