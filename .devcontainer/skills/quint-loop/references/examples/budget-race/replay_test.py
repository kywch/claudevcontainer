"""Replay the Quint counter-example (budget.itf.json, produced by budget.neg.qnt)
against a minimal re-implementation of the budget-race pattern.

Teaches Layer 1 of the quint-loop flow:
  - parse the ITF
  - derive the action sequence from state diffs (no ITF action field)
  - run that sequence against a <30 LoC buggy mirror  -> invariant violated
  - run it against a <30 LoC fixed mirror             -> invariant holds

For Layer 1b (stateful PBT over the same mirrors), see
references/pbt-integration.md.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import pytest


HERE = Path(__file__).parent


@dataclass
class Action:
    kind: str  # "check" | "complete"
    actor: str


def derive_actions(states: list[dict]) -> list[Action]:
    out: list[Action] = []
    for i in range(1, len(states)):
        prev, cur = states[i - 1], states[i]
        new_checked = [a for a in cur["checked"]["#set"] if a not in prev["checked"]["#set"]]
        new_completed = [a for a in cur["completed"]["#set"] if a not in prev["completed"]["#set"]]
        if new_checked and not new_completed:
            out.append(Action("check", new_checked[0]))
        elif new_completed:
            out.append(Action("complete", new_completed[0]))
    return out


# --- Buggy mirror: gate and mutation split, no reservation. ---
class BuggyBudget:
    def __init__(self, budget: int):
        self.budget = budget
        self.fetched = 0
        self.in_flight_count = 0  # unused; present for interface parity

    def check(self) -> bool:
        return self.fetched < self.budget

    def complete(self) -> None:
        self.fetched += 1


# --- Fixed mirror: reserve at the gate; release on rollback. ---
class FixedBudget:
    def __init__(self, budget: int):
        self.budget = budget
        self.fetched = 0
        self.in_flight_count = 0

    def check(self) -> bool:
        if self.fetched + self.in_flight_count >= self.budget:
            return False
        self.in_flight_count += 1
        return True

    def complete(self) -> None:
        self.in_flight_count -= 1
        self.fetched += 1

    def rollback(self) -> None:
        self.in_flight_count -= 1


@pytest.fixture(scope="module")
def actions() -> list[Action]:
    trace = json.loads((HERE / "budget.itf.json").read_text())
    return derive_actions(trace["states"])


BUDGET = 1


def test_buggy_mirror_violates_budget(actions: list[Action]) -> None:
    b = BuggyBudget(BUDGET)
    passed: set[str] = set()
    for a in actions:
        if a.kind == "check":
            if b.check():
                passed.add(a.actor)
        else:
            assert a.actor in passed
            b.complete()
    assert b.fetched > BUDGET


def test_fixed_mirror_honours_budget(actions: list[Action]) -> None:
    b = FixedBudget(BUDGET)
    passed: set[str] = set()
    for a in actions:
        if a.kind == "check":
            if b.check():
                passed.add(a.actor)
        else:
            if a.actor in passed:
                b.complete()
    assert b.fetched <= BUDGET
    assert b.in_flight_count == 0
