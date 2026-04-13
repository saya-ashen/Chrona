# Schedule And Work Redesign Design

## Goal

Redesign the `Schedule` and `Work` pages so they read like human-first operator surfaces instead of dense prototype dashboards.

The redesign should:

- make the next action obvious within one screenful
- improve scanning, hierarchy, and reading comfort on desktop and mobile
- keep current product semantics intact: `Schedule` is the planning surface, `Work` is the execution surface
- avoid broad backend or domain-model rewrites unless a small read-model adjustment is strictly necessary

## Product Direction

This redesign uses a `workbench-first` direction with a `high-contrast operator UI` visual style.

The pages should feel different on first glance:

- `Schedule` should feel like a planning canvas
- `Work` should feel like a live execution workbench

The redesign is intentionally stronger than a visual polish pass. It resets information hierarchy and page composition, especially for `Work`, where the current layout makes the next operator action too hard to identify.

## Problems In The Current UI

### Schedule

- The page contains the right kinds of information, but the timeline, queue, and lower planning sections compete for equal attention.
- The current summary area is heavier than it needs to be.
- The right-side content does not act like a focused action rail; it behaves more like an additional content pile.

### Work

- The page currently mixes status, conversation, approvals, result, execution history, context, and plan into several competing primary surfaces.
- The user must infer the next action instead of being shown one clear dominant intervention surface.
- The two side panels add useful context, but they steal too much visual weight from the actual execution loop.

## Design Principles

- One page, one job.
- One screen, one dominant action.
- Show the most actionable information first.
- Demote passive metadata, raw payloads, and long-tail details.
- Use contrast, spacing, and scale to establish hierarchy before adding more chrome.
- Keep desktop and mobile reading order aligned.

## Schedule Page Design

### Intended Reading Order

1. Understand schedule health and active date range.
2. Read or manipulate the timeline/list main canvas.
3. Resolve the currently active secondary topic: queue, risks, or proposals.
4. Navigate across days using a lighter week strip.

### Layout

#### Planning Header

The top section becomes a thinner planning header.

It shows:

- page title
- current date focus / range
- view switch for `timeline` and `list`
- four compact metrics: `scheduled`, `queue`, `risks`, `proposals`

It should not contain heavy editor controls or large explanatory blocks.

#### Timeline-First Main Canvas

The main content area is a two-column desktop layout:

- left: `TimelineCanvas` or list view at roughly 70 to 75 percent width
- right: `ScheduleActionRail`

The main canvas is the strongest visual surface on the page.

In timeline mode, scheduled blocks should emphasize:

- title
- time window
- risk / state badge
- runnable readiness

Descriptions and secondary metadata should be reduced or moved behind detail affordances.

#### Action Rail

The right rail becomes a single focused action surface with three segmented modes:

- `Queue`
- `Risks`
- `Proposals`

Only one mode is visually primary at a time.

Behavior:

- default to `Risks` when actionable schedule risks exist
- otherwise default to `Queue` when unscheduled tasks exist
- otherwise default to `Proposals` when AI suggestions exist
- otherwise default to `Queue`

Each mode should have a distinct visual treatment so users can instantly tell whether they are scheduling pending work, triaging disruption, or reviewing AI suggestions.

#### Week Strip

`Week Overview` is demoted into a lighter strip below the main work area.

It acts as:

- quick day navigation
- density / load preview
- context for switching the active day

It should no longer feel like a third competing planning panel.

### Interaction Rules

- The timeline remains the primary place to schedule, move, or inspect blocks.
- The action rail provides fast triage and entry into schedule actions, but does not overtake the timeline as the main canvas.
- Card-level quick actions should be limited to the minimum useful set; overflow actions move into task detail or contextual controls.

## Work Page Design

### Intended Reading Order

1. Understand the task, run state, and blocking summary.
2. Take the current next action.
3. Read the latest meaningful output.
4. Review the execution stream if deeper context is needed.
5. Open supporting context such as plan, tools, artifacts, and task metadata only when needed.

### Layout

#### Task Shell

The top section becomes a compact `TaskShell`.

It shows:

- task title
- task status
- run status
- schedule impact
- one-line blocking summary
- quick links to task detail and schedule

It should orient the operator immediately without reading like a metadata sheet.

#### Next Action Hero

This becomes the most prominent area on the page and the main reason the user opened `Work`.

It answers:

- what is blocking progress now
- what the operator should do next
- what happens after the action completes

Only one dominant intervention surface may appear at a time.

Rules by state:

- `WaitingForApproval`: show approval context and direct actions as the primary focus
- `WaitingForInput`: show a focused operator composer as the primary focus
- `Running`: show live progress with optional lightweight operator input, not a misleading heavy action form
- `Failed`: show failure summary and retry path as the primary focus
- `Completed`: show closure and handoff actions as the primary focus
- `No active run yet`: show run-start framing as the primary focus

The current page pattern of making approvals, conversation, result, and plan all compete for first place should be removed.

#### Latest Result Panel

The second major section is a readable result surface.

Purpose:

- show the most useful current output
- let the operator assess progress before digging into event history

Presentation rules:

- treat this as reading content, not chat UI
- prioritize line length, whitespace, and stable headings
- show source and update time clearly but lightly
- keep action buttons near the result when they directly depend on that result

#### Execution Stream

The third main section becomes a unified execution stream.

It combines meaningful items from:

- execution milestones
- user input
- agent output
- approval events
- tool results
- run state changes

Default behavior:

- show important, readable events first
- collapse long raw details by default
- avoid splitting the page into separate "conversation" and "timeline" zones that compete for meaning

#### Inspector Surface

Auxiliary content becomes a lighter `WorkInspector` area instead of two heavyweight side rails.

The inspector contains:

- plan
- artifacts
- tools
- task context

Rules:

- lower visual priority than the three main workbench surfaces
- collapsible on mobile
- compact on desktop
- no duplicate primary intervention form

## Visual System

### Style Direction

Use a `high-contrast workbench` visual language.

This means:

- a stronger separation between primary, secondary, and tertiary surfaces
- clearer status chips and stronger action emphasis
- larger differences in background depth between hero sections and supporting panels
- more disciplined spacing and fewer equally styled cards

### Color And Emphasis Rules

- blue: active, informative, in progress
- yellow: waiting, attention, risk
- red: failure, interruption, urgent issue
- green: completed, accepted, resolved

Avoid giving every block a unique accent. Color should encode meaning, not decoration.

### Content Density Rules

- reduce nested card-inside-card patterns
- prefer spacing and typography over extra borders
- let primary surfaces breathe with larger padding and clearer vertical rhythm
- keep supporting surfaces compact and quieter

## Responsive Rules

### Schedule Mobile Order

1. `PlanningHeader`
2. `TimelineCanvas` or list view
3. active `ScheduleActionRail` segment
4. `WeekStrip`

The rail becomes a segmented top control on mobile instead of a side column.

### Work Mobile Order

1. `TaskShell`
2. `NextActionHero`
3. `LatestResultPanel`
4. `ExecutionStream`
5. `WorkInspector`

No supporting context should appear above the primary next action.

## Component Boundaries

### Schedule

Refactor `src/components/schedule/schedule-page.tsx` into page-level sections that match the new hierarchy:

- `PlanningHeader`
- `TimelineCanvas`
- `ScheduleActionRail`
- `WeekStrip`

This split is structural, not abstract. It exists to support the new layout and maintainability of an already very large page file.

### Work

Refactor `src/components/work/work-page-client.tsx` around:

- `TaskShell`
- `NextActionHero`
- `LatestResultPanel`
- `ExecutionStream`
- `WorkInspector`

`src/components/work/collaboration-stream.tsx` can remain, but it should serve the new execution stream instead of acting like the page skeleton.

`src/components/work/run-side-panel.tsx` and `src/components/work/task-plan-side-panel.tsx` should be absorbed into, or reshaped for, the new inspector model rather than preserved as heavyweight independent rails.

## Data And Backend Constraints

- Prefer using the existing `getSchedulePage()` and `getWorkPage()` query contracts.
- Avoid broad projection or domain-model rewrites in this redesign.
- If the UI needs a small derived summary to support the new hierarchy, add the smallest necessary read-model shaping only.

## Testing Strategy

Update the current component tests to validate behavior and hierarchy rather than the old layout labels.

Primary test focus:

- `Work` shows the current next action before supporting inspector content
- `Work` keeps latest result more prominent than deep context panels
- `Work` uses a unified execution stream instead of scattered primary sections
- `Schedule` keeps the timeline/list as the dominant planning canvas
- `Schedule` shows only one active action-rail topic as primary at a time
- both pages keep the intended mobile reading order

Likely touchpoints:

- `src/components/work/__tests__/work-page.test.tsx`
- `src/components/schedule/__tests__/schedule-page.test.tsx`

## Out Of Scope

- large backend redesigns
- new domain concepts unrelated to page hierarchy
- redesigning unrelated pages
- introducing persistence for new note-taking or scratchpad features

## Implementation Sequence

1. Restructure page layout and primary/secondary section ordering.
2. Rebuild the visual hierarchy and contrast system.
3. Adapt supporting components to the new page roles.
4. Update tests to match the new semantics and reading order.

## Acceptance Criteria

- `Schedule` reads as a planning canvas rather than a stack of equal-weight panels.
- `Work` makes the current operator action obvious without scanning multiple regions.
- `Latest Result` is easier to read than the current chat-like output presentation.
- secondary context is still available, but visually demoted.
- desktop and mobile both preserve a clear reading order.
