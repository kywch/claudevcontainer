# Token Counter 0.1

Status: draft

Token Counter specifies how to count whitespace-delimited tokens in a text
input and return the count.

## Authority And Reading Chain

1. `spec/glossary.md`
2. `spec/behavior.md`
3. active decisions in `spec/decisions.md`
4. implementations as evidence only, never as normative source

This chain defines ownership and reading order; it does not silently resolve
contradictions. A conflict among normative artifacts is a specification defect.

## Scope

- Count tokens in one input string.
- Treat ASCII whitespace as delimiters.

## Out Of Scope

- Unicode segmentation.
- Streaming input.
- Persistence.
