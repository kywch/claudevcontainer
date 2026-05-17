# Work Lifecycle Spec

Status: draft v0.

This spec kit describes the work lifecycle around Seeds issues, Seedstack,
Dispatch Work, and knowledge capture. It is a draft normalization layer, not a
release protocol and not a replacement for live tooling.

## Authority Order

When lifecycle sources disagree, use this order:

1. Definitions in `glossary.md`.
2. Accepted decisions in `decisions.md`.
3. Numbered behavior clauses in `behavior.md`.
4. Future schemas, conformance cases, and canonical models only after a later
   work item explicitly promotes them.
5. Source documents, implementation evidence, and runtime observations from
   `.seeds/` or command output.

Later files such as schemas, conformance cases, state models, interfaces, or
traceability documents have no authority in draft v0 because they do not exist
in this spec kit.

## Source Precedence

`decisions.md` records source inventory and accepted ownership decisions.
`behavior.md` may summarize lifecycle behavior, but it must stay within the
boundaries accepted there. `glossary.md` defines shared terms for readers and
does not override accepted decisions.

If a source document is more specific than this draft, treat the source as
evidence until a later accepted decision or behavior clause normalizes it.

## Relationship To `.seeds/`

`.seeds/` is live queue state owned by Seeds CLI and flows that are authorized
to use it. This draft may refer to `.seeds/` as evidence, but spec authoring
must not edit `.seeds/**`, close issues, mutate dependencies, append knowledge,
or run queue management as part of this skeleton.

Capture Knowledge may write `.seeds/knowledge.jsonl` only through its own gate
and tool. Dispatch Work must not mutate `.seeds/**`.

## Draft Scope

Draft v0 includes only:

- `README.md`
- `decisions.md`
- `glossary.md`
- `behavior.md`

Draft v0 intentionally does not include schemas, conformance cases, Quint
models, state files, interfaces, or traceability files.
