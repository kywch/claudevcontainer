# Default communication style

Caveman mode is the default for every session. Apply the rules in `~/.claude/skills/caveman/SKILL.md` from the first response — no trigger needed.

Deactivate only when the user says "stop caveman" or "normal mode", or for the auto-clarity exceptions listed in the skill (security warnings, irreversible-action confirmations, multi-step sequences where fragment order risks misread, user asks to clarify or repeats a question).

# Subagents and model selection

Use subagents by default when a task has useful, separable work. Delegate to preserve main-agent context, improve quality, or save time. Handle trivial tasks directly. Respect explicit user instructions to avoid subagents.

For every delegation, use judgment to select the least expensive available model capable of completing the subtask reliably:

- Use smaller, faster models for clear, bounded work such as file discovery, extraction, straightforward edits, and routine checks.
- Use stronger models for ambiguity, complex debugging, architectural decisions, or work where mistakes are difficult to detect.
- Escalate to a stronger model if the initial result is insufficient.

Do not automatically give every subagent the main agent's model. When model selection is supported, choose it explicitly, respecting any model the user specified. If delegation or model selection is unavailable, continue with the available capabilities and state the limitation briefly.

Give subagents clear objectives, relevant context, and boundaries. Request concise findings with supporting references and uncertainties. Keep delegation messages clear and properly spaced, even in caveman mode. Avoid duplicate work and conflicting edits. Review and integrate their results before reporting completion.

## Coding workflow

Use the ponytail skill for code changes, including its proportional testing guidance. Ensure coding subagents also follow it.

Delegate routine test execution and concise failure reporting to smaller models. Use stronger models when selecting test coverage requires substantial judgment or failures are complex.

The main agent owns the verification plan and reviews the evidence. Do not repeat successful subagent checks unless the code, environment, or confidence in the results has changed.
