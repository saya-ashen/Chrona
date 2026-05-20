# Implementation Plan: Shadcn UI Refactor

**Branch**: `011-shadcn-ui-refactor` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/011-shadcn-ui-refactor/spec.md`

## Summary

Consolidate Chrona's frontend UI foundation around shadcn/ui primitives by inventorying current `apps/web/src/components/ui` and page/component imports, replacing duplicate custom primitives such as `buttonVariants`, `StatusBadge`, `SurfaceCard`, and field class helpers with standard shadcn components or thin Chrona domain wrappers, deleting legacy compatibility surfaces, and adding guardrails so future UI work does not recreate basic controls.

## Technical Context

**Language/Version**: TypeScript strict; React 19 SPA under `apps/web/`; Bun runtime  
**Primary Dependencies**: Vite, React Router 7, shadcn/ui configuration via `components.json`, class-variance-authority, Tailwind CSS variables, existing i18n and component tests  
**Storage**: N/A; no persistence or data model storage changes  
**Testing**: `bun run typecheck`, `bun run lint`, `bun run test`; `bun run test:e2e` if task, schedule, or navigation flows change during replacement  
**Target Platform**: Chrona web app on desktop `1440x900`, tablet `1024x768`, and mobile `390x844`  
**Project Type**: Vite + React web application in a Bun monorepo  
**Performance Goals**: No user-visible delay or layout instability on affected screens; no measurable bundle growth from keeping duplicate component systems; interactive controls remain responsive under current page data  
**Constraints**: No backward-compatibility aliases for removed UI primitives; no backend API changes; preserve Chrona product behavior, dark mode, accessibility, i18n, and mobile no-horizontal-scroll behavior; use `agent-browser` before and after UI edits  
**Scale/Scope**: Active UI primitives in `apps/web/src/components/ui` plus all active imports across `apps/web/src/components`, `apps/web/src/pages.tsx`, `apps/web/src/router.tsx`, and related tests

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code Quality**: PASS. Plan keeps base shadcn primitives in `apps/web/src/components/ui`, allows only thin Chrona domain wrappers where semantic product meaning exists, and removes duplicate custom primitive implementations rather than adding compatibility layers.
- **Testing**: PASS. Required commands are `bun run typecheck`, `bun run lint`, and `bun run test`. `bun run test:e2e` is required if task, schedule, or navigation behavior changes while replacing UI components.
- **Frontend UX Evidence**: PASS. Implementation must start with `agent-browser` observation/screenshots of affected surfaces and end with verification at desktop `1440x900`, tablet `1024x768`, and mobile `390x844` with no horizontal scroll.
- **Product Behavior & API Scope**: PASS. Existing Chrona UI behavior, copy, state visibility, and page flows are preserved. Backend APIs remain unchanged because this is UI foundation consolidation.
- **UX Clarity & Responsiveness**: PASS. Affected screens must preserve current task, active node, blocked/review state, primary action visibility, loading/empty/error states, and existing i18n patterns.
- **Performance Budgets**: PASS. No new data fetching or backend calls are planned. Validation focuses on no visible layout instability, no duplicate UI system retention, and no obvious interaction delay.

## Project Structure

### Documentation (this feature)

```text
specs/011-shadcn-ui-refactor/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── ui-component-governance.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/web/
└── src/
    ├── components/
    │   ├── ui/                 # shadcn primitives only: Button, Badge, Card, Field/Input-compatible primitives
    │   ├── schedule/           # replace imports while preserving schedule behavior/state clarity
    │   ├── settings/           # replace form/action/card primitives
    │   ├── tasks/              # replace workspace primitives without changing task flows
    │   ├── work/               # replace work surface cards/badges/buttons
    │   ├── inbox/              # replace list/action primitives where used
    │   ├── memory/             # replace console surface primitives where used
    │   ├── assistant-surface/  # preserve prior AI dropdown behavior while using shared primitives
    │   └── global-ai-sidebar/  # remove/adjust only if active imports remain from prior work
    ├── lib/
    │   └── utils.ts            # shared `cn` helper used by shadcn components
    └── styles/                 # theme tokens and dark-mode variables, not duplicate components

AGENTS.md                      # updated plan pointer and future AI guardrails
components.json                # existing shadcn configuration
```

**Structure Decision**: Use the existing Vite web app layout. Standard foundational components live in `apps/web/src/components/ui`; Chrona-specific meaning stays in thin product wrappers near the owning feature area; page components compose shared primitives and do not define new generic button, badge, card, or field systems.

## Complexity Tracking

No constitution violations identified. No added framework, backend API, persistence model, or compatibility layer is planned.

## Phase 0 Research Summary

See [research.md](./research.md). Key decisions: shadcn primitives become the default foundation, Chrona wrappers are allowed only for semantic product meaning, legacy compatibility exports are removed, and guardrails are added through documentation plus repeatable inventory checks.

## Phase 1 Design Summary

See [data-model.md](./data-model.md) and [contracts/ui-component-governance.md](./contracts/ui-component-governance.md). Key entities: UIComponentInventoryItem, ComponentClassification, ReplacementDecision, ChronaWrapper, VerificationEvidence, and DuplicatePrimitiveGuardrail.

## Post-Design Constitution Check

- **Code Quality**: PASS. Design assigns ownership to shadcn primitives, feature-owned domain wrappers, and page compositions without mixing business rules into UI primitives.
- **Testing**: PASS. Design requires typecheck, lint, tests, focused component regression tests, and e2e only when task/schedule/navigation behavior changes.
- **Frontend UX Evidence**: PASS. Quickstart requires `agent-browser` pre-edit and post-edit evidence across all mandated viewports.
- **Product Behavior & API Scope**: PASS. Contracts are UI governance contracts only; no backend or data contracts are introduced.
- **UX Clarity & Responsiveness**: PASS. Verification explicitly covers dark mode, accessibility, mobile no-horizontal-scroll, state clarity, and unchanged flows.
- **Performance Budgets**: PASS. No unresolved budgets remain; duplicate UI system removal should not increase runtime work or bundle surface.
