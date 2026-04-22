# Per-chunk forge prompt contract (Phase B2)

## Prompt skeleton

```
# Project context
<2-3 sentences: what this repo is, what stack>

# Running log of prior chunks
<verbatim from plan file: chunk 1 did X, chunk 2 did Y, latest decisions>

# Your task: Chunk N
<verbatim chunk text from the plan file, including all ** fields and Enrichment>

# Execution rules
<inline the rules below>

# When done
Do NOT commit. Stop and return control.
```

## Execution rules (paste into every forge prompt)

1. **Surgical changes only.** Every line must trace to the task. Flag adjacent issues in your return message instead of fixing them.
2. **Orphan cleanup, not general cleanup.** Remove imports/vars/functions your changes made unused. Don't touch pre-existing dead code.
3. **Respect the files-to-touch list.** If the task requires touching a file not listed, stop and explain.
4. **Reproduce before fix (bugs).** Write a failing regression test first, then make it pass.
5. **No abstraction for single-use code.** Any extracted strategy/factory/manager needs ≥2 concrete callers in this chunk or a named one in a later chunk.
6. **No drive-by style changes.** No reformatting, import reordering, or unrelated renames. Match existing style.
7. **Leave the tree green.** If lint/tests passed before, they must pass after.

## Status vocabulary for forge's return

Forge marks the chunk as:

- **DONE** — work complete, acceptance test passes.
- **DONE_WITH_CONCERNS** — complete + test passes, but something worth flagging (adjacent bug, uncertain trade-off).
- **BLOCKED** — incomplete. Explain what was tried, why stopped, what would unblock.

Claude maps these to chunk `**Status:**` values (see chunk-format.md §Status vocabulary).

## What forge must NOT do

- Commit, push, open a PR, or run deploy commands.
- Delete files not on the files-to-touch list.
- Run long-running processes that won't exit (dev servers, watchers).
- Read or execute SKILL.md files or skill directories.
