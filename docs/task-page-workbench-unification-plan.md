# Task Page / Workbench Unification Plan

## Goal

Define the target product shape for task planning and task execution after the current per-task `workbench` is retired.

This document assumes the existing per-task workbench is not worth preserving as a separate product surface. The question is not how to migrate the old page mechanically, but what the final user experience should be.

## Decision

Chrona should not keep a separate per-task `workbench` page long term.

Final direction:

1. keep one canonical `Task` page for a single task
2. keep one separate multi-task `Workbench Hub` / work queue page
3. absorb per-task execution, intervention, and output workflows into the `Task` page

## Why

### A separate per-task workbench adds user burden

If one task has both a `Task` page and a `Workbench` page, users have to decide:

- where to edit the task
- where to review the plan
- where to monitor execution
- where to respond to approvals or requests for input
- where to talk to AI

This creates navigation cost and splits the mental model for the same object.

### The task page is already the natural home

The current task page already owns the task-level planning workflow:

- task configuration
- plan graph
- AI planning workspace
- proposal review / apply flow

Execution is the next adjacent concern for the same task, so it should live in the same page rather than behind a second task-specific destination.

### The queue page still has value

The multi-task `Workbench Hub` serves a different purpose:

- what needs my attention now
- which tasks are ready, running, blocked, or failed
- where should I jump next

That page should stay separate because it is an operational inbox, not a task-detail page.

## Product Model

### One task, one page

For any single task, Chrona should have one primary page.

That page should answer both questions:

1. what is this task and how should it be planned?
2. what is happening during execution and what do I need to do next?

### One queue, many tasks

For cross-task operations, Chrona should keep a separate queue-oriented page.

This is the role of the existing `Workbench Hub` concept.

## Target Information Architecture

The unified task page should have two top-level modes for the same task:

1. `Plan`
2. `Run`

These should be modes or tabs inside the task page, not separate routes with different product identities.

### Plan mode

Purpose: define and revise the intended work before or between execution attempts.

Core regions:

- compact task summary + expandable edit form
- plan graph as the visual center of the page
- AI planning workspace for:
  - generate plan
  - revise plan
  - propose task edits
  - propose plan edits
- plan acceptance state
- schedule context relevant to planning

### Run mode

Purpose: monitor execution, review outputs, and handle human-in-the-loop intervention.

Core regions:

- execution status summary
- latest output / latest result
- execution timeline / event stream
- approvals and pending intervention state
- artifacts produced by the run
- runtime health / sync state / current node
- human intervention composer for:
  - input
  - approval
  - retry
  - review
- task-level execution actions such as:
  - start
  - retry
  - accept result
  - mark done
  - reopen
  - create follow-up task

## UX Principles

### Do not split planning AI and runtime intervention by page

Planning AI and runtime intervention are different interactions, but they should still live under one task page.

They should be separated by mode and wording:

- `Plan` mode: "help me define the work"
- `Run` mode: "help me complete the work in progress"

### Keep one dominant visual center per mode

- In `Plan`, the graph should remain the center.
- In `Run`, the current execution state and latest output should be the center.

### Avoid duplicate task headers and duplicate plan surfaces

The unified page should not repeat the same task context in multiple cards or recreate the old pattern where plan information appears in both task page and workbench page with different emphasis.

## Functional Scope Mapping

### Keep in Plan

These concerns belong in `Plan` mode:

- task title, description, priority, schedule edits
- runtime adapter selection and task runtime config
- plan generation
- plan revision
- plan acceptance
- AI proposal generation for task/plan edits

### Move into Run

These concerns belong in `Run` mode:

- latest run summary
- latest output
- execution record / workstream timeline
- approval handling
- human input requests
- runtime retry / accept / reopen actions
- artifacts
- tool and context inspection where still useful

### Keep outside the task page

These concerns should remain outside the unified task page:

- multi-task triage queue
- cross-task operational overview
- "what needs me now" routing

## Current Codebase Implications

### Existing task page is already a strong base

The current task page already has:

- shared task config editing
- plan graph panel
- AI planning workspace
- proposal diff/apply flow

This means the page already owns the planning side of the product model.

### Existing work page still represents missing execution capabilities

The current work page contains the execution-side concepts that need to be absorbed into task page design:

- execution-state banners
- latest output
- execution timeline
- run details
- intervention composer
- quick execution actions

These are the real capabilities to preserve, not the old page structure itself.

## Recommended Final Layout

### Shared page frame

Always visible:

- task title
- compact status badges
- back navigation
- overflow actions
- mode switch: `Plan | Run`

### Plan layout

- left/main:
  - compact edit summary + expandable edit panel
  - large plan graph panel
- right:
  - AI planning workspace

### Run layout

- left/main:
  - latest output
  - execution timeline
  - current node / status / block reason
- right:
  - intervention composer
  - approvals
  - quick actions
  - artifact summary

Alternative on narrower viewports:

- stack sections vertically
- keep the mode switch persistent at top
- prioritize latest actionable surface before historical details

## Non-Goals

This direction does not require:

- preserving the old per-task workbench route shape
- reproducing the old workbench UI one-to-one
- exposing two separate task destinations to the user

## Phased Delivery Plan

### Phase 1: finish the task page as the canonical planning page

Goal: make `Task` clearly stronger than the old workbench for planning.

Tasks:

1. keep compact task summary + expandable editor stable
2. keep plan graph as the main center
3. finish AI planning workspace polish
4. surface currently unused task-page read-model data where useful:
   - dependencies
   - block reason
   - latest run summary

Success criteria:

- users do not need per-task workbench for planning or task understanding

### Phase 2: add Run mode to the task page

Goal: bring execution visibility into the canonical task page.

Tasks:

1. add `Plan / Run` mode switch to task page
2. surface latest output
3. surface execution timeline / workstream history
4. surface runtime health and current execution state
5. surface approvals / pending input / blocked reasons

Success criteria:

- users can monitor task execution without leaving the task page

### Phase 3: embed intervention and execution actions

Goal: make task page executable, not just observable.

Tasks:

1. add intervention composer for runtime-stage human input
2. add approval / reject / edit-and-approve flows
3. add retry / accept result / reopen / mark done flows
4. add follow-up task creation where still useful

Success criteria:

- users can handle live execution and human-in-the-loop actions from the task page

### Phase 4: simplify routing and terminology

Goal: remove outdated product duplication.

Tasks:

1. redefine `Workbench Hub` explicitly as queue/inbox
2. remove per-task workbench wording from primary navigation
3. collapse duplicated routes once unified task page fully covers execution needs
4. update docs and product copy to reflect:
   - one task page
   - one work queue page

Success criteria:

- product language is consistent
- users do not need to understand an old `task vs workbench` distinction

## Risks

### Risk: task page becomes too heavy

Mitigation:

- keep `Plan` and `Run` as separate modes
- avoid showing all surfaces at once
- preserve strong hierarchy inside each mode

### Risk: planning chat and runtime input feel conflated

Mitigation:

- use separate components and labels for planning vs intervention
- do not reuse the same wording for proposal chat and live run input

### Risk: implementation copies old workbench instead of simplifying

Mitigation:

- treat old workbench as capability inventory only
- redesign information architecture around current task page, not route parity

## Final Recommendation

Chrona should converge to:

- one canonical per-task page
- one separate multi-task queue page

The old per-task `workbench` should not survive as a distinct long-term product surface unless Chrona intentionally evolves a much denser IDE-like execution console. That is not the current product direction.
