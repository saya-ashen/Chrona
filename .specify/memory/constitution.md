<!--
Sync Impact Report
Version change: template -> 1.0.0
Modified principles:
- Initialized from template placeholders -> I. Code Quality Is a Release Gate
- Initialized from template placeholders -> II. Tests Prove Behavior
- Initialized from template placeholders -> III. User Experience Must Stay Consistent
- Initialized from template placeholders -> IV. Performance Budgets Are Requirements
Added sections:
- Engineering Standards
- Delivery Workflow
Removed sections:
- Template fifth core principle slot
Templates requiring updates:
- ✅ updated .specify/templates/plan-template.md
- ✅ updated .specify/templates/spec-template.md
- ✅ updated .specify/templates/tasks-template.md
- ✅ verified no command templates exist under .specify/templates/commands/
- ✅ verified runtime guidance references in README.md, docs/README.md, and docs/en/quick-start.md need no changes
Follow-up TODOs:
- None
-->

# Chrona Constitution

## Core Principles

### I. Code Quality Is a Release Gate
Every change MUST preserve clear ownership, strict typing, and layer boundaries.
Implementations MUST prefer the smallest correct change over speculative
abstractions, and reviews MUST block unclear naming, dead code, hidden side
effects, mixed concerns, or missing error handling. Rationale: maintainable code
keeps Chrona safe to evolve across frontend, server, runtime, and CLI surfaces.

### II. Tests Prove Behavior
Every behavior change MUST include automated tests at the narrowest effective
level, with integration or end-to-end coverage added whenever behavior crosses
layer, API, database, or UI boundaries. Bug fixes MUST add a regression test when
feasible, and `bun run typecheck`, `bun run lint`, and `bun run test` MUST pass
before merge unless an exception is documented and approved. Rationale: shipping
without proof of behavior turns regressions into user-visible defects.

### III. User Experience Must Stay Consistent
User-facing changes MUST reuse established interaction patterns, terminology,
visual structure, and state handling unless the design system itself is being
intentionally revised. New or changed flows MUST define loading, empty, success,
and error states, and MUST preserve keyboard accessibility and clear feedback.
Rationale: consistent experiences reduce user confusion and make AI-assisted
workflows trustworthy.

### IV. Performance Budgets Are Requirements
Work that can affect latency, rendering, startup, query count, memory, or bundle
size MUST define measurable budgets in the specification or plan before
implementation begins. Changes MUST not regress agreed budgets without explicit
approval, updated documentation, and validation evidence. Rationale: performance
is part of product correctness, not a post-release cleanup task.

## Engineering Standards

- Chrona MUST run as a Bun application runtime; Node.js-only runtime paths MUST
  not be introduced.
- Business logic MUST stay out of React components and Hono route handlers.
- Shared API contracts and Zod schemas MUST live in `packages/contracts`.
- Pure business rules MUST live in `packages/domain` and MUST NOT import React,
  Prisma, `fetch`, or `process.env`.
- Database access MUST stay in `packages/db`, and provider-specific OpenClaw
  logic MUST stay under `packages/providers/openclaw/`.

## Delivery Workflow

- Every specification MUST describe user-visible acceptance scenarios, required
  test coverage, UX consistency expectations, and measurable performance goals.
- Every implementation plan MUST record the constitution checks for code quality,
  testing, UX consistency, and performance budgets before implementation starts.
- Every task list MUST include the validation work needed to satisfy this
  constitution, including automated tests, UX state verification, and
  performance validation when applicable.
- Code review and release decisions MUST treat constitution violations as blockers
  unless an approved exception is documented with scope, rationale, and expiry.

## Governance

- This constitution supersedes conflicting local practices for engineering work
  in this repository.
- Amendments MUST be made in writing, include the impacted principles or
  sections, and update any affected templates or guidance files in the same
  change.
- Semantic versioning applies to this constitution: MAJOR for incompatible
  principle removals or redefinitions, MINOR for new principles or materially
  expanded governance, and PATCH for clarifications that do not change intent.
- Compliance MUST be checked during specification, planning, implementation, and
  review. Any temporary exception MUST identify an owner, justification, and
  removal date.

**Version**: 1.0.0 | **Ratified**: 2026-05-03 | **Last Amended**: 2026-05-03
