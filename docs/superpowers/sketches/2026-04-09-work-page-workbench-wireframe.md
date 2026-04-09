# Work Page Workbench Wireframe

## Purpose

Refocus `Work Page` so it becomes the run-level collaboration workbench instead of a dashboard-style pile of cards.

This sketch redefines the surface around one loop:

- observe what the agent is doing
- inspect the evidence that matters now
- intervene with the next action
- continue execution and verify the result

---

## Core product decision

Use a **workbench layout**, not a monitoring layout and not a chat-first shell.

### Why

- `Task Page` already owns planning, scope, and run launch
- `Work Page` should own execution, intervention, and recovery
- equal-weight cards make it hard to know what matters now
- a run-level workbench must always surface the current blocker and next operator action first

### Final recommendation

- **Top shell:** sticky context bar
- **Primary surface:** `Next Action` + `Shared Output` + `Execution Workstream`
- **Secondary surface:** inspector rail for approvals, artifacts, tool activity, and sync health

---

## Desktop layout

```text
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ Work                                                                                │
│ Task title                    Task status · Run status · AtRisk · Due Apr 16        │
│ Open Task · Open Schedule     Blocked by: approval needed                           │
├──────────────────────────────────────────────────────┬──────────────────────────────┤
│ Main workbench                                       │ Inspector                    │
│                                                      │                              │
│ Next Action                                          │ Run snapshot                 │
│ - waiting for input / approval / retry / complete    │ - run status                 │
│ - one dominant form or decision surface              │ - sync health                │
│ - one clear CTA                                      │ - started / ended            │
│                                                      │                              │
│ Shared Output                                        │ Evidence                     │
│ - latest artifact / summary / generated result       │ - approvals                  │
│ - latest meaningful agent output                     │ - artifacts                  │
│                                                      │ - tool activity              │
│ Execution Workstream                                 │ - older details collapsed    │
│ [Workstream] [Conversation]                          │                              │
│ run.started                                           │                              │
│ tool.completed                                        │                              │
│ approval.requested                                    │                              │
│ user.resumed                                          │                              │
└──────────────────────────────────────────────────────┴──────────────────────────────┘
```

---

## Mobile layout

```text
┌──────────────────────────────┐
│ Work                         │
│ title + status chips         │
│ Open Task / Schedule         │
├──────────────────────────────┤
│ Next Action                  │
├──────────────────────────────┤
│ Shared Output                │
├──────────────────────────────┤
│ Workstream / Conversation    │
├──────────────────────────────┤
│ Inspector sections           │
│ Run / Approvals / Artifacts  │
└──────────────────────────────┘
```

### Mobile rules

- keep `Next Action` above all other content
- keep run state and block reason visible without opening accordions
- treat inspector data as collapsible sections
- avoid side-by-side competing content areas

---

## Information hierarchy

### 1) Context bar

Purpose: orient the operator without turning the page into a metadata sheet.

Should show:

- task title
- task status
- run status
- schedule impact
- due / window summary
- quick links to `Open Task` and `Open Schedule`
- short block summary

Should **not** dominate the page with long descriptions or heavy controls.

### 2) Next Action

Purpose: answer `what should I do next?`

Rules by run state:

- `WaitingForInput`
  - show operator composer
  - prefill from `pendingInputPrompt`
  - primary CTA: `Send to Agent`
- `WaitingForApproval`
  - show pending approval context
  - primary CTAs: `Approve`, `Reject`, `Edit and Approve`
- `Running`
  - show the latest milestone and current execution status
  - no fake composer as the main action
- `Failed`
  - show failure summary and retry form
  - primary CTA: `Retry Run`
- `Completed`
  - show result / handoff state
  - primary CTA becomes navigational or review-oriented

Only one dominant intervention surface should exist.

### 3) Shared Output

Purpose: answer `what useful result do I have right now?`

This is the main work surface for:

- latest artifact
- generated output summary
- latest meaningful agent result
- future preview/editor surfaces

For MVP, use the latest artifact first; otherwise fall back to the latest assistant output.

### 4) Execution Workstream

Purpose: answer `what just happened?`

Default behavior:

- visible by default, not hidden behind a low-priority accordion
- default view = meaningful execution events
- secondary view = conversation

Show milestones such as:

- run started
- tool completed
- approval requested
- input provided
- run failed / completed

Hide raw payloads behind expansion.

### 5) Inspector rail

Purpose: keep evidence available without stealing the page focus.

Keep here:

- run snapshot
- approvals summary
- artifacts list
- tool activity
- sync/runtime health

Do **not** duplicate the main intervention form here.

---

## What should be demoted or removed

Demote by default:

- full raw event payloads
- older conversation
- heavy tool detail trees
- long metadata blocks
- local scratchpad without persistence

For current MVP, the local `Editor` / scratchpad should not occupy the primary workbench path.

---

## Phase plan

### Phase 1 — layout reset

Use the current read model and refactor the page so it becomes:

- sticky context bar
- `Next Action` first
- `Shared Output` second
- visible `Execution Workstream`
- simplified inspector rail
- no duplicate composer / retry surface

### Phase 2 — workbench read model

Refine `getWorkPage()` or a dedicated work projection into:

- `currentIntervention`
- `latestOutput`
- `workstreamItems`
- `scheduleImpact`
- `secondaryInspectors`

### Phase 3 — richer collaboration actions

- inline evidence-linked approvals
- inline recovery actions
- artifact preview tied to workstream events

### Phase 4 — durable work surfaces

- persistent draft / notes
- artifact-linked editing
- structured handoff surfaces

---

## Bottom line

`Work Page` should feel like the place where a human and an agent jointly finish a task.

If the page does not make the next intervention obvious, it is still behaving like a dashboard rather than a workbench.
