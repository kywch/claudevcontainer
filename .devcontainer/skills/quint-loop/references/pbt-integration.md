# Layer 1b — stateful PBT over the mirror classes

The ITF replay (Layer 1) pins one counter-example. A single bug shape often has many equivalent triggers, and a future refactor of the fixed class can re-introduce the bug under a sequence the committed ITF doesn't cover. Stateful PBT drives the same buggy + fixed mirror classes with random action sequences and shrinks failures to minimal traces — broader search over the same machine.

## When to add it

- Add: concurrency/ordering bugs where the ITF feels like one of many possible traces; you want the invariant to hold under a search-space, not just a single sequence.
- Skip: single surgical race the ITF already pins tightly (extra code, no extra signal).
- Skip: pure-function bugs — use plain property tests (`fc.property` / `@given`), Quint isn't involved.

Layer 1b is **not a substitute for Quint**. PBT is non-exhaustive, can miss liveness/deadlock shapes, and shrinks to locally-minimal traces that may not be the most insightful counter-examples. Quint stays the source of truth for exhaustive state-machine exploration; PBT hardens the mirror.

## Mapping Quint → PBT idioms

| Quint construct                      | fast-check (TS)                 | Hypothesis (Python)              |
|--------------------------------------|---------------------------------|----------------------------------|
| `action reserve(i): bool = all {...}` | `fc.Command` with `check()`/`run()` | `@rule()` with `assume(...)`     |
| Action precondition (`all { P, ... }`) | `Command.check(model)`          | `assume(P)` in rule body         |
| Invariant (`val inv = expr`)          | assert in `Command.run` or outer | `@invariant()` method            |
| `nondet i = ACTORS.oneOf()`           | `fc.constantFrom(...ACTORS)` arg | `st.sampled_from(ACTORS)` arg    |
| `step = any { a, b, c }`              | `fc.commands([a, b, c])`        | multiple `@rule`s on the machine |
| Model state (`var x: int`)            | Model-class field               | Machine-instance attribute       |

**Key move:** keep the mirror classes you already wrote for Layer 1 — PBT drives those same classes. No new implementation; the PBT test *is* the driver.

## TypeScript — fast-check + vitest

Install: `bun add -d fast-check` (or `npm i -D fast-check`).

```ts
import fc from "fast-check";
import { describe, it } from "vitest";

// Reuse the buggy + fixed classes from the Layer 1 replay test.
import { BuggyBudget, FixedBudget } from "./budget-mirror.js";

type Model = { used: number; inFlight: Set<string>; completed: Set<string> };

const BUDGET = 2;
const ACTORS = ["a", "b", "c"] as const;

// One Command per Quint action. `check` = Quint precondition; `run` = both
// model update and real-class call, with assertions after.

class ReserveCmd implements fc.Command<Model, FixedBudget> {
  constructor(readonly actor: string) {}
  check(m: Readonly<Model>) {
    return !m.inFlight.has(this.actor) &&
           !m.completed.has(this.actor) &&
           m.used + m.inFlight.size < BUDGET;
  }
  run(m: Model, r: FixedBudget) {
    const ok = r.check();
    if (ok) m.inFlight.add(this.actor);
    // Invariant: fetched + inFlight <= BUDGET at every point
    if (r.fetched + r.inFlight > BUDGET) throw new Error("budget breached");
  }
  toString = () => `reserve(${this.actor})`;
}

class SucceedCmd implements fc.Command<Model, FixedBudget> {
  constructor(readonly actor: string) {}
  check(m: Readonly<Model>) { return m.inFlight.has(this.actor); }
  run(m: Model, r: FixedBudget) {
    m.inFlight.delete(this.actor);
    m.completed.add(this.actor);
    r.complete();
    if (r.fetched > BUDGET) throw new Error("budget breached");
  }
  toString = () => `succeed(${this.actor})`;
}

describe("budget PBT (Layer 1b)", () => {
  const cmdArb = fc.commands([
    ...ACTORS.map((a) => fc.constant(new ReserveCmd(a))),
    ...ACTORS.map((a) => fc.constant(new SucceedCmd(a))),
  ], { maxCommands: 30 });

  it("FixedBudget holds the invariant under any schedule", () => {
    fc.assert(
      fc.property(cmdArb, (cmds) => {
        fc.modelRun(
          () => ({
            model: { used: 0, inFlight: new Set(), completed: new Set() },
            real: new FixedBudget(BUDGET),
          }),
          cmds,
        );
      }),
      { numRuns: 500 },
    );
  });

  it("BuggyBudget fails — sanity check the test has teeth", () => {
    // fast-check will shrink to a minimal failing sequence.
    // Expect this to throw; that's what proves the PBT forces the race.
    try {
      fc.assert(
        fc.property(cmdArb, (cmds) => {
          fc.modelRun(
            () => ({
              model: { used: 0, inFlight: new Set(), completed: new Set() },
              real: new BuggyBudget(BUDGET),
            }),
            cmds,
          );
        }),
        { numRuns: 500 },
      );
      throw new Error("expected PBT to find budget violation on BuggyBudget");
    } catch (e) {
      if ((e as Error).message !== "budget breached") throw e;
    }
  });
});
```

The "sanity check" arm proves the test forces the race; without it, a Layer 1b that silently passes on the buggy class is a false signal (same failure mode as a Layer 2 that doesn't fail pre-fix).

## Python — Hypothesis + pytest

Install: `pip install hypothesis pytest` (or the Poetry/uv equivalent).

```python
# tests/specs/test_budget_pbt.py
import pytest
from hypothesis import assume, strategies as st
from hypothesis.stateful import RuleBasedStateMachine, rule, invariant

from .budget_mirror import BuggyBudget, FixedBudget

BUDGET = 2
ACTORS = ("a", "b", "c")


def _machine_for(cls):
    class BudgetMachine(RuleBasedStateMachine):
        def __init__(self):
            super().__init__()
            self.real = cls(BUDGET)
            self.in_flight: set[str] = set()
            self.completed: set[str] = set()

        @rule(actor=st.sampled_from(ACTORS))
        def reserve(self, actor):
            assume(actor not in self.in_flight)
            assume(actor not in self.completed)
            # Quint precondition: fresh + in_flight < BUDGET
            if self.real.check():
                self.in_flight.add(actor)

        @rule(actor=st.sampled_from(ACTORS))
        def succeed(self, actor):
            assume(actor in self.in_flight)
            self.in_flight.discard(actor)
            self.completed.add(actor)
            self.real.complete()

        @invariant()
        def budget_holds(self):
            assert self.real.fetched + self.real.in_flight_count <= BUDGET

    BudgetMachine.__name__ = f"{cls.__name__}Machine"
    return BudgetMachine


TestFixedBudget = _machine_for(FixedBudget).TestCase


def test_buggy_budget_violates_invariant():
    """Sanity check: PBT must find a violation on BuggyBudget."""
    Machine = _machine_for(BuggyBudget)
    with pytest.raises(AssertionError):
        Machine.TestCase().runTest()
```

Hypothesis surfaces the shrunk failing trace via pytest's output — copy the shrunk sequence into a note on the canonical if it's narrower than the committed ITF.

## Shared rules

1. **Same mirror classes as Layer 1.** The PBT test imports the buggy/fixed classes from the Layer 1 replay module; don't fork them.
2. **Preconditions are Quint preconditions.** If the `.qnt` action says `not(inFlight.contains(i))`, the PBT rule does `assume(actor not in self.in_flight)` — literally the same guard.
3. **Invariant body = Quint invariant body.** If `val budgetInvariant = fetched <= BUDGET`, the PBT assertion is `self.real.fetched <= BUDGET`. Do not strengthen or paraphrase.
4. **Test the buggy class too.** A Layer 1b that only tests the fixed class and never the buggy one is indistinguishable from a no-op. The buggy-class arm asserts that PBT *finds* the bug — same gate as "Layer 2 must fail pre-fix."
5. **Seed for flakiness.** If the PBT search is non-trivial, record the seed Hypothesis/fast-check used for the Layer 1b's first failing run in a comment, so future debugging can reproduce.

## Anti-patterns specific to Layer 1b

- **PBT without the Quint canonical.** If there's no canonical, the PBT test is unmoored — its rules are just the current implementation's methods, and the invariant will likely rubber-stamp the code. Write the `.qnt` first, then mechanically translate.
- **Dropping the buggy-class arm.** See rule 5. If it passes, the test has no teeth.
- **Letting PBT replace Layer 2.** PBT drives the mirror; it never touches real async code. The real closure still needs the forced-interleaving or crash-simulation test.
- **Using `@given` on a function of action-list.** Hypothesis's stateful API (`RuleBasedStateMachine`) shrinks better on command sequences than `@given(lists(...))` — use the stateful API for stateful bugs.
- **Over-large action spaces.** Keep actor count and action count small (≤3 actors, ≤4 action kinds). PBT cost scales fast; small models find the same bugs Quint did.
