---
name: agentic-pbt
description: >
  Hunt real bugs in Python code via property-based testing with Hypothesis.
  Use when the user asks to find bugs, run property-based tests, mine invariants,
  or test a Python module/file/function for edge cases. Triggers on "pbt",
  "property-based testing", "hypothesis test", "find bugs in <target>",
  "agentic-pbt", or "/hypo". Python + Hypothesis only.
license: MIT
metadata:
  upstream: https://arxiv.org/abs/2510.09907
  version: "1.0"
---

# Property-Based Testing Bug Hunter

Find **genuine, reproducible bugs** in Python code using Hypothesis. Quality over quantity: one real bug > 100 passing tests.

## Preflight: verify environment

Before doing anything else, confirm this is a Python project with Hypothesis available. If either check fails, **stop and tell the user** — do not attempt to install anything automatically.

1. **Python project check** — at least one of these must be true in the working directory:
   - A `pyproject.toml`, `setup.py`, `setup.cfg`, `requirements*.txt`, `Pipfile`, or `poetry.lock` exists, OR
   - `.py` files exist in the repo, OR
   - The target named by the user is an importable Python module (`python -c "import <target>"` succeeds).

2. **Hypothesis installed** — run:
   ```bash
   python -c "import hypothesis, pytest; print(hypothesis.__version__, pytest.__version__)"
   ```
   If this fails, stop and tell the user: *"This skill needs `hypothesis` and `pytest` installed in the active Python environment. Install with `pip install hypothesis pytest` (or the project's equivalent) and re-run."*

3. **Target resolution** — determine what the user wants tested from their request:
   - Empty / unspecified → ask the user what to target (do not scan the whole codebase blindly)
   - `.py` file path → analyze that file
   - Module name (`numpy`, `requests`) → `python -c "import <name>"` then explore
   - Qualified function (`numpy.linalg.solve`) → focus on that function

Only proceed past preflight once all three checks pass.

## Workflow (6 steps)

Track progress with the Todo tool. Mark each step complete before moving on.

### 1. Analyze target

State in one line what you're about to test and why it's a valid target.

### 2. Understand the target

Use Python introspection plus Read:

- `target_module.__file__` → source path
- `inspect.getmembers(target_module)` → public surface
- `inspect.signature(func)`, `func.__doc__`, `inspect.getsource(func)`
- `inspect.getfile(target_module.target_function)`
- `os.path.dirname(target_module.__file__)` → sibling files

If told to test a specific file, **Read the full file**. Follow import chains into private impl modules (e.g. `numpy.linalg._linalg`). Understand callers to infer implicit preconditions.

### 3. Propose properties

Look for high-value patterns — see [references/property-patterns.md](references/property-patterns.md) for the full catalog (invariants, round-trips, inverses, metamorphic, idempotence, confluence, single-entry-point).

**Only test properties the code explicitly claims** — docstring, comments, or how callers use it. Do not invent properties you merely suspect. If no evidence-backed properties exist in the target, exit with *"No testable properties found in \<target\>"* — do not search outside the specified scope.

Prioritize: public API > multi-function properties > well-grounded single-function properties. Skip trivial helpers.

**Investigate the input domain** — check callers for implicit assumptions (validation, shape constraints, non-null guarantees). This informs strategy design in step 4.

### 4. Write tests

Write focused Hypothesis tests for a few high-impact properties. Full strategy reference: [references/hypothesis-reference.md](references/hypothesis-reference.md).

Strategies should be:
- **Sound** — only inputs the code actually expects
- **Complete** — all inputs the code expects (but prefer sound-but-incomplete over unsound; 90% completeness is fine)

Minimal example:
```python
from hypothesis import given, strategies as st
import math

@given(st.floats(allow_nan=False, min_value=0))
def test_sqrt_round_trip(x):
    result = math.sqrt(x)
    assert math.isclose(result * result, x)
```

Do not over-constrain. Prefer `st.lists(st.integers())` over `st.lists(st.integers(), max_size=100)` unless the code itself requires a size bound.

### 5. Run tests and triage

Run with `pytest <test_file> -v`.

**On failure**, apply the triage rubric:

- **Reproducibility** — minimal standalone script reproduces it? Same input, same failure?
- **Legitimacy** — does the failing input represent realistic usage? Do callers validate such that this input is impossible? Is the violated property actually claimed by the code?
- **Impact** — would real users hit this? Does it violate documented behavior?

If any check fails it's a **false alarm**: return to step 4, tighten the strategy with `st.integers(min_value=...)`, `.filter(...)`, or `assume(...)`. If unclear, return to step 2.

If all three pass: it's a legitimate bug → step 6.

**On success**, verify the test is meaningful — diverse inputs, actually exercises the property, targets real implementation (not a trivial wrapper).

### 6. Report

**Categorize**:
- Type: **Logic** (wrong results / violated math), **Crash** (valid input → unhandled exception), **Contract** (impl diverges from docs/type hints)
- Severity: **High** (core logic wrong, security, silent corruption), **Medium** (crashes, contract violations), **Low** (rare edges, wrong exception type, docs)

**Write the report** using the template at [assets/bug-report-template.md](assets/bug-report-template.md).

**Filename**: `bug_report_<sanitized_target>_<YYYY-MM-DD_HH-MM>_<4charhash>.md`
- Sanitize target: replace `.` and `/` with `_`
- Hash: `''.join(random.choices(string.ascii_lowercase + string.digits, k=4))`

### Outcome

- **Bug(s) found** → write one bug report file per bug (multiple bugs possible)
- **No bugs** → report `Tested N properties on <target> — all passed ✅` (no file)
- **Inconclusive** → rare; state what was tested and what blocked a verdict

## Gotchas

- **`assume()` vs `.filter()`** — use `assume()` for rare skips inside the test body; use `.filter()` on a strategy only when the predicate rejects a small fraction of inputs. Heavy filtering causes Hypothesis to give up.
- **Float comparisons** — `math.isclose()` or `pytest.approx()`, never `==`.
- **NaN / inf** — `st.floats(allow_nan=False, allow_infinity=False)` unless the target explicitly handles them.
- **Slow tests** — add `@settings(deadline=None)` when the target is legitimately slow; don't use it to hide perf regressions.
- **Don't confuse test-bug with code-bug** — if the test is over-general (property not actually claimed), fix the test; don't file a report.
- **Leave generated files in place** — they get cleaned up externally. Don't delete your test files after running.
- **Scope discipline** — if the user specified a target and no properties exist there, stop. Don't wander into unrelated modules.

## Quick links

- Property pattern catalog → [references/property-patterns.md](references/property-patterns.md)
- Hypothesis strategies + settings → [references/hypothesis-reference.md](references/hypothesis-reference.md)
- Bug report template → [assets/bug-report-template.md](assets/bug-report-template.md)
