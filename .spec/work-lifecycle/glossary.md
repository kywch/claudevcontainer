# Work Lifecycle Glossary

Status: draft v0.

## Terms

Seeds issue
: A git-native issue record stored by Seeds CLI, normally in
  `.seeds/issues.jsonl`, with fields such as id, title, status, priority,
  dependencies, labels, and timestamps.

seed card
: A work item view or packet derived from a Seeds issue for agent or operator
  handling.

Seedstack
: The orchestration layer that plans work, selects ready queue items, manages
  dependencies and labels, creates follow-ups, and closes or retries queue
  records through Seeds CLI when authorized.

Dispatch Work
: The bounded execution workflow for one work item. It normalizes input,
  gathers research, builds a packet, runs implementation, review, and verify
  roles, and emits a local `done`, `retry`, or `escalate` gate.

capture gate
: The Capture Knowledge decision point that checks whether completed work
  produced durable, specific, non-duplicative knowledge worth recording.

queue baseline
: The observed queue state and relevant source evidence used before a work
  lifecycle action begins.

adoption
: The act of selecting or claiming a ready queue item for execution under
  Seedstack control.

manage
: A Seedstack queue-management action that updates lifecycle state, dependencies,
  labels, priorities, follow-ups, or closure decisions.

close
: The queue action that marks a Seeds issue closed after the responsible flow
  decides completion criteria are met.

retry
: A terminal local Dispatch Work decision or queue-management decision meaning
  work should be attempted again with bounded new execution.

escalate
: A terminal local Dispatch Work decision or queue-management decision meaning
  progress is blocked, unsafe, ambiguous, or needs higher-level operator or
  queue-manager judgment.

knowledge record
: A durable Capture Knowledge entry, usually one JSONL line in
  `.seeds/knowledge.jsonl`, written only when the capture gate accepts it.
