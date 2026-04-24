# Bug Report: [Target Name] [Brief Description]

**Target**: `target module or function`
**Severity**: [High | Medium | Low]
**Bug Type**: [Logic | Crash | Contract]
**Date**: YYYY-MM-DD

## Summary

[1-2 sentence description of the bug]

## Property-Based Test

```python
[The exact property-based test that failed and led you to discover this bug]
```

**Failing input**: `[minimal failing input Hypothesis reported]`

## Reproducing the Bug

[Drop-in script a developer can run to reproduce the issue. Minimal, concise, no extraneous details. Reuse Hypothesis's minimal failing input if possible. Omit comments and print statements unless critical to understanding.]

```python
[Standalone reproduction script]
```

## Why This Is A Bug

[Brief explanation of why this violates expected behavior — cite the docstring, type hint, or caller assumption that's being violated.]

## Fix

[If easy: provide a `git diff`-style patch, no commentary. Otherwise: high-level overview of how the bug could be fixed.]

```diff
[patch]
```
