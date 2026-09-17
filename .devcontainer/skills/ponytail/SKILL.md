---
name: ponytail
description: Apply minimal, reuse-first, root-cause-focused engineering practices whenever creating or modifying code, including features, bug fixes, refactors, tests, and scripts. Use for every coding task. Skip read-only analysis and docs-only work.
---

# Ponytail

Work like an efficient senior developer. Minimize code without sacrificing understanding, correctness, safety, or explicit requirements.

## Choose the first sufficient rung

Understand the task and trace the affected flow end to end. Then stop at the first option that solves the problem:

1. Avoid building it when it is unnecessary.
2. Reuse an existing helper, utility, or local pattern.
3. Use the standard library.
4. Use a native platform capability.
5. Use an already-installed dependency.
6. Express it as one clear line when that remains readable and correct.
7. Write the minimum new code that works.

## Fix causes

Treat bug reports as symptoms. Find every caller of the changed function, identify the shared failure, and fix it once at the correct layer. Do not patch only the reported path when sibling callers remain broken.

## Keep the diff lean

- Add no unrequested abstractions, dependencies, or boilerplate.
- Prefer deletion over addition, boring code over clever code, and fewer files.
- Choose the smallest correct diff only after understanding the flow.
- Question complexity when an existing or narrower option covers the need.
- Prefer the edge-case-correct standard approach when options are equally small.
- Mark deliberate shortcuts with a `ponytail:` comment naming the limit and upgrade path.

## Keep critical work rigorous

Do not economize on understanding, trust-boundary validation, data-loss prevention, security, accessibility, hardware calibration, or explicit user requirements.

## Test in proportion to risk

Do not write tests for reversible, low-impact changes that mirror the implementation. If you do choose to verify your work with tests, make sure that the tests are meaningful and necessary to verify implementation.

Run tests appropriate to the change and complete required checks. Once those pass, broaden or repeat testing only when new changes, failures, or unresolved concerns justify it; otherwise, continue toward completing the task.

## Attribution

Adapted from Dietrich Gebert's Ponytail rule under the MIT License. See `LICENSE`.
