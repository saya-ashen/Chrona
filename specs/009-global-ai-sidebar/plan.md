# Implementation Plan: Global AI Sidebar

**Branch**: `009-global-ai-sidebar` | **Date**: 2026-05-18 | **Spec**: `specs/009-global-ai-sidebar/spec.md`
**Input**: Feature specification from `specs/009-global-ai-sidebar/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Add a product-native global AI sidebar opened from the top-level Chrona entry (`Ask Chrona / ⌘K`) and rendered as a fixed right-side contextual panel. The plan uses a frontend-first architecture: a shared sidebar shell/provider under `apps/web`, typed page context adapters for task and schedule pages, shared proposal preview contracts in `packages/contracts`, domain helpers for stale-preview checks and proposal summaries in `packages/domain`, and existing task/schedule apply paths so no AI-generated mutation occurs before explicit user confirmation.

## Technical Context

**Language/Version**: TypeScript strict, React 19, Vite SPA, Bun runtime/tooling  
**Primary Dependencies**: React Router 7, existing Chrona UI primitives/Tailwind classes, `@chrona/contracts`, `@chrona/domain`, existing AI hooks and task/schedule page state hooks  
**Storage**: No new persistence for initial release; sidebar session and pending proposal state are client session state. Confirmed changes reuse existing task/schedule persistence paths.  
**Testing**: Bun/Vitest component and domain tests plus Playwright e2e; required commands are `bun run typecheck`, `bun run lint`, `bun run test`, `bun run test:e2e`  
**Target Platform**: Chrona web app in desktop, tablet, and mobile browser viewports  
**Project Type**: Vite + React frontend feature with shared TypeScript contracts/domain helpers  
**Performance Goals**: sidebar open/close and context switching render within 100 ms after loaded page state changes; sidebar JS/CSS delta target under 35 KB gzip; AI request progress appears within 500 ms after action submission; no added page data fetch during sidebar open when task/schedule context is already loaded.  
**Constraints**: fixed right panel on desktop/tablet; mobile must avoid horizontal scroll at 390x844; all user-visible strings in i18n; no business rules in React components; no backend API change unless an implementation gap is documented before coding.  
**Scale/Scope**: initial support for task workspace and schedule page, unsupported pages get non-mutating general context only, one pending proposal per sidebar session.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code Quality**: Confirm the change fits the correct layer boundaries, uses the
  smallest correct design, and lists any justified complexity in Complexity
  Tracking.
- **PASS**: UI shell and page adapters stay in `apps/web`; proposal/context types live in `packages/contracts`; pure stale-preview and summary helpers live in `packages/domain`; task/schedule pages retain ownership of confirmed mutations.
- **Testing**: List required automated coverage by level: unit, integration,
  contract, end-to-end, and the commands that will prove the behavior. Include
  `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run test:e2e`
  when task, schedule, or navigation flows are affected.
- **PASS**: Unit/domain tests cover proposal state transitions and stale detection; component tests cover sidebar shell, task adapter, schedule adapter, preview cards, confirm/dismiss/refine; e2e covers global entry, task flow, schedule ghost blocks, navigation context switching, and mobile no-horizontal-scroll. Validation commands: `bun run typecheck`, `bun run lint`, `bun run test`, `bun run test:e2e`.
- **Frontend UX Evidence**: For frontend visual or interaction changes, record
  the required pre-edit `agent-browser` snapshot/screenshots and post-edit
  verification evidence.
- **PASS**: Implementation tasks must capture pre-edit `agent-browser` snapshots/screenshots for current task and schedule pages, then post-edit desktop `1440x900`, tablet `1024x768`, and mobile `390x844` verification with the sidebar open.
- **Product Behavior & API Scope**: Identify the existing Chrona behavior that
  must be preserved. Confirm backend APIs are unchanged for visual/interaction
  polish, or justify the API change here.
- **PASS**: Existing task plan generation, task proposal apply, schedule drag/drop, quick create, conflict/risk display, and navigation behavior remain unchanged until a user confirms a preview. Initial plan has no backend API changes.
- **UX Clarity & Responsiveness**: Identify the existing UI patterns, copy, state
  handling, i18n messages, and desktop `1440x900`, tablet `1024x768`, and mobile
  `390x844` checks. Confirm mobile has no horizontal scrolling and that current
  task, active node, blocked/review state, and primary action are visually
  obvious when applicable.
- **PASS**: Reuse Chrona rounded card, border, white/slate, blue-primary visual language; add `components.globalAiSidebar` i18n messages in `en.json` and `zh.json`; context summary highlights task title, selected/active node, blocker/review state, selected date, queue count, free-time estimate, conflicts, and primary confirm action.
- **Performance Budgets**: Define measurable budgets for latency, rendering,
  startup, memory, query count, or bundle size when applicable, plus how they
  will be validated.
- **PASS**: Budgets defined above. Validate with browser interaction timing during e2e/manual evidence, build output review for bundle delta, and tests proving no mutation requests run before confirmation.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
```text
apps/web/src/
├── components/global-ai-sidebar/
│   ├── global-ai-sidebar.tsx
│   ├── global-ai-sidebar-provider.tsx
│   ├── global-ai-sidebar-entry.tsx
│   ├── context-summary-card.tsx
│   ├── quick-action-list.tsx
│   ├── conversation-thread.tsx
│   ├── proposal-preview-card.tsx
│   ├── schedule-ghost-block-layer.tsx
│   └── __tests__/
├── components/tasks/workspace/
│   └── adapters/task-ai-sidebar-adapter.ts
├── components/schedule/
│   └── adapters/schedule-ai-sidebar-adapter.ts
├── i18n/messages/en.json
└── i18n/messages/zh.json

packages/contracts/src/
├── ai-sidebar.ts
└── index.ts

packages/domain/src/
└── ai-sidebar/
    ├── proposal-state.ts
    ├── summarize-context.ts
    └── proposal-state.bun.test.ts

tests/e2e/
└── global-ai-sidebar.spec.ts
```

**Structure Decision**: Use a shared sidebar component/provider in `apps/web/src/components/global-ai-sidebar`, thin task/schedule adapters near owning page features, shared serializable contracts in `packages/contracts`, and pure validation/summary helpers in `packages/domain`. This keeps page mutation ownership with existing `TaskWorkspacePage` and `SchedulePage` flows while allowing one global entry and shell.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |

## Phase 0: Research Summary

See `specs/009-global-ai-sidebar/research.md`.

## Phase 1: Design Summary

See `specs/009-global-ai-sidebar/data-model.md`, `specs/009-global-ai-sidebar/contracts/ui-contract.md`, and `specs/009-global-ai-sidebar/quickstart.md`.

## Post-Design Constitution Check

- **Code Quality**: PASS. Design keeps component, adapter, contract, and domain responsibilities separate.
- **Testing**: PASS. Required test levels and commands are documented in quickstart and contract expectations.
- **Frontend UX Evidence**: PASS. Browser evidence is required before and after UI implementation at all mandated viewports.
- **Product Behavior & API Scope**: PASS. Existing mutation flows stay authoritative; backend API changes are out of scope for this plan.
- **UX Clarity & Responsiveness**: PASS. Context summary, action availability, preview, stale state, and primary confirmation are explicit contract states.
- **Performance Budgets**: PASS. Interaction, AI-progress, query-count, and bundle-delta budgets are measurable.
