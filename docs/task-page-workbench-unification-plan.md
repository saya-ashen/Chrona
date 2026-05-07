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

The unified task page should be a single graph-centered page, not a `Plan / Run` split.

The plan graph should become the primary execution surface for the task.

That does not mean every runtime detail must literally live inside the canvas. It means:

- the graph is the primary entry point
- the graph is the primary status map
- execution starts from the graph
- runtime intervention is anchored to the selected node / current action in the graph context

### Graph-first, not graph-only

The plan graph should sit at the center of the page and answer:

1. what is supposed to happen next?
2. what is currently blocked, waiting, running, or done?
3. where does the user need to act?

But the page should still use adjacent surfaces for heavier interaction:

- node detail panel
- current action panel
- output / result panel
- timeline / event history panel
- approvals / artifacts / context drawers or tabs

The graph is the command center. It is not the only container.

### Core page regions

Purpose: define, execute, observe, and intervene on one task from one canonical page.

Core regions:

- compact task summary + expandable edit form
- plan graph as the main visual center
- AI planning workspace for:
  - generate plan
  - revise plan
  - propose task edits
  - propose plan edits
- current execution summary tied to graph state
- node detail / inspector surface for:
  - next action
  - available actions
  - interactive fields
  - node-level output / notes / rationale
- graph-adjacent runtime surfaces for:
  - latest output / latest result
  - execution timeline / event stream
  - approvals and pending human input
  - artifacts
  - runtime health / sync state / block reason
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

They should be separated by intent and wording, not by route:

- planning: "help me define or revise the work"
- execution: "help me complete the current step or unblock the run"

### Keep one dominant visual center

- the graph should remain the center of the page
- execution details should attach to graph state, not compete with it as a second page-level center

### Keep node cards lightweight

The graph should surface actionability, but node cards should not become mini applications.

Do not cram large approval forms, retry flows, long outputs, or multi-step intervention UI directly into small node cards.

Use node selection to open richer adjacent surfaces instead.

### Avoid duplicate task headers and duplicate plan surfaces

The unified page should not repeat the same task context in multiple cards or recreate the old pattern where plan information appears in both task page and workbench page with different emphasis.

## Functional Scope Mapping

### Keep in the primary graph workspace

These concerns belong in the main task page flow:

- task title, description, priority, schedule edits
- runtime adapter selection and task runtime config
- plan generation
- plan revision
- plan acceptance
- execution start / current state visibility
- node-level next actions and intervention affordances
- AI proposal generation for task/plan edits

### Keep graph-adjacent, not canvas-embedded

These concerns should live on the same page, but in side panels, bottom panels, drawers, or tabs rather than directly inside node cards:

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

### Existing graph already supports this direction conceptually

The current graph model already contains useful execution-oriented primitives:

- node statuses like `ready`, `active`, `waiting`, `blocked`, `done`
- node intent types like `approval`, `input`, `decision`, `pause`
- node-level `nextAction`
- `availableActions`
- `interactiveFields`

This means the target direction is not speculative. The data model already points toward a graph-centered execution UX. The missing work is UI wiring and runtime command integration.

## Recommended Final Layout

### Shared page frame

Always visible:

- task title
- compact status badges
- back navigation
- overflow actions
- compact task summary + expandable editor

### Main desktop layout

- center / left-main:
  - large plan graph panel
  - selected node detail / current action surface attached to graph context
- right:
  - AI planning workspace
  - compact execution summary / next-step summary
- lower or secondary region:
  - latest output
  - execution timeline
  - approvals / artifacts / context inspection

### Interaction model

- clicking a node reveals the relevant detail and actions
- starting execution happens from the graph context
- waiting-for-input / waiting-for-approval states should highlight the responsible node and open the associated action panel
- runtime outputs should stay easily reachable without replacing the graph as the page center

Alternative on narrower viewports:

- stack graph first, then current action, then output/history
- keep the current actionable surface directly under the graph
- move historical details below the current action region

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

### Phase 2: make the graph execution-aware

Goal: turn the graph from a planning view into the primary execution map.

Tasks:

1. map runtime execution state onto graph and node UI
2. highlight current node, blocked node, waiting node, and next-action node
3. expose node-level next actions and interactive fields through inspector / side panel UI
4. surface approvals / pending input / blocked reasons from graph context

Success criteria:

- users can understand execution state by looking at the graph first

### Phase 3: embed intervention and execution actions

Goal: make the graph-centered task page executable, not just observable.

Tasks:

1. add execution start from the graph context
2. add intervention composer for runtime-stage human input tied to selected/current node
3. add approval / reject / edit-and-approve flows
4. add retry / accept result / reopen / mark done flows
5. add follow-up task creation where still useful
6. surface latest output and execution timeline as graph-adjacent panels

Success criteria:

- users can handle live execution and human-in-the-loop actions without leaving the graph-centered task page

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

- keep the graph as the dominant center
- use progressive disclosure for node detail, output, history, and artifacts
- avoid showing every execution surface at once

### Risk: planning chat and runtime input feel conflated

Mitigation:

- use separate components and labels for planning vs intervention
- do not reuse the same wording for proposal chat and live run input

### Risk: graph becomes overloaded and unusable

Mitigation:

- keep node cards lightweight
- move heavy forms and long outputs into adjacent panels
- treat the graph as the map and launcher, not the container for every detail

### Risk: implementation copies old workbench instead of simplifying

Mitigation:

- treat old workbench as capability inventory only
- redesign information architecture around current task page, not route parity

## Final Recommendation

Chrona should converge to:

- one canonical per-task page
- one separate multi-task queue page

The old per-task `workbench` should not survive as a distinct long-term product surface unless Chrona intentionally evolves a much denser IDE-like execution console. That is not the current product direction.
