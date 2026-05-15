# Verification Ownership and Seed Sizing

## Verification Ownership

Testing is not a late cleanup bucket. Each behavior or implementation seed owns
the smallest proof that matches its boundary.

- Put local regression tests, raw no-op/error stutter checks, PBT, and model
  replay in the implementation seed that owns the code path, unless the test
  harness itself is missing.
- Create a dedicated `local-test` seed only for reusable test infrastructure,
  broad regression mining, or a coherent cross-boundary suite that multiple
  implementation seeds need.
- Create a dedicated `conformance` seed for shared protocol cases, runner DSL,
  fixtures, or fake CLI wiring. Do not use it for implementation mechanics.
- Use targeted conformance gates inside implementation seeds when public
  behavior is touched. Use release/full-run seeds only for aggregate gates.
- Use PBT for pure helpers with independent spec oracles.
- Use model replay for lifecycle/dependency/readiness traces through the real
  CLI. Keep models abstract; do not model CLI parsing, storage bytes, locks,
  timestamps, or schema-visible IO unless the repo's model explicitly owns it.
- Review seeds must name the attack lens: spec grounding, conformance
  weakness, local test/PBT/model oracle quality, storage/path safety,
  portability, or verification of prior findings.

## Protocol Promotion

Separate four concerns when planning protocol/spec work:

- `draft`: record product intent, candidate decision, and candidate behavior
  without changing the current global spec version
- `hardening`: strengthen conformance, oracle quality, adversarial cases, PBT,
  mutation tests, model traces, or cross-language determinism
- `promotion`: apply a version bump and update every normative version source,
  schema, fixture, runner, README/sync marker, and implementation target
- `release`: prove the promoted line through full gates and implementation
  parity

A behavior seed may say "version bump likely required"; it should not own the
bump unless the seed is explicitly a promotion seed. This keeps small spec
questions from silently becoming release-line changes.

Promotion gates should include a version-source grep/check, conformance
inventory check, implementation-target drift check, and review of unresolved
hardening findings. If hardening gaps remain, promotion is blocked unless the
user explicitly accepts draft-only status or waives the risk.

## Gate Test Types

Gates must name test types, not only commands:

| type | scope |
| --- | --- |
| `static` | format, lint, typecheck, schema validation |
| `unit` | pure helpers and local modules |
| `integration` | real CLI/process/filesystem behavior |
| `conformance` | shared protocol suite or focused cases |
| `pbt` | generated property checks with independent oracle |
| `model` | Quint check, replay, or real-CLI model refinement |
| `stutter` | raw no-op/error no-rewrite checks |
| `mutation` | mutation testing for hardening critical logic/test quality |
| `review` | read-only critique with named lens |
| `full` | aggregate release gate |

## Mutation Testing

Use mutation testing selectively during hardening, especially for validators,
parsers, graph/state helpers, auth/safety-like checks, and LLM-generated tests.
Do not make mutation testing a default gate for early feature work or broad
integration-heavy suites.

## Review-Fix Iterations

LLM-generated code keeps surfacing new findings across review rounds --
validators miss edge cases, test oracles mirror implementation instead of
specifying independently, error details drift from spec. Higher budgets pay
off because each round catches a different class of issue.

Default review-fix budget per milestone:

| ask size | default budget | rationale |
| --- | --- | --- |
| `single-fix` | 1 | small scope, low risk |
| `slice` | 2 | moderate scope |
| `project` | 3 | broad scope, LLM drift compounds |
| `program` | 3 | same, across more milestones |

Ask the user during mini-alignment: "review-fix budget per milestone?
(default N, higher = more polish)". Use their answer as the uniform budget
for all milestones unless they specify per-milestone overrides.

Use three or more when work touches protocol, storage/path/locks,
lifecycle/dependencies, conformance, or test oracles. Do not hard-code fixed
iteration counts into every small network; encode iteration budget and stop
condition in milestone/review seeds.

These are guidelines, not mandates. A 300 LOC helper port with low risk may
need one iteration. A 1200 LOC storage layer needs three. Scale to actual risk,
but default high -- the cost of an extra round is low compared to shipping
weak code that later seeds build on.

## Seed Sizing

Implementation seed target: 200-1200 net LOC including local tests. The
comfortable middle is 300-800 LOC. Split when estimated work exceeds 1200 LOC,
touches more than eight files, owns more than one command family, or combines
two of: parser, storage IO, locking, graph algorithm, lifecycle transition, or
conformance runner.

Hard split above 1500 LOC unless the user explicitly wants one large seed.

Each seed card should include an estimated LOC range. When an existing
implementation exists, check actual file sizes. When building from scratch,
estimate from spec surface area. Flag seeds under 100 LOC as merge candidates
and seeds over 1200 LOC as split candidates.

Prefer split points at stable helper APIs:

- parse/validate helpers before commands
- storage read/write/mutate harness before mutating commands
- path safety before init and health
- graph helpers before dep commands and graph health
- readiness ordering before `ready`, `blocked`, and auto selection

Dispatch already includes implementation review for one seed when using
`dispatch-work`. Add separate `review` seeds only for cross-seed milestones,
risky source-precedence questions, conformance/test-oracle critique, or final
readiness.
