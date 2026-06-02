<!--
Sync Impact Report
Version change: 1.0.0 -> 1.1.0
Modified principles:
- I. Code Quality Is a Release Gate -> I. Code Quality Is a Release Gate
- II. Tests Prove Behavior -> II. Tests Prove Behavior
- III. User Experience Must Stay Consistent -> III. Frontend UX Changes Need Browser Evidence
- IV. Performance Budgets Are Requirements -> IV. Performance Budgets Are Requirements
Added sections:
- Frontend Development Principles
Removed sections:
- None
Templates requiring updates:
- ✅ updated .specify/templates/plan-template.md
- ✅ updated .specify/templates/spec-template.md
- ✅ updated .specify/templates/tasks-template.md
- ✅ verified no command templates exist under .specify/templates/commands/
- ✅ updated AGENTS.md runtime guidance
- ✅ verified README.md, docs/README.md, and docs/en/quick-start.md need no changes
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
layer, API, database, task, schedule, navigation, or UI boundaries. Bug fixes
MUST add a regression test when feasible. `bun run typecheck`, `bun run lint`,
and `bun run test` MUST pass before merge unless an exception is documented and
approved. `bun run test:e2e` MUST pass when task, schedule, or navigation flows
are affected. Rationale: shipping without proof of behavior turns regressions
into user-visible defects.

### III. Frontend UX Changes Need Browser Evidence
Every frontend visual or interaction change MUST use . Before
editing UI, the implementer MUST capture browser observation with an
snapshot and screenshots. After editing UI, the implementer MUST
rerun browser verification and validate desktop `1440x900`, tablet `1024x768`,
and mobile `390x844`. Mobile verification MUST show no horizontal scrolling.
Rationale: Chrona UX quality depends on observed behavior, not code inspection
or assumptions.

### IV. Performance Budgets Are Requirements
Work that can affect latency, rendering, startup, query count, memory, or bundle
size MUST define measurable budgets in the specification or plan before
implementation begins. Changes MUST not regress agreed budgets without explicit
approval, updated documentation, and validation evidence. Rationale: performance
is part of product correctness, not a post-release cleanup task.

## Frontend Development Principles

- Chrona product behavior MUST be preserved unless the specification explicitly
  changes it.
- Backend APIs MUST NOT be changed for visual or interaction polish unless the
  implementation plan justifies why an API change is necessary.
- Business logic MUST NOT live in React components; components MUST delegate
  business rules to domain, state, service, or shared library code.
- User-facing strings MUST live in i18n message files, not inline component code.
- Current task, active node, blocked or review state, and primary action MUST be
  visually obvious in affected task, schedule, navigation, and execution views.
- Frontend plans MUST identify the existing UI patterns, product behavior,
  responsive breakpoints, i18n messages, and browser evidence required before
  implementation starts.

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
  test coverage, UX consistency expectations, responsive viewport expectations,
  i18n requirements, and measurable performance goals.
- Every implementation plan MUST record the constitution checks for code quality,
  testing, frontend browser evidence, product behavior preservation, API scope,
  UX clarity, and performance budgets before implementation starts.
- Every task list MUST include the validation work needed to satisfy this
  constitution, including automated tests, pre-edit browser observation,
  post-edit browser verification, viewport checks, UX state verification, and
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

**Version**: 1.1.0 | **Ratified**: 2026-05-03 | **Last Amended**: 2026-05-16
