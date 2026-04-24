# Hypothesis reference

Load this file when writing tests in step 4.

## Essential patterns

```python
import math
from hypothesis import assume, given, settings, strategies as st


# Basic test structure
@given(st.integers())
def test_property(x):
    assert isinstance(x, int)


# Safe numeric strategies (avoid NaN/inf surprises)
st.floats(allow_nan=False, allow_infinity=False, min_value=-1e10, max_value=1e10)
st.floats(min_value=1e-10, max_value=1e6)  # positive, non-zero


# Collections
st.lists(st.integers())
st.lists(st.integers(), min_size=1)  # non-empty
st.text()
st.dictionaries(st.text(), st.integers())
st.tuples(st.integers(), st.floats(allow_nan=False))


# Filtering inside test vs in strategy
@given(st.integers(), st.integers())
def test_division(a, b):
    assume(b != 0)  # use assume() for rare skips
    assert abs(a % b) < abs(b)

# Prefer .filter() only when rejection rate is low
st.integers().filter(lambda x: x % 2 == 0)  # slow — use st.integers().map(lambda x: x*2) instead
```

## Settings

```python
@settings(max_examples=1000)   # more thorough
@settings(deadline=None)        # disable per-example timeout for slow targets
@settings(max_examples=50)     # quicker smoke test while iterating
```

## Principles

- Use `math.isclose()` or `pytest.approx()` for float comparisons, never `==`.
- Focus on properties that reveal genuine bugs when violated.
- Constrain strategies to the **actual input domain** of the code; over-constraining hides bugs, under-constraining yields false alarms.
- Do not add arbitrary size caps. `st.lists(st.integers())` beats `st.lists(st.integers(), max_size=100)` unless the code requires a size bound.

## Rare but useful strategies

- `st.from_regex(pattern)` — strings matching a regex
- `st.from_lark(grammar)` — strings from a context-free grammar
- `st.functions(returns=...)` — arbitrary callables
- `st.builds(MyClass, field=st.integers(), ...)` — dataclass / class instances
- `st.recursive(base, extend)` — recursive structures (trees, JSON)
- `st.data()` — interactively draw values inside the test

## Library-specific

- NumPy arrays: `hypothesis.extra.numpy.arrays(dtype, shape)`
- Pandas DataFrames: `hypothesis.extra.pandas.data_frames(...)`
- Dates / times: `st.datetimes()`, `st.dates()`, `st.timedeltas()`

## Docs

Use WebFetch on demand:

- Quickstart: https://hypothesis.readthedocs.io/en/latest/quickstart.html
- Strategies: https://hypothesis.readthedocs.io/en/latest/reference/strategies.html
- NumPy: https://hypothesis.readthedocs.io/en/latest/reference/strategies.html#numpy
- Pandas: https://hypothesis.readthedocs.io/en/latest/reference/strategies.html#pandas
