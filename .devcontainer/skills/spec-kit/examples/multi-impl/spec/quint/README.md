# Quint Model

`flag_state.qnt` is a tiny abstract model for known flag state. It demonstrates
when Quint is useful: a state transition must preserve an invariant that
examples and schemas alone do not exercise.

This model intentionally excludes JSON syntax, API envelopes, filesystem
behavior, timestamps, unknown JSON field preservation, and implementation
layout. Those belong in schemas, conformance cases, or implementation guidance.

The `preserve-unknown-fields` case is not a Quint replay target because the
model does not represent unknown JSON fields.
