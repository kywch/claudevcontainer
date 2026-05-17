# Work Lifecycle Traceability

Status: draft v0.

Traceability maps draft lifecycle clauses to source evidence, accepted
decisions, deferred hardening artifacts, and review status. It does not add
normative behavior. If a behavior is missing from `decisions.md`,
`behavior.md`, `state.md`, or `interfaces.md`, this file records the gap instead
of relying on source documents to fill it.

## Source Reference Index

| source_id | source ref | role |
| --- | --- | --- |
| S1 | `decisions.md:30` / `.devcontainer/skills/spec-kit/SKILL.md:133` | spec-kit structure, traceability, self-sufficiency, schemas, conformance, model flow |
| S2 | `decisions.md:44` / `.devcontainer/skills/seedstack/SKILL.md:8` | Seedstack ownership of planning, ready selection, queue management, follow-ups, and run control |
| S3 | `decisions.md:58` / `.devcontainer/skills/dispatch-work/SKILL.md:8` | Dispatch Work ownership of one bounded work item and local gate vocabulary |
| S4 | `decisions.md:71` / `.devcontainer/skills/capture-knowledge/SKILL.md:22` | Capture Knowledge ownership of durable knowledge recording |
| S5 | `decisions.md:83` | Seeds CLI queue foundation and JSONL issue tracker behavior |
| S6 | `decisions.md:95` | observed `.seeds/` state surfaces |
| S7 | `decisions.md:111` | observed Seeds issue fields and status/type vocabulary |
| S8 | `decisions.md:141` | observed readiness semantics |

## Decision Reference Index

| decision | ref | summary |
| --- | --- | --- |
| D1 | `decisions.md:157` | use `.spec/work-lifecycle/` as spec root |
| D2 | `decisions.md:169` | treat Seeds CLI as queue foundation |
| D3 | `decisions.md:182` | separate Seedstack from Dispatch Work |
| D4 | `decisions.md:194` | keep Capture Knowledge outside completion gates |
| D5 | `decisions.md:206` | preserve `.seeds/**` ownership boundaries |
| D6 | `decisions.md:218` | version v0 as draft inventory, not protocol release |
| D7 | `decisions.md:229` | use sources as evidence until normalized clauses exist |

## Clause Traceability

| clause_id | source_id | clause ref | observed fact | decision | deferred schema | deferred conformance case | review status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ownership-boundary | S2, S3, S4, S5, S6 | `behavior.md:11`; `state.md:15`; `interfaces.md:14` | Owners are separated across Seeds CLI, Seedstack, Dispatch Work, and Capture Knowledge. | D2, D3, D4, D5 | owner/consumer fields for lifecycle handoff objects | mutation-authority rejection cases | reviewed: covered for prose; needs schema/case hardening |
| terminal-vocabulary | S2, S3 | `behavior.md:37`; `state.md:356`; `interfaces.md:255` | Dispatch, manage, and run outcomes use separate vocabularies. | D3, D6 | dispatch gate, manage decision, run state enums | terminal exclusivity, vocabulary-mixing rejection | reviewed: covered for prose; needs conformance fixtures |
| WL-001 | S2 | `behavior.md:56`; `state.md:32` | Intent intake selects planning, management, run-loop, or dispatch ownership before mutation or execution. | D3, D5, D7 | intent/work-intake object | ambiguous-owner stop case | reviewed: high-level pass; exact intake fields deferred |
| WL-002 | S2 | `behavior.md:66`; `state.md:50` | Multi-unit work is planned as a work plan or DAG before seed creation or run execution. | D3, D6 | plan/work DAG object | plan-before-seed and plan-too-ambiguous cases | reviewed: high-level pass; graph schema deferred |
| WL-003 | S2, S5, S6, S7 | `behavior.md:76`; `interfaces.md:29` | Seedstack may create Seeds queue records through queue CLI; specs and dispatch children do not edit `.seeds/**` directly. | D2, D5 | Seeds issue schema, seed creation request/result | direct `.seeds/**` mutation rejection | reviewed: boundary pass; CLI wire details deferred |
| WL-004 | S2, S6 | `behavior.md:86`; `state.md:84`; `state.md:429` | Automatic run dispatch requires a clean queue baseline, with knowledge-state exclusion only when policy allows. | D5, D6 | queue baseline snapshot object | dirty queue baseline stop; allowed knowledge exclusion | reviewed: prose pass; baseline command/evidence shape deferred |
| WL-005 | S2, S5, S7, S8 | `behavior.md:97`; `state.md:103`; `interfaces.md:53` | Seedstack adopts or selects ready open work with blockers resolved, subject to plan/filter behavior. | D2, D3, D7 | readiness evidence object, seed card object | closed/active/assigned/blocked adoption rejection | reviewed: partial; exact Seeds readiness flags require source lookup |
| WL-006 | S2, S3 | `behavior.md:108`; `state.md:120`; `interfaces.md:75`; `interfaces.md:99`; `interfaces.md:123` | Seedstack hands one bounded work order to Dispatch Work with acceptance, edit scope, artifact expectations, and gates. | D3, D5 | seed card, work order, packet schemas | missing acceptance/gate/scope rejection | reviewed: prose pass; artifact formats deferred |
| WL-007 | S3 | `behavior.md:119`; `state.md:157`; `interfaces.md:145` | Dispatch Work emits exactly one local result: `done`, `retry`, or `escalate`; `done` is local only. | D3, D6 | dispatch gate schema | local gate exclusivity; done-not-close case | reviewed: prose pass; child artifact validation cases deferred |
| WL-008 | S2, S3 | `behavior.md:133`; `state.md:208`; `interfaces.md:170` | Seedstack reconciles each dispatch result against fresh queue state, accepted evidence, dirty guards, and proposals before next dispatch. | D3, D5 | manage decision schema | stale queue, dirty guard, follow-up-nonterminal cases | reviewed: prose pass; reconcile algorithm details deferred |
| WL-009 | S2, S3, S5 | `behavior.md:144`; `state.md:227`; `interfaces.md:170` | Seedstack may close only after manage reconciles local `done` and no unresolved acceptance remains. | D2, D3 | close command request/result, manage decision schema | close-after-done happy path; unresolved acceptance blocks close | reviewed: prose pass; exact close command behavior deferred |
| WL-010 | S2, S3 | `behavior.md:154`; `state.md:173`; `state.md:246` | Retry sends same item back for another bounded dispatch round; retry is nonterminal for queue and run loop. | D3, D6 | retry decision fields and retry cap state | dispatch retry, manage retry, cap reached stop | reviewed: prose pass; retry cap defaults deferred |
| WL-011 | S2, S3 | `behavior.md:164`; `state.md:191`; `state.md:263` | Escalation stops unsafe or ambiguous continuation until Seedstack/user disposition. | D3, D6 | escalation reason taxonomy | local escalate to manage escalate; split/follow-up disposition | reviewed: partial; error classes and disposition taxonomy deferred |
| WL-012 | S4 | `behavior.md:174`; `state.md:282`; `interfaces.md:226` | Capture Knowledge evaluates after close/resolved escalation/run done; no qualified record does not block completion. | D4, D5 | knowledge record schema, capture audit object | recorded, none_qualified, store_missing, skipped_user_waived cases | reviewed: prose pass; storage schema and capture gate fixtures deferred |
| WL-013 | S2, S3 | `behavior.md:191`; `state.md:335`; `state.md:377`; `interfaces.md:196` | Run mode repeats dispatch/manage until one exclusive run terminal outcome and preserves terminal vocabulary separation. | D3, D6 | run state schema, terminal report schema | done, exhausted, blocked, escalated, loop_cap cases | reviewed: prose pass; loop cap defaults/report format deferred |

## Deferred Schemas

Draft v0 intentionally defers machine-readable schemas. Required future schemas
or schema-equivalent contracts:

| schema target | source clauses | current prose ref | status |
| --- | --- | --- | --- |
| Seeds issue | WL-003, WL-005 | `interfaces.md:29` | deferred |
| readiness evidence | WL-004, WL-005, WL-008 | `interfaces.md:53`; `state.md:67` | deferred |
| seed card | WL-006 | `interfaces.md:75` | deferred |
| work order | WL-006 | `interfaces.md:99` | deferred |
| dispatch packet | WL-006 | `interfaces.md:123` | deferred |
| dispatch gate | WL-007 | `interfaces.md:145` | deferred |
| manage decision | WL-008, WL-009, WL-010, WL-011 | `interfaces.md:170` | deferred |
| run state and terminal report | WL-013 | `interfaces.md:196` | deferred |
| knowledge record and capture audit | WL-012 | `interfaces.md:226` | deferred |

## Deferred Conformance Cases

Draft v0 intentionally defers executable conformance. Required future cases:

| case target | governing clauses | status |
| --- | --- | --- |
| intent with ambiguous owner stops before mutation | WL-001 | deferred |
| multi-unit intent requires plan before seed creation | WL-002 | deferred |
| direct `.seeds/**` edits by dispatch/spec work are rejected | WL-003, WL-006 | deferred |
| dirty queue baseline stops automatic run dispatch | WL-004 | deferred |
| ready selection excludes blocked, closed, active, or assigned-to-other work | WL-005 | deferred |
| dispatch handoff rejects missing acceptance, gate, or edit scope | WL-006 | deferred |
| dispatch gate emits exactly one of `done`, `retry`, `escalate` | WL-007 | deferred |
| dispatch `done` cannot be treated as Seeds close | WL-007, WL-009 | deferred |
| manage reconciliation uses fresh queue state before next dispatch | WL-008 | deferred |
| close requires reconciled dispatch `done` and no unresolved acceptance | WL-009 | deferred |
| retry stays nonterminal and bounded to same item unless Seedstack changes scope | WL-010 | deferred |
| escalation preserves blocked decision and waits for authorized disposition | WL-011 | deferred |
| no-op knowledge capture does not fail completed work | WL-012 | deferred |
| run terminal outcome is exactly one of `done`, `exhausted`, `blocked`, `escalated`, `loop_cap` | WL-013 | deferred |
| follow-up proposal is not a manage or run terminal outcome | WL-008, WL-013 | deferred |

## Self-Sufficiency Review

self-sufficiency: fail

Draft v0 is self-sufficient for high-level ownership boundaries, vocabulary
separation, and prose-level lifecycle ordering. It is not self-sufficient for an
implementation-ready handoff or independent conformance suite.

Blocking gaps that still require source-doc lookup:

- Seeds CLI command names, flags, stdout/stderr, exit/status behavior, and JSON
  output shapes for initialization, list/read, ready selection, update, close,
  dependencies, labels, plans, templates, config, doctor, and sync.
- Exact Seeds issue JSON schema, including absent/null/default behavior for
  optional fields such as assignee, close reason, plan fields, convoy, labels,
  and extensions.
- Exact readiness behavior for plan-related readiness, filtering, scheduling,
  active/assigned-to-other work, and unknown statuses.
- Exact Seedstack work DAG, adoption, dirty guard, reconciliation, retry cap,
  loop cap, follow-up proposal, and run terminal report artifact shapes.
- Exact Dispatch Work work-order, packet, child report/status, launch evidence,
  dirty snapshot, waiver, and local gate artifact schemas.
- Exact Capture Knowledge gate criteria, duplicate detection behavior, write
  command, and knowledge record schema.
- Stable error classes, rejection codes, operator-facing messages, and recovery
  paths for malformed inputs, stale snapshots, dirty paths, unauthorized queue
  mutation, missing gates, and ambiguous ownership.
- CLI/API contract for observable invocation and process behavior across
  Seedstack, Dispatch Work, Capture Knowledge, and Seeds CLI.
- Conformance fixtures and expected outputs for happy path, retry, escalation,
  stale queue state, dirty queue baseline, terminal exclusivity, follow-up
  nonterminal behavior, and no-op knowledge capture.
- Quint or equivalent state model guards for graph/lifecycle transitions,
  terminal exclusivity, retry loops, and loop caps.

## Review Status

| lens | status | notes |
| --- | --- | --- |
| source coverage | pass with gaps | S1-S8 cover provenance, but source docs remain required for exact CLI and artifact behavior. |
| decision coverage | pass | D1-D7 cover root, owners, source authority, and draft boundary. |
| numbered clauses | pass for draft v0 | WL-001 through WL-013 have trace rows and supporting state/interface refs. |
| schema readiness | fail | schemas are explicit deferred hardening, not present in draft v0. |
| conformance readiness | fail | conformance cases are listed but not implemented. |
| self-sufficiency | fail | implementation-ready behavior still requires source-doc lookup. |

## v1 Hardening Backlog And Review Disposition

The v1 hardening backlog tracks draft v0 risks that are not release-ready:

| risk area | disposition | required before promotion |
| --- | --- | --- |
| schemas | deferred | Define schemas for Seeds issues, readiness evidence, seed cards, dispatch work orders, packets, gates, manage decisions, run reports, knowledge records, and capture audits. |
| conformance | deferred | Add executable conformance cases for ownership selection, readiness, dirty baselines, handoff validation, terminal exclusivity, retry, escalation, close, follow-up, and capture behavior. |
| errors or IO clauses | deferred | Specify inputs, outputs, status/exit behavior, rejection codes, operator messages, recovery paths, and artifact paths across Seeds CLI, Seedstack, Dispatch Work, and Capture Knowledge. |
| Quint model | deferred | Model lifecycle transitions, queue and graph guards, terminal exclusivity, retry loops, escalation stops, loop caps, and capture timing. |
| prose-only draft boundaries | accepted | Keep v0 as source-backed draft inventory for ownership boundaries, vocabulary separation, and high-level lifecycle order. |
| promotion authority | user decision before promotion | User must approve scope, source authority, schema surface, conformance coverage, Quint coverage, and release/version boundary before any promotion. |
| live queue mutation by draft spec work | accepted boundary | Draft spec work performs no Seeds issue creation, dispatch, run-loop execution, or `.seeds/**` mutation; `.seeds/knowledge.jsonl` remains owned only by Capture Knowledge. |
