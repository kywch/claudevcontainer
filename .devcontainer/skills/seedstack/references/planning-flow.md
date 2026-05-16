# Planning Flow

## Transition Sketch

```text
Classify size
  -> [single-fix/slice]: Draft -> Present final -> Create seed records only
     (if explicitly requested), otherwise stop
  -> [project/program]:
      Mini-alignment (outcome + hard constraints only)
      -> Research fanout
      -> Draft plan (with marked assumptions from research)
      -> Assumption check (skip if "just go"):
          -> Accept/adjust: continue
          -> Structural feedback or reject: new research -> [back to Draft]
      -> Review-Fix-Verify loop (quality gate, full review, cap 3)
      -> Present reviewed draft plan with assumption callouts
      -> User reacts:
          -> Accept clean: create seed records only if explicitly requested,
             otherwise stop
          -> Accept dirty: pre-creation gate -> create seed records only if
             explicitly requested, otherwise stop
          -> Adjust: scoped diff review; escalate to full if broad
          -> Reject: new research round

Pre-creation gate:
  -> Always run scripted mechanical checks
  -> Run full review only if dirty-bit skip does not apply
  -> If pre-creation fixes change seed cards, rerun scripted checks
  -> User accept/reject only
```

Plan mode is planning-only. It does not authorize implementation edits,
dispatch or run-loop execution. A request to "create/build a target
from scratch" still means "plan the target" when mode is `plan`, unless the
user separately asks to implement, dispatch, or run after the plan is
presented.

## Ask Size

| size | signal | output |
| --- | --- | --- |
| `single-fix` | one bug, one behavior, obvious files | one seed with local tests |
| `slice` | one feature across tests/code/docs | 2-6 seeds with clear gates |
| `project` | new command, subsystem, port, or spec change | artifact-first DAG |
| `program` | whole implementation, migration, or multi-release effort | parent epic plus staged seed networks |

If ask size is uncertain, prefer `slice` and resolve source map, blast radius,
and verification during planning research. Include a discovery seed only when
that uncertainty remains after planning.

## Alignment

Mini-alignment asks at most three things: outcome, hard constraints, and
implementation milestone review-fix budget. Default milestone budget is 3 for
`project` and `program`. Planner safety review cap is always 3 and is
Quint-grounded.

For `project` and `program`, present a draft after research with visible
assumption callouts. `project` accepts one adjustment round; `program` accepts
two. Every adjustment triggers scoped diff review; broad changes escalate to
full review.

## Research Fanout

For `project` and `program`, fan out independent read-only agents:

- source map: authoritative spec/docs and conflicts
- implementation map: likely files, module boundaries, local gates
- test map: conformance/local tests, fixtures, weak oracle risks
- risk map: storage/state/IO/concurrency/security/release hazards

Prompts must say: use repo-native commands and obey active repo/parent command
wrappers; do not assume aliases or wrappers unavailable in their environment.

## Decomposition Rules

- Seed = coherent dispatch unit with acceptance criteria and a verification gate.
- Build by artifacts: decision, spec/schema, model, conformance,
  implementation boundary, local tests, docs, release.
- For protocol work, separate `draft`, `hardening`, `promotion`, and `release`
  unless the user explicitly asks for one combined seed.
- Add dependency edges by source precedence first, runtime dependency second,
  convenience last. No redundant transitive edges.
- In plan cards, use `blocked_by`. If the persisted CLI/API schema exposes
  `blockedBy`, treat it as the same dependency relation at the boundary.
- `priority` is an urgency class, not execution order. Use `priority: 1` for
  every planned card. Use `blocked_by` and the dependency graph to control
  execution readiness.
- Keep protocol-visible behavior separate from implementation mechanics.
- Keep implementation seeds scoped to one language and one boundary.
- Each behavior seed owns closest verification; do not defer required checks to
  a later hardening seed.
- For broad implementation or subsystem work, add an implementation boundary
  sketch before seed cards. Sketch stable responsibility boundaries (CLI,
  domain/model, storage, graph/lifecycle, command handlers, tests, docs) and
  mark it as orientation only, not a mandatory file-first DAG.
- Do source mapping during planning. Add a discovery seed only when source
  authority, blast radius, or verification remains genuinely unresolved after
  planning research, because discovery seeds make the run graph more likely to
  change.
- For broad implementation work, choose a chunking strategy explicitly. Prefer
  the hybrid in `chunking-strategies.md`: thin layered foundation, vertical
  behavior slices, conformance verifier batches, then hardening/review.

## Early Test Bias

For broad `project` and `program` plans, insert an early cleanup + test
hardening seed after foundation work and before command implementation begins.
It should remove LLM drift, harden test oracles, consolidate fixtures, and set
the quality bar for later command seeds.
