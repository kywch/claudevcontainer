# Dispatch Packet

## Context Budget

- Do not paste full diffs, full docs, full logs, or full subagent traces.
- Use file paths, line refs, and short summaries.
- Research packet max:
  - 10 likely files
  - 10 acceptance bullets
  - 8 gate commands
  - 20 total log lines
  - no copied docs beyond short clause refs
- Dispatcher gate review should inspect only seed record, dispatch packet,
  `git diff --stat` or `git diff --name-only`, structured subagent reports,
  verifier reports, and gate outputs. Read full files/diff only to resolve a
  named conflict between reports.
- Packet and gate artifacts should carry summary sources and artifact paths,
  not raw logs or child transcripts.
- For implementation seeds, include a rough scope budget when useful: target
  200-400 changed LOC and 1-4 files, caution at 400-800 changed LOC or 5-8
  files, and split/escalate above 800 changed LOC or eight files unless the
  work is mostly mechanical docs/tests or summary-only scaffold artifacts.
- Packet must include a refined scope estimate before Execute. If estimate
  exceeds 800 changed LOC, eight files, or multiple unrelated subsystems,
  prefer split/escalate through seedstack. If estimate exceeds 1200 changed LOC,
  stop before Execute unless the user explicitly accepts large-scope risk.

## Work Order Source

Dispatcher builds `packet.md` from `work-order.md` (`contract:
work-order.v1`) plus Research. The work order is intent and boundary; the
packet is execution context. Packet may add inferred details, but must label
them as inferred and must not widen scope beyond the work order.

If `work-order.md` has critical fields marked `unknown`, packet must resolve
them through Research, cite the evidence, or stop before Execute and ask the
user. Do not let likely-file guesses replace an explicit `area`.

## Packet Fields

- work order id, title, description, assignee
- work-order path and any unresolved `unknown` fields
- repo path and cwd
- branch and `git status --short`
- pre-existing dirty paths and ownership boundaries
- repo root, git root, command cwd, and pathspec assumptions when they differ
- seed-declared `area` set and resulting `repo_edit_roots`. Prefer the
  seed's explicit `area:` from its description over language-name guesses,
  labels, or historical paths. Preserve multi-area values such as
  `spec/conformance + impl_go/v1` as a set; do not collapse to one root. Treat
  each `area` as an opaque repo-relative directory or scope; do not derive it
  from label spelling or language name.
  Historical roots such as `impl/rust` must not appear in likely files, write
  scopes, or gates unless the seed explicitly names that area.
- governing sources and source-precedence notes
- acceptance criteria with inferred criteria marked
- likely files with reason/confidence
- required gates with cwd/env/purpose
- expected summary sources: report paths, log paths, status paths, diffstat or
  name-status paths when known
- mutable gate inventory summary when available: runner identity, case count,
  target list, or manifest identity
- known failing or irrelevant gates with exact signatures
- non-goals, risks, and review focus
- draft and refined scope budget: estimated changed LOC, file count, subsystem
  count, context risk, split recommendation when over budget

## Promotion Boundaries

For spec/protocol seeds, record whether the seed owns:

- `draft`: describe behavior, decision, or candidate conformance without
  changing the current global spec line
- `hardening`: strengthen tests, models, review evidence, or oracle quality
- `promotion`: bump current spec/protocol version and update all normative
  sources, fixtures, schemas, runners, docs, sync markers, and implementation
  targets
- `release`: prove promotion through full gates and implementation parity

If the seed does not explicitly own `promotion`, packet acceptance must say a
version bump is suggested only. Do not let an implementation agent infer that a
normative behavior edit automatically permits a global version bump.

For protocol-visible behavior, include hardening checks relevant to the
surface, not only happy-path conformance. Examples: read-only stutter,
lock absence, exact ordering, exact response keys or explicit extensibility,
invalid/repeated args, out-of-scope negatives, and PBT/mutation/model gates
when the logic is critical enough.
