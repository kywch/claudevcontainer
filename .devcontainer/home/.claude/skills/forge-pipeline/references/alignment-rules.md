# Alignment rules (Phase A1)

## The four grill rules

Adapted from [mattpocock/skills grill-me](https://github.com/mattpocock/skills). Apply before dispatching muse:

1. **One question at a time.** No compound asks. Resolve the current fork before opening the next.
2. **Always recommend an answer.** "I'm leaning X because Y. Want that, or prefer Z?" — never open-ended.
3. **Walk the decision tree in dep order.** Scope → approach → split strategy → verification. Later questions often dissolve once earlier ones are fixed.
4. **Prefer codebase exploration over asking.** Only ask what the code can't tell you.

## Decision classification

Before asking, classify:

| Class | Example | Action |
|---|---|---|
| **Mechanical** | Repo already uses bun → "bun test or vitest?" | Auto-decide silently. |
| **Taste** | "Split into 3 chunks or 5?" | Auto-decide; note in plan's *Assumptions* for user to flip. |
| **User Challenge** | User said "just patch" but rewrite is right. | NEVER auto. Surface: what user said, what you recommend, why, what breaks if you're wrong. |

## Scope challenge (pre-muse)

Run before writing the plan brief. If any answer is "don't know", explore before dispatching muse.

- **What existing code partially solves this?** Name files/functions. Plan must state reuse/extend/replace — no rediscovery during execution.
- **What's the minimum change that achieves the goal?** If the sketch needs **>8 files** or **>2 new classes/services**, that's a complexity smell — challenge before committing.
- **What's in the blast radius but out of scope?** (files modified + their direct importers.) If full coverage is < 1 day of forge effort, include it — half-fixes rot.
- **Is there a framework primitive?** Don't hand-roll what the framework offers.

## Assumption discipline

The alignment output feeds muse. It MUST include an explicit **Assumptions & Ambiguities** block — empty only if the user confirmed nothing was ambiguous.

- State assumptions explicitly. If uncertain, ask.
- If the goal has >1 plausible interpretation, emit a branched brief (`[INTERPRETATION A/B]`) and halt until the user picks. Don't collapse ambiguity to make forward progress.
