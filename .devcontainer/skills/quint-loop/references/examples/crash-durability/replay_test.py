"""Replay the Quint counter-example (session.itf.json, produced by session.neg.qnt)
against a minimal re-implementation of two persistence patterns.

  Buggy:  truncate the canonical path, then write in-place.  A crash
          between truncate and write leaves disk empty — data loss.
  Fixed:  write to a sibling tmp file, then rename.  The canonical path
          is never in an intermediate state.

For Layer 2 idioms (mocking `os.write` or `builtins.open` to simulate a
mid-write crash against real code), see SKILL.md step 7.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import pytest


HERE = Path(__file__).parent


@dataclass
class Action:
    kind: str  # "writeNew" | "beginSave" | "finishSave" | "crash"


def _num(v: dict) -> int:
    return int(v["#bigint"])


def derive_actions(states: list[dict]) -> list[Action]:
    out: list[Action] = []
    for i in range(1, len(states)):
        p, c = states[i - 1], states[i]
        mem_delta = _num(c["memVersion"]) - _num(p["memVersion"])
        wip_on = not p["writeInProgress"] and c["writeInProgress"]
        wip_off = p["writeInProgress"] and not c["writeInProgress"]
        disk_rose = _num(c["diskVersion"]) > _num(p["diskVersion"])
        if mem_delta > 0:
            out.append(Action("writeNew"))
        elif wip_on:
            out.append(Action("beginSave"))
        elif wip_off and disk_rose:
            out.append(Action("finishSave"))
        elif wip_off:
            out.append(Action("crash"))
    return out


# --- Buggy mirror: in-place truncate-then-write. ---
class BuggyStore:
    def __init__(self) -> None:
        self.disk_version = 0
        self.mem_version = 0
        self.write_in_progress = False
        self.committed_once = False

    def write_new(self) -> None:
        self.mem_version += 1

    def begin_save(self) -> None:
        self.write_in_progress = True
        self.disk_version = 0  # the bug: truncate in place

    def finish_save(self) -> None:
        self.disk_version = self.mem_version
        self.write_in_progress = False
        self.committed_once = True

    def crash(self) -> None:
        self.write_in_progress = False
        # disk unchanged

    def load(self) -> int:
        return self.disk_version


# --- Fixed mirror: tmp+rename. ---
class FixedStore:
    def __init__(self) -> None:
        self.disk_version = 0
        self.mem_version = 0
        self._tmp_version: int | None = None
        self.committed_once = False

    def write_new(self) -> None:
        self.mem_version += 1

    def begin_save(self) -> None:
        self._tmp_version = self.mem_version  # stage to tmp, disk untouched

    def finish_save(self) -> None:
        if self._tmp_version is None:
            raise RuntimeError("no tmp staged")
        self.disk_version = self._tmp_version  # atomic rename
        self._tmp_version = None
        self.committed_once = True

    def crash(self) -> None:
        self._tmp_version = None  # abandon tmp

    def load(self) -> int:
        return self.disk_version

    @property
    def write_in_progress(self) -> bool:
        return self._tmp_version is not None


def _apply(store, action: Action) -> None:
    dispatch = {
        "writeNew": store.write_new,
        "beginSave": store.begin_save,
        "finishSave": store.finish_save,
        "crash": store.crash,
    }
    dispatch[action.kind]()


@pytest.fixture(scope="module")
def actions() -> list[Action]:
    trace = json.loads((HERE / "session.itf.json").read_text())
    return derive_actions(trace["states"])


def test_buggy_store_loses_committed_data(actions: list[Action]) -> None:
    s = BuggyStore()
    for a in actions:
        _apply(s, a)
    # Trace reaches a state where committedOnce=True but diskVersion=0.
    assert s.committed_once is True
    assert s.load() == 0


def test_fixed_store_preserves_committed_data(actions: list[Action]) -> None:
    s = FixedStore()
    for a in actions:
        _apply(s, a)
    if s.committed_once:
        assert s.load() > 0
