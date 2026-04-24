# Worked examples

Self-contained Quint specs + replay tests. Copy a directory into your repo, rewrite the `SHADOWS` header to point at your code, and adapt from there.

Each example ships:

- `<name>.qnt` — canonical spec (invariant holds).
- `<name>.neg.qnt` — negative control (invariant violated).
- `<name>.itf.json` — committed counter-example produced by running the neg.
- `replay.test.ts` — Layer 1 replay in TypeScript (vitest + fast-check compatible).
- `replay_test.py` — Layer 1 replay in Python (pytest + Hypothesis compatible).

All four `.qnt` files typecheck with `quint 0.32+`; the negs produce violations and the canonicals hold on `--max-samples=2000 --max-steps=20`. Re-run after any edit:

```bash
# Re-generate the counter-example (overwrites the committed ITF).
quint run <name>.neg.qnt --backend=typescript \
  --invariant=<invName> \
  --out-itf=<name>.itf.json \
  --max-samples=500 --max-steps=15

# Confirm canonical still holds.
quint run <name>.qnt --backend=typescript \
  --invariants <inv1> <inv2> \
  --max-samples=2000 --max-steps=20
```

---

## budget-race

**Pattern:** concurrent reservation on a shared counter.
**Bug:** gate check and mutation split by an await; multiple callers pass the gate before any one increments. Final count exceeds budget.
**Fix:** reserve at the gate — check and increment are in the same synchronous block, so `fetched + inFlight` reflects the reservation before any await.
**Teaches:** basic 3-actor / `BUDGET=1` state machine, `reserve`/`succeed`/`rollback` action shape, deriving actions from ITF state diffs (no action field in ITF).
**Adapt for:** per-turn fetch budgets, connection pools, rate-limit counters, semaphore-like resources where check-then-act races matter.

## crash-durability

**Pattern:** atomic persistence under crash.
**Bug:** in-place truncate-then-write. Truncate opens the canonical path to empty; if the process crashes before the write completes, a prior committed payload is gone.
**Fix:** write to a sibling tmp file, then `rename(tmp, canonical)`. Rename is atomic on POSIX, so disk is never in an intermediate state — either prior payload or new payload.
**Teaches:** `writeInProgress` flag, `committedOnce` ghost variable, `crash` action interleaved with a multi-step write, invariant of the shape `committedOnce ⇒ disk != empty`.
**Adapt for:** session stores, cache files, config writers, journal/WAL commits, anything where "reader sees empty after prior successful save" is unacceptable.

---

## What these examples do NOT cover

- **Layer 2 tests.** These examples ship Layer 1 (replay) only. Layer 2 forces the race on the real closure and is necessarily specific to your codebase. See SKILL.md step 7 for idioms (`vi.mock` for TS, `monkeypatch` for Python, interface injection for Go).
- **Layer 1b PBT tests.** The replay mirrors are exported so a PBT test can import them; see [../pbt-integration.md](../pbt-integration.md) for the fast-check / Hypothesis stateful-machine idioms over these exact classes.
- **Multi-invariant canonicals.** Both examples ship one or two invariants. If your canonical needs `--invariants a b c` with separate bug shapes, pin one neg per invariant as `<name>.neg.<invName>.qnt` with mirrored ITFs — see SKILL.md "Placement" for the convention.
- **Apalache exhaustive verification.** `quint verify` (JVM-backed) is only needed for liveness properties the simulator can't reach. All examples here use the TypeScript simulator.

## Rot notice

These examples are **frozen teaching fixtures**. They intentionally do not track any live codebase, so a spec here will never have a valid `LAST-SYNCED` sha — replace the placeholder with your own when adapting. The mechanical-audit check `LAST-SYNCED reachable from HEAD` is suppressed here by convention.
