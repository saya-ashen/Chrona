# Schedule Timeline Hybrid Wireframe

## Purpose

Refine `Schedule` so the primary planning surface reads like a real timeline instead of a stack of dense task cards.

This sketch proposes a hybrid structure:

- `week strip` for lightweight range awareness and day switching
- `day timeline` as the main schedule canvas
- `inspector / side rail` for details, edits, risks, and proposals

The goal is to reduce clutter first, then improve temporal legibility.

---

## Core product decision

Use a **hybrid timeline**, not a full calendar grid.

### Why

- `Schedule` is a planning control plane, not a generic calendar app
- users need to answer `what is happening next`, `where is the conflict`, and `what should move`
- a full week grid increases density too early and hides execution risk behind calendar chrome
- a single-day timeline gives better scanability and a clearer path to action

### Final recommendation

- **Primary surface:** selected-day timeline
- **Secondary navigation:** 7-day overview strip
- **Detail surface:** inspector / expandable detail panel

---

## Desktop layout

```text
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ Schedule                                                                           │
│ [Today] [Tomorrow] [This Week] [View: Day ▾]                 Summary chips         │
│                                                             12 scheduled · 3 risk  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ Week strip                                                                          │
│ [Mon 2] [Tue 4] [Wed 3⚠] [Thu 5] [Fri 1] [Sat 0] [Sun 0]                          │
│  each day shows: block count, risk dot, proposal count if needed                   │
├──────────────────────────────────────────────┬──────────────────────────────────────┤
│ Day timeline                                 │ Right rail                           │
│                                              │                                      │
│ Wed Apr 17                                   │ Default state:                       │
│ 08:00 ────────────────────────────────────   │ - Unscheduled Queue                  │
│ 09:00 ──┌ Task A ────────────────┐           │ - AI Proposals                       │
│ 10:00 ──└────────────────────────┘           │ - Risks / Conflicts                  │
│ 11:00 ──┌ Task B ──────┐                     │                                      │
│ 12:00 ──└──────────────┘                     │ Selected block state:                │
│ 13:00 ────────────────────────────────────   │ - full task summary                  │
│ 14:00 ──┌ Task C overlap ───────┐            │ - schedule editor                    │
│ 15:00 ──└───────────────────────┘            │ - Open Task / Open Work              │
│                                              │ - proposal / risk context            │
└──────────────────────────────────────────────┴──────────────────────────────────────┘
```

---

## Mobile layout

```text
┌──────────────────────────────┐
│ Schedule                     │
│ [Today] [Day ▾]              │
│ Summary chips                │
├──────────────────────────────┤
│ Week strip                   │
│ [Mon] [Tue] [Wed⚠] [Thu] ... │
├──────────────────────────────┤
│ Section tabs                 │
│ [Timeline] [Queue] [AI]      │
│ [Risks]                      │
├──────────────────────────────┤
│ Day agenda / timeline        │
│ 09:00  Task A                │
│ 11:00  Task B                │
│ 14:00  Task C                │
└──────────────────────────────┘
```

### Mobile rules

- keep one primary panel visible at a time
- use agenda-style timeline instead of dense grid math
- open details in accordion or bottom sheet
- keep risks and proposals reachable without scrolling through all scheduled blocks

---

## Information hierarchy

### 1) Header and range controls

Purpose: orient the user before they inspect any individual block.

Should show:

- page title
- selected date / range
- summary chips (`scheduled`, `queue`, `proposals`, `risks`)
- quick jumps (`Today`, `Tomorrow`, `This Week`)
- optional view toggle, but default to `Day`

### 2) Week strip

Purpose: provide lightweight temporal navigation without turning the page into a heavy calendar.

Each day cell should show:

- day label
- date number
- scheduled block count
- risk indicator when needed
- optional proposal count

Interactions:

- click day to switch the main timeline
- highlight today
- highlight selected day more strongly than surrounding days

### 3) Day timeline

Purpose: make the committed plan legible as time, not as a card list.

Structure:

- left column: hour markers
- right canvas: blocks placed by scheduled time
- empty time remains visible so users can see capacity

Each block in collapsed state shows only:

- title
- start → end
- priority
- owner
- conflict / approval / overdue badge if applicable

Do **not** show by default:

- full metadata pill row
- long action-required text
- inline editor form
- task/work links

### 4) Inspector / detail surface

Purpose: preserve timeline clarity while still enabling edits.

When a block is selected, show:

- task title and key status
- full metadata
- `Open Task`
- `Open Work`
- schedule editor
- related proposal / risk context
- next recommended action

Desktop:

- prefer right-side inspector
- keep one selected item open at a time

Mobile:

- use accordion or bottom sheet

### 5) Secondary rails

Purpose: keep unscheduled work and exceptions available without mixing them into the timeline itself.

Keep as separate sections:

- `Unscheduled Queue`
- `AI Proposals`
- `Risks / Conflicts`

Do not interleave them with scheduled blocks.

---

## Timeline behavior

### Default state

- open on `Today`
- show only collapsed blocks
- no detail panel open unless the user selects a block

### Selection

- clicking a block selects it
- selected block gets stronger border / background treatment
- selection opens inspector on desktop or accordion/sheet on mobile

### Conflict display

Conflicts should be visible in two places:

1. **Week strip**
   - affected day gets a warning dot or count
2. **Day timeline**
   - overlapping blocks offset into lanes
   - severe conflicts get red border / badge

Conflict examples to surface:

- overlapping scheduled windows
- overdue block still occupying planned time
- waiting for approval/input while blocking the plan

### Capacity readability

The timeline should make free time obvious.

That means:

- preserve empty vertical space between blocks
- do not compress the day into a dense list with no temporal gaps
- later enhancement can add work-hours window and collapsed off-hours

---

## MVP implementation path

### Phase 1 — recommended next implementation

Build:

- selected-day state
- week strip
- vertical day timeline
- block selection state
- right-side inspector
- collapsed default block UI

### Phase 2 — after the structure is working

Enhance with:

- overlap lanes
- drag / resize interactions
- quick reschedule presets
- multi-owner / multi-agent lanes if needed

### Phase 3 — optional later expansion

- full week grid
- richer calendar navigation
- drag between days

---

## Design rules

- the page should read as `plan first, detail second`
- time position matters more than metadata density
- risks and conflicts should interrupt visually before low-priority detail does
- edits should happen beside the timeline, not inside every block by default
- `Schedule` should feel different from both `Task Page` and `Work Page`

---

## Recommended implementation decision

For this repo and product direction, the best next UI is:

**`Week strip + selected-day vertical timeline + right-side inspector`**

This is the clearest path to a real planning surface without overbuilding a generic calendar system.
