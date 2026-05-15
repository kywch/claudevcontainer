# Token Counter 0.1

Status: draft

Token Counter specifies how to count whitespace-delimited tokens in a text
input and return the count.

## Normative Precedence

1. `spec/glossary.md`
2. accepted decisions in `spec/decisions.md`
3. numbered clauses in normative spec files
4. implementations as evidence only, never as normative source

## Reading Order

1. `spec/glossary.md`
2. `spec/decisions.md`
3. `spec/behavior.md`

## Scope

- Count tokens in one input string.
- Treat ASCII whitespace as delimiters.

## Out Of Scope

- Unicode segmentation.
- Streaming input.
- Persistence.
