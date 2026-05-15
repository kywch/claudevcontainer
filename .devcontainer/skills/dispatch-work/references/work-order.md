# Work Order Contract

`work-order.v1` is the handoff contract for `dispatch-work`. It is compatible
with seedstack seed cards and SeedSpec issue descriptions: seedstack can render
the same fields into a seed description, and dispatch-work can reconstruct this
contract from a seed record plus packet context.

Write or derive it as `tmp/dispatch-work/<work-id>/work-order.md` before
Research. Do not start Execute until critical fields are filled or covered by a
user-approved bounded assumption. Fields marked `unknown` must be resolved by
Research/Packet or escalated before Execute.

## Shape

```yaml
contract: work-order.v1
work_id: stable-slug-or-queue-id
origin: prompt | seedstack | queue
queue_id: optional-read-only-id
title: concise imperative
description: bounded work text
assignee: optional
labels: [optional, seedstack, labels]
priority: 0
blocked_by: []
area: repo-relative path or explicit scope
source_refs:
  - path:line or file
acceptance:
  - observable done condition
gates:
  - type: unit|integration|conformance|pbt|model|stutter|mutation|static|review|full
    command: exact command or review requirement
    cwd: repo-relative cwd or repo root
    env: relevant env/PATH notes
verification_owner:
  - why this work owns local tests, model replay, conformance, or review
target_gates:
  - exact focused command, case, property, or replay
non_goals:
  - explicit out-of-scope behavior
risks:
  - correctness, safety, ambiguity, or blast-radius risk
promotion_boundary: none | draft | hardening | promotion | release
estimated_loc: 200-400
scope_budget:
  estimated_files: 1-4
  estimated_churn: 200-400
  context_risk: low | medium | high
  split_if_over: 500 churn or 8 files
dispatch_notes:
  - read first, hard rules, likely files, dirty constraints
```

## Critical Fields

Critical fields for any code/docs/test mutation:

- `title`
- `description`
- `area`
- `acceptance`
- `gates`
- `non_goals`
- `estimated_loc` or `scope_budget`

Critical fields for spec/protocol-visible behavior:

- `source_refs`
- `promotion_boundary`
- `verification_owner`
- `target_gates`

Critical fields for queue-backed work:

- `queue_id`
- `blocked_by`, if any
- `labels`, if they constrain ownership or gates

## Prompt-Mode Missing Details

When input is a direct user prompt, Dispatcher must inspect the prompt and repo
instructions before writing `work-order.md`.

Ask the user for missing critical details when omission could cause wrong-file
edits, wrong acceptance, unsafe scope expansion, or unverified completion.
Prefer one concise question containing only missing critical fields. Do not ask
for fields Research can safely infer and mark inferred, such as likely files or
routine test commands.

If the user does not know a critical field, record `unknown` plus a bounded
assumption in `work-order.md`; later Research/Packet must either resolve it or
escalate before Execute.

Minimum prompt-mode question template:

```text
Missing critical work-order details: <fields>. Need <specific info> before dispatch.
```

## Scope Budget

Dispatcher must estimate change size before Execute because oversized work
does not fit reliable LLM context and review loops.

Record an initial `estimated_loc` or `scope_budget` in the draft work order:

- target: 200-400 changed LOC and 1-4 files
- caution: 400-800 changed LOC or 5-8 files
- split/escalate: above 800 changed LOC, above 8 files, or multiple unrelated
  subsystems
- hard stop before Execute: above 1200 changed LOC unless user explicitly
  accepts large-scope risk for this dispatch

Research refines the estimate using source map, likely files, test impact, and
blast radius. Packet must carry both the draft estimate and refined estimate.
If Research discovers the work is over budget, dispatch-work must not silently
proceed; it records a split suggestion for seedstack or asks the user to narrow
scope.

Mostly mechanical docs/test fixture updates may exceed the LOC target only when
changed files remain coherent and review can inspect them without broad context.

## Seedstack Compatibility

Mapping from seedstack seed card:

| seedstack card | work-order.v1 |
| --- | --- |
| `temp_id` | `dispatch_notes` traceability note |
| `seed_slug` | `work_id` fallback when no queue id exists |
| `title` | `title` |
| `labels` | `labels` |
| `priority` | `priority` |
| `blocked_by` | `blocked_by` |
| `area` | `area` |
| `source_refs` | `source_refs` |
| `acceptance` | `acceptance` |
| `gates` | `gates` |
| `verification_owner` | `verification_owner` |
| `target_gates` | `target_gates` |
| `estimated_loc` | `estimated_loc` |
| `non_goals` | `non_goals` when present; otherwise `unknown` |
| `promotion_boundary` | `promotion_boundary` when present; otherwise infer only with evidence |
| `scope_budget` | `scope_budget` when present; otherwise derive from `estimated_loc` and Research |
| `dispatch_notes` | `dispatch_notes` |

Seedstack may omit `cwd`/`env` in gate entries. Dispatch-work must infer them
from repo instructions, command text, and Research, then mark them inferred in
`packet.md`. If gate cwd/PATH cannot be inferred safely, ask the user or
escalate before Execute.

SeedSpec issue records do not have native `area`, `acceptance`, `gates`, or
promotion fields. Seedstack must put those execution-critical fields in the
issue description when creating seeds. Use quote/backtick wrapping for `area`
values that contain spaces or separators. Dispatch-work treats missing
description fields as missing work-order fields, not permission to guess.

## Packet Relationship

`work-order.md` is user/seedstack intent. `packet.md` is execution context after
Research. Packet may add inferred acceptance, likely files, gate cwd/env, and
risks, but it must preserve the work-order boundary and label every inference.
Packet must refine `scope_budget` before Execute.
