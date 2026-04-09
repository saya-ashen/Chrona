# Schedule Page Wireframe Sketch

## Purpose

Make `Schedule` the control plane's real scheduling workbench for a single workspace.

The page should let the user quickly answer:

- what is already committed
- what is still unscheduled
- what AI is suggesting
- what is at risk or needs intervention now

This sketch is intentionally text-only and implementation-oriented.

---

## Page Goals

- treat `Schedule` as the global planning surface, not a passive dashboard
- make the next few days of work legible at a glance
- let users place unscheduled tasks into time blocks
- make AI proposals reviewable instead of opaque
- surface conflicts, overdue work, and blocked execution as scheduling problems
- keep edits fast and reversible

---

## Desktop Layout

```text
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ Schedule                                                                           │
│ [Today] [This Week] [View: Week ▾] [Search] [Filters] [Ask AI to Propose]          │
│ Summary: 12 scheduled · 5 unscheduled · 2 proposals · 3 risks                      │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ MAIN WORKBENCH                                             │ SIDE RAIL             │
│                                                            │                       │
│ 1. Scheduled Timeline / Time Blocks                        │ 4. AI Proposals       │
│    - today/week grouped by day                             │    - proposal cards    │
│    - each block shows task, time, due, status, risk        │    - accept / reject   │
│    - quick move / clear / inspect                          │    - edit then apply   │
│                                                            │                       │
│ 2. Unscheduled Queue                                       │ 5. Risks / Conflicts  │
│    - compact task cards                                    │    - overdue           │
│    - schedule now / this week / open task                  │    - at risk           │
│    - proposal count / urgency                              │    - interrupted       │
│                                                            │    - jump to action    │
│ 3. Inline Inspector (contextual, optional panel/drawer)    │                       │
│    - selected task summary                                 │                       │
│    - schedule constraints                                  │                       │
│    - reassign / reschedule                                 │                       │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Priority of attention

1. Risks requiring intervention
2. Current and upcoming scheduled blocks
3. Unscheduled work that must enter the timeline
4. AI proposals that could improve the plan

---

## Mobile Layout

```text
┌──────────────────────────────┐
│ Schedule                     │
│ [Today] [Week ▾] [AI]        │
│ [Search] [Filters]           │
├──────────────────────────────┤
│ Summary chips                │
│ [12 scheduled] [5 queue]     │
│ [2 proposals] [3 risks]      │
├──────────────────────────────┤
│ Sections / tabs              │
│ [Plan] [Queue] [AI] [Risks]  │
├──────────────────────────────┤
│ Active section content       │
│ - stacked day cards          │
│ - queue cards                │
│ - proposal cards             │
│ - risk cards                 │
└──────────────────────────────┘
```

### Mobile rules

- one primary panel at a time
- details open in a drawer or sheet
- drag-and-drop can be deferred; tap actions must exist
- risks and proposals should stay near the top because they are interruption-driven

---

## Section Responsibilities

### 1) Top Summary Bar

Purpose: give instant schedule health.

Should show:

- scheduled count
- unscheduled count
- pending AI proposal count
- risk count
- current date range
- current workspace context (single-workspace, no switcher)

Should support:

- date jump (`Today`, `This Week`)
- view switch (`Day`, `Week`)
- search
- filters
- AI propose action

---

### 2) Scheduled Timeline / Time Blocks

Purpose: the main planning surface.

Each scheduled item should show:

- title
- scheduled start/end
- due time
- persisted status
- schedule status
- latest run status
- schedule source (`human` / `ai` / `system`)
- risk badge if present

Primary actions:

- apply / edit schedule
- move to another slot
- clear schedule
- open task page
- open work page when execution risk is involved
- reassign task

MVP presentation:

- grouped day sections with visible time ranges
- editable block list, not necessarily drag-and-drop calendar first

Later enhancement:

- full calendar grid
- drag and resize
- multi-agent lanes

---

### 3) Unscheduled Queue

Purpose: hold work that has not entered the timeline.

Each queue item should show:

- title
- priority
- due date
- action required / recommended action
- proposal count
- current blocking or readiness signal

Primary actions:

- schedule now
- schedule for today / this week
- ask AI to propose
- open task page

Recommended ordering:

1. overdue or near-due
2. high priority
3. blocked because of missing schedule
4. everything else by recency or urgency

---

### 4) AI Proposals

Purpose: present AI schedule suggestions as explicit decisions.

Each proposal should show:

- task title
- proposed time range
- proposal summary
- proposed by
- due impact
- why this proposal exists
- whether it conflicts with current plan

Primary actions:

- accept proposal
- reject proposal
- edit then apply
- compare with current schedule

Design rule:

- proposals should read like reversible diffs, not black-box outputs

---

### 5) Risks / Conflicts

Purpose: make schedule exceptions actionable.

Each risk item should answer:

- where it is blocked
- why it is blocked or risky
- who should handle it
- which action should be taken next

Risk types to surface:

- `AtRisk`
- `Overdue`
- `Interrupted`
- waiting for approval/input when it threatens the schedule
- collisions or overbooked windows

Primary actions:

- reschedule
- open inbox
- open work page
- clear or move the affected block

---

### 6) Contextual Inspector

Purpose: edit without losing schedule context.

Should show:

- selected task summary
- schedule facts
- due date
- dependency summary
- block summary
- recent run snippet if relevant

Primary actions:

- edit schedule
- reassign
- jump to task page
- jump to work page

---

## Data Expectations Per Section

### Schedule Projection

Should provide:

- scheduled tasks by time range
- unscheduled tasks
- overdue / at-risk / interrupted tasks
- AI schedule proposals
- assignee or agent load summary

### Lightweight Task Shell

Each item should ideally include:

- title
- persisted status
- priority
- block reason / block summary
- due date
- schedule summary
- latest run status

---

## Core Actions On This Page

These are the scheduling actions that belong here:

- `proposeSchedule`
- `applySchedule`
- `clearSchedule`
- `reassignTask`
- `acceptScheduleProposal`
- `rejectScheduleProposal`

High-value UX actions built from them:

- schedule now
- edit then apply
- reschedule affected work
- compare AI suggestion with current plan

---

## MVP Recommendation

Build the page in this order:

1. top summary + filters
2. scheduled block list grouped by day/week
3. unscheduled queue with quick schedule actions
4. AI proposals panel with accept/reject/edit
5. risks panel with precise next actions
6. optional inspector drawer/panel

This keeps the page useful before implementing heavy calendar interactions.

---

## Later Enhancements

- drag-and-drop timeline editing
- multi-agent / multi-lane planning
- capacity heatmaps
- dependency overlays
- batch rescheduling
- what-if simulation mode
- richer AI explanations and confidence controls

---

## Design Guardrails

- `Schedule` is the place for global arrangement and conflict resolution
- `Task Page` explains and adjusts one task's plan
- `Work Page` explains execution and recovery, not global scheduling
- blocked or failed execution must feed back into schedule risk
- the page center should be the plan itself, not forms or passive tables
