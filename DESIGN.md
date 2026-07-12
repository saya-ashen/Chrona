---
version: beta
name: Chrona Operational Calm
description: A calm, precise visual system for Chrona's schedule, task execution, approval, and AI-assisted work surfaces. Warm brand accents remain recognizable, while high-frequency workspaces use neutral, high-contrast canvases and stable semantic state colors.

principles:
  - "Operational clarity before decoration"
  - "Warm brand, neutral workspace"
  - "State is never communicated by color alone"
  - "One dominant action per region"
  - "Shape communicates role, not personality alone"
  - "Light and dark themes share one brand language"

colors:
  light:
    background: "#f7f7f5"
    canvas: "#ffffff"
    card: "#ffffff"
    popover: "#ffffff"
    foreground: "#18181b"
    body: "#3f3f46"
    muted: "#71717a"
    muted-soft: "#a1a1aa"
    border: "#dededb"
    border-strong: "#c9c9c4"
    surface-soft: "#f1f1ee"
    surface-strong: "#e8e8e3"
    primary: "#6257c7"
    primary-hover: "#554ab8"
    primary-soft: "#eeecff"
    primary-soft-hover: "#e3e0ff"
    primary-border: "#c9c3f5"
    on-primary: "#ffffff"
    accent: "#d9673f"
    accent-soft: "#fff0e9"
    sidebar: "#f1f1ee"
    sidebar-active: "#e3e0ff"
  dark:
    background: "#111216"
    canvas: "#15161b"
    card: "#1b1c22"
    popover: "#202127"
    foreground: "#f4f4f5"
    body: "#d4d4d8"
    muted: "#a1a1aa"
    muted-soft: "#71717a"
    border: "#303138"
    border-strong: "#454650"
    surface-soft: "#202127"
    surface-strong: "#292a31"
    primary: "#9b91ee"
    primary-hover: "#aca4f4"
    primary-soft: "#282442"
    primary-soft-hover: "#332e55"
    primary-border: "#565087"
    on-primary: "#17151f"
    accent: "#f09a72"
    accent-soft: "#39251f"
    sidebar: "#17181d"
    sidebar-active: "#2b2745"
  semantic:
    success: "#258451"
    success-dark: "#52b87b"
    warning: "#b76a00"
    warning-dark: "#e8a23a"
    info: "#2970a6"
    info-dark: "#62a7d8"
    destructive: "#cf3f4f"
    destructive-dark: "#ee6674"
  brand:
    violet: "#6257c7"
    peach: "#d9673f"
    pink: "#c84d79"
    teal: "#28756d"
    ochre: "#a96f16"
    lavender: "#9b91ee"

shape:
  radius:
    control-sm: "4px"
    control: "6px"
    card: "8px"
    panel: "10px"
    overlay: "12px"
    pill: "999px"
  rules:
    - "Page canvases and timelines use 0-8px radius; they are work areas, not promotional cards."
    - "Cards use 8px. Major panels may use 10px. Dialogs and floating overlays may use 12px."
    - "Full pills are reserved for badges, compact filters, statuses, and icon-only circular controls."
    - "Do not nest rounded bordered surfaces when spacing or a divider can express the hierarchy."

spacing:
  unit: "4px"
  control-gap: "8px"
  content-gap: "12px"
  section-gap: "24px"
  page-padding-desktop: "24px"
  page-padding-tablet: "20px"
  page-padding-mobile: "12px"
  density:
    compact-row: "36px"
    default-row: "44px"
    comfortable-row: "52px"

typography:
  family: "Inter Variable, Noto Sans SC Variable, ui-sans-serif, system-ui"
  page-title: "24px/32px 600"
  section-title: "16px/24px 600"
  object-title: "14px/20px 600"
  body: "14px/20px 400"
  body-small: "13px/18px 400"
  label: "12px/16px 500"
  metadata: "12px/16px 400"
  rules:
    - "Use sentence case for controls and headings."
    - "Avoid tracked uppercase for instructions and frequently scanned labels."
    - "Truncate metadata before titles. Critical dates and task titles must remain identifiable."
    - "Chinese and Latin text share the same semantic size and weight tier."

elevation:
  base: "none"
  raised: "0 1px 2px rgb(0 0 0 / 0.06)"
  overlay: "0 12px 32px rgb(0 0 0 / 0.16)"
  rules:
    - "Use surface color and borders for permanent layout."
    - "Shadows are for floating overlays, menus, dialogs, and drag states."
    - "Never combine a heavy shadow, strong border, and saturated fill on the same routine object."

motion:
  fast: "120ms"
  default: "180ms"
  slow: "240ms"
  easing: "cubic-bezier(0.2, 0, 0, 1)"
  reduced-motion: "Remove transforms and reduce transitions to 1ms."
---

# Chrona Visual Design System

## 1. Product character

Chrona is an operational workspace for planning time, running tasks, reviewing AI-assisted work, and resolving blocked states. It should feel calm and approachable without looking decorative or passive.

The visual character is **operational calm**:

- precise enough for execution monitoring;
- warm enough for daily personal use;
- quiet enough for long sessions;
- explicit enough that current state and next action are never ambiguous.

Chrona is not a marketing site. Large decorative gradients, clay illustrations, oversized display type, and saturated feature-card grids are not part of the application language.

## 2. Brand and workspace layers

Chrona uses two coordinated layers.

### Brand layer

Use brand color and warmer treatment for:

- logo and onboarding;
- AI source and validation markers;
- empty states;
- lightweight suggestions;
- selected navigation and primary actions;
- small moments of product identity.

Brand treatment must remain subordinate to task state. A blocked or failed task always reads as blocked or failed before it reads as “Chrona purple.”

### Workspace layer

Use neutral surfaces for:

- schedules and timelines;
- task lists;
- task execution workspaces;
- action and approval queues;
- settings;
- graphs and result viewers.

Workspace surfaces prioritize contrast, density, alignment, and stable state semantics. Do not tint every container with a brand color.

## 3. Theme contract

Light and dark themes are two luminance expressions of one system, not separate identities.

- Violet is the shared primary brand hue in both themes.
- Peach is a secondary accent; it is not the warning color.
- Navigation selection, focus, and primary action use the violet family but differ by shape and emphasis.
- Semantic states keep their meaning across themes.
- Dark mode uses neutral graphite surfaces. Avoid blue-purple tinting every dark surface.
- Background decoration must not reduce workspace contrast. High-frequency pages use a flat background; decorative gradients are limited to onboarding and empty states.

## 4. Surface hierarchy

Only four permanent surface levels exist:

1. **App background** — quiet neutral surrounding the workspace.
2. **Canvas** — main working region: schedule, graph, result, editor.
3. **Card** — repeatable or independently actionable object.
4. **Overlay** — dialog, menu, popover, drawer.

Rules:

- Prefer a divider or spacing over another card.
- A card inside a card needs a functional reason: selection, drag, independent action, or expandable content.
- Toolbars belong to their canvas and should not look like separate promotional cards.
- Empty space must support scan paths, not merely increase softness.

## 5. Shape language

Shape communicates role:

- rectangular canvases communicate stable work areas;
- lightly rounded cards communicate independent objects;
- pills communicate compact state or filtering;
- circles communicate icon-only actions or status dots.

Avoid “everything is a pill.” Text buttons with more than two words normally use the control radius, not a capsule.

## 6. Color and state semantics

State is expressed with four channels where possible:

1. label;
2. icon;
3. color;
4. placement or border emphasis.

Canonical meanings:

| State                | Color family                      | Required copy distinction              |
| -------------------- | --------------------------------- | -------------------------------------- |
| Selected/current     | Violet                            | Current or selected label where needed |
| Running              | Blue/info                         | Running                                |
| Waiting for input    | Amber/warning                     | Waiting for input                      |
| Waiting for approval | Violet with approval icon         | Waiting for approval                   |
| Blocked              | Red/destructive                   | Blocked + next action                  |
| Failed               | Red/destructive                   | Failed + recovery action               |
| Completed            | Green/success                     | Completed                              |
| Cancelled            | Neutral gray                      | Cancelled                              |
| AI-authored          | Soft violet + source marker       | AI source/validation                   |
| AI-editable          | Soft peach/violet + review marker | Pending/review/revert                  |

Never use peach as a generic warning if it is also acting as brand decoration nearby.

## 7. Actions and selection

Each region has one visually dominant next action.

- **Primary action:** solid primary fill.
- **Secondary action:** neutral outline or soft surface.
- **Tertiary action:** ghost/text.
- **Destructive action:** destructive treatment, only when the action itself is destructive.
- **Selected state:** soft primary fill plus foreground/border change; it must not look identical to a primary button.

Global creation and page-specific next action must not compete at the same visual strength. Context decides which remains solid.

## 8. Schedule rules

Schedule is Chrona's highest-frequency page. Its timeline is a work canvas, not a card showcase.

- Timeline receives the majority of desktop width.
- Queue/attention panels adapt to their content and may collapse.
- The current time, current event, conflicts, and next action must be obvious.
- Routine grid lines are quiet; current time and conflicts are stronger.
- Event color communicates state before priority. Priority remains a label or compact marker.
- “Needs attention” uses semantic warning/destructive treatment on the object, not only on its count.
- Date remains complete and identifiable at every breakpoint.
- Mobile task events may use two lines. Do not truncate the only identifying text to a few characters.
- Mobile removes low-value instructions before truncating dates or task names.

## 9. Dashboard rules

Dashboard is Chrona's operational home, not an executive report or event log.

- Current actionable work appears before summaries, AI-authored content, and history.
- When attention is required, the task identity, concise reason, state, and next action remain above the fold at every breakpoint.
- Running work and the next scheduled work follow attention; completed work and recent activity are secondary.
- The page header stays compact. Status counts may summarize the page but must not repeat the same state across multiple large cards.
- AI summaries supplement deterministic state and never outrank blocked, failed, waiting, running, or upcoming work.
- Recent activity aggregates or flattens routine events. It must not resemble a second audit log inside the dashboard.
- Below `xl`, content order remains operational: attention, running, upcoming, completed, then history and AI summary.

## 10. Page frame and width modes

Every primary route uses one shared page coordinate system. The application shell owns the full-bleed page background and safe-area padding; the page frame owns content width, centering, vertical scrolling, and stable page-header alignment.

| Mode        | Maximum width | Pages                           | Purpose                                                                          |
| ----------- | ------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| `workspace` | `1600px`      | Schedule, Tasks, Task Workspace | Timelines, tables, graphs, and split operational workspaces use available width. |
| `overview`  | `1280px`      | Dashboard, Action Center        | Scannable cards and queues remain bounded on wide displays.                      |
| `focused`   | `1120px`      | Settings and form-heavy pages   | Configuration and reading surfaces keep controlled line length.                  |

Rules:

- All modes are `width: 100%` below their maximum.
- Page headers share the same left edge as their page body and never center independently.
- A focused body is intentionally narrow; do not stretch form fields to fill a wide monitor.
- The shell provides one continuous full-width background and horizontal padding once. Route roots must not add a second page-sized padding layer.
- Maximum width constrains content only. It must never create a bounded background rectangle or a hard color seam at `1120px`, `1280px`, or `1600px`.
- PageFrame is visually transparent and shares one scroll contract across modes. Width differences must be explained only by content mode.
- At mobile widths all modes become full width and preserve the same safe-area padding.

## 11. Responsive behavior

Validate at 1440×900, 1024×768, and 390×844.

### Desktop

- Use available width for primary work.
- Secondary panels should not reserve large empty columns.
- Keep the primary action and current state above the fold.

### Tablet

- Reduce gaps before shrinking core content.
- Secondary panels may become drawers or stacked regions.
- Keep controls reachable without crowding titles.

### Mobile

- No horizontal page scrolling.
- Use complete compact date formats such as `Jul 12, Sun`.
- Keep titles identifiable; allow two lines before truncation.
- Bottom navigation remains stable.
- Hide redundant labels and instructions first.
- Preserve current task, blocked/review state, and next action.

## 12. Accessibility

- Body and essential secondary text target WCAG AA contrast.
- Muted text is not used for required instructions, timestamps needed for decisions, or error recovery.
- Focus rings remain visible in both themes.
- Color is never the sole state indicator.
- Touch targets are at least 40×40px; primary mobile actions target 44px height.
- Reduced-motion preferences disable decorative transforms and animated graph movement.

## 13. Implementation rules

- `DESIGN.md` is the source of truth for project-wide visual decisions.
- Global theme values are implemented through semantic CSS variables in `apps/web/src/styles/globals.css`.
- Feature code uses semantic utilities (`bg-background`, `bg-card`, `text-muted-foreground`, `border-border`, state tokens) rather than literal hex values.
- shadcn primitives remain the control foundation.
- Product wrappers add domain meaning, not alternate primitive styles.
- Do not introduce a second radius, shadow, color, or spacing convention beside this system.
- When a page needs an exception, document the product reason here before adding a new global token.

## 14. Review checklist

Before accepting a visual change, verify:

- Is the current state obvious without reading every label?
- Is one next action dominant?
- Does the primary workspace receive the most space?
- Could a divider replace a nested card?
- Does each pill represent state, filter, or compact metadata?
- Are light and dark themes recognizably the same product?
- Are blocked, waiting for input, waiting for approval, failed, completed, and cancelled distinguishable?
- At 390px, are date and task identity still readable?
- Does the page remain usable for a multi-hour session?
