# Subagents and model selection

Use subagents by default when a task has useful, separable work. Delegate to preserve main-agent context, improve quality, or save time. Handle trivial tasks directly. Respect explicit user instructions to avoid subagents.

For every delegation, use judgment to select the least expensive available model capable of completing the subtask reliably:

- Use the lowest-cost model only for mechanical, independently verifiable work such as file discovery, extraction, command execution, and test-log collection.
- Use stronger models for ambiguity, complex debugging, architectural decisions, or work where mistakes are difficult to detect.
- Escalate to a stronger model if the initial result is insufficient.

Do not use the lowest-cost model for review, verification, critique, debugging, architecture, test-coverage decisions, security analysis, or other judgment-heavy work. Use a balanced model or stronger for these tasks, escalating for complex or high-impact decisions.

Do not automatically give every subagent the main agent's model. When model selection is supported, choose it explicitly, respecting any model the user specified. If delegation or model selection is unavailable, continue with the available capabilities and state the limitation briefly.

Give subagents clear objectives, relevant context, and boundaries. Request concise findings with supporting references and uncertainties. Keep delegation messages clear and properly spaced, even in caveman mode. Avoid duplicate work and conflicting edits. Review and integrate their results before reporting completion.

## Coding workflow

Use the ponytail skill for code changes, including its proportional testing guidance. Ensure coding subagents also follow it.

For non-trivial code changes, and whenever the user asks to implement then verify or review, run the `ship` skill instead of hand-chaining implement → review → commit. It stops before commit; commit locally yourself only if asked, per Shared side effects below.

Delegate routine test execution and concise failure reporting to smaller models. Use stronger models when selecting test coverage requires substantial judgment or failures are complex.

The main agent owns the verification plan and reviews the evidence. Do not repeat successful subagent checks unless the code, environment, or confidence in the results has changed.

# Shared side effects

Never push, open, close, or comment on PRs or issues, post messages, or otherwise write to a shared remote or service without the user's explicit OK for that specific action. Approval of one action does not cover the next. Commit locally only when asked.

# Writing for others

PR bodies, issues, comments, and messages: short, plain, factual. No selling, no filler headers, no restating the diff.

# Codex delegation

When asked to use Codex, delegate to the `codex` subagent in `~/.claude/agents/codex.md`. It invokes `codex exec --sandbox danger-full-access` directly and returns the result to Claude. Provide the repository path, task context, constraints, and whether edits are authorized.

Use this route instead of the `codex@openai-codex` plugin, whose sandbox overrides fail inside this container. Direct delegation uses the existing Codex login and configured model. It disables Codex's inner sandbox and approval prompts, so use it only for trusted work.
