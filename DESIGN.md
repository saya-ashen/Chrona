---
name: Chrona
description: Local-first schedule and AI work control plane for inspectable execution.
colors:
  background: "oklch(1 0 0)"
  foreground: "oklch(0.21 0.02 264)"
  canvas: "oklch(0.985 0.004 264)"
  card: "oklch(1 0 0)"
  primary: "oklch(0.54 0.21 277)"
  primary-soft: "oklch(0.96 0.025 277)"
  primary-border: "oklch(0.82 0.1 277)"
  secondary: "oklch(0.968 0.005 264)"
  muted: "oklch(0.968 0.005 264)"
  muted-foreground: "oklch(0.55 0.02 264)"
  border: "oklch(0.92 0.006 264)"
  success: "oklch(0.62 0.16 152)"
  warning: "oklch(0.72 0.16 75)"
  info: "oklch(0.6 0.14 235)"
  destructive: "oklch(0.58 0.235 27)"
typography:
  display:
    fontFamily: "Inter Variable, Noto Sans SC Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.35rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Inter Variable, Noto Sans SC Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter Variable, Noto Sans SC Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.5
  body:
    fontFamily: "Inter Variable, Noto Sans SC Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter Variable, Noto Sans SC Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.2
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  card: "22px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "oklch(0.99 0.005 277)"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 10px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "oklch(0.28 0.025 264)"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 10px"
  badge-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "oklch(0.28 0.025 264)"
    rounded: "999px"
    height: "20px"
    padding: "2px 8px"
  input-default:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "4px 10px"
---

# Design System: Chrona

## 1. Overview

**Creative North Star: "Control Room Ledger"**

Chrona's visual system is a restrained product control surface: cool graphite neutrals carry the interface, while violet appears only where command, selection, or active execution state needs attention. The design should feel calm, precise, and accountable, matching the product mandate that scheduled AI work stays inspectable rather than hidden behind chat.

The system uses familiar app-shell patterns, dense panels, explicit status chips, and steady borders to make work in motion easy to audit. Decoration is subordinate to state. Surfaces can be compact, but the current task, active node, blocker, review state, and next action must stay visually obvious.

It rejects generic SaaS AI gloss, vague purple gradients, hero metrics, decorative dashboards, and chat-first layouts. If a screen looks like an AI marketing dashboard instead of an operations surface for work, it is off-system.

**Key Characteristics:**
- Cool graphite canvas with white cards and low-chroma slate borders.
- Violet primary used sparingly for command, current selection, and active state.
- Inter-led typography with compact product hierarchy and no display-font theatrics.
- Flat-by-default surfaces with light structural shadow only where hierarchy needs help.
- Badges, focus rings, and explicit labels carry state without relying on color alone.

## 2. Colors

The palette is neutral-first Cool Graphite: a bright white working surface, a faint slate canvas, and one violet command signal reserved for action and selection.

### Primary
- **Violet Signal** (`primary`): Used for primary buttons, active navigation, focus rings, current schedule indicators, and selected execution state. It must remain rare enough to read as command rather than decoration.
- **Violet Field** (`primary-soft`): Used for active nav backgrounds, selected states, and quiet emphasis surfaces where full primary would overpower dense UI.
- **Violet Rail** (`primary-border`): Used for selected calendar events, active execution borders, and stateful outlines.

### Secondary
- **Slate Control** (`secondary`): Used for secondary buttons, neutral chips, soft panels, and inactive controls that still need affordance.
- **Slate Muted** (`muted`): Used for hover backgrounds, quiet separators, and neutral control fills.

### Tertiary
- **Green Complete** (`success`): Completion and successful provider checks.
- **Amber Review** (`warning`): Waiting, approvals, conflicts, and recoverable caution.
- **Blue Context** (`info`): Informational state that should not compete with primary action.
- **Red Stop** (`destructive`): Blocking failures, destructive actions, and unrecoverable error state.

### Neutral
- **White Workbench** (`background`, `card`): Primary reading and interaction surface.
- **Graphite Ink** (`foreground`): Body text and high-priority labels.
- **Cool Canvas** (`canvas`): App shell background behind panels and cards.
- **Slate Caption** (`muted-foreground`): Secondary labels and helper text. Do not use for body paragraphs on tinted surfaces when contrast is close.
- **Hairline Border** (`border`): Panel edges, dividers, input strokes, and navigation separation.

### Named Rules

**The One Signal Rule.** Violet is for primary action, current selection, focus, and active execution state only. Do not spend it on decoration.

**The State Vocabulary Rule.** Success, warning, info, and destructive colors must communicate state with text or icon support. Color alone is forbidden.

## 3. Typography

**Display Font:** Inter Variable, with Noto Sans SC Variable and system sans fallbacks.
**Body Font:** Inter Variable, with Noto Sans SC Variable and system sans fallbacks.
**Label/Mono Font:** No committed mono token. Use the sans stack unless the surface is truly code or log output.

**Character:** Chrona uses one product sans family for all primary UI. Weight, density, and tracking create hierarchy; dramatic type contrast is not part of the product identity.

### Hierarchy
- **Display** (600, `1.35rem`, tight tracking): App brand wordmark and highest-density page titles, not marketing hero copy.
- **Headline** (600, `1.125rem`, tight tracking): Work page titles, section heads, and active task names.
- **Title** (500, `1rem`): Card titles, panel headers, and grouped controls.
- **Body** (400, `0.875rem`, `1.5` line-height): Default explanatory text, descriptions, and row content. Keep long prose to 65-75ch.
- **Label** (500, `0.75rem`, normal case): Metadata, captions, chip labels, and compact nav text. Uppercase is not a default treatment.

### Named Rules

**The Product Scale Rule.** Use fixed rem sizes for app UI. Fluid display scales belong to marketing surfaces, not Chrona work surfaces.

**The Label Honesty Rule.** Labels describe state and action directly. Do not use vague AI-product language where an execution status, node name, or recovery action exists.

## 4. Elevation

Chrona is flat by default and uses tonal layering, borders, and a few low shadows to separate operational layers. Shadows are structural, not decorative: header cards and floating controls may lift slightly, while routine cards and inputs stay close to the canvas.

### Shadow Vocabulary
- **Card Lift** (`0 12px 30px rgba(15,23,42,0.05)`): Used on prominent header cards and work summary panels that need to stay visually above the workspace.
- **Calendar Event Lift** (`0 10px 22px rgb(15 23 42 / 0.14), 0 2px 5px rgb(15 23 42 / 0.12)`): Used only for scheduled blocks where depth helps drag, selection, and overlap perception.
- **Primitive Shadow** (`shadow-xs`): Used by shadcn buttons, inputs, and cards for a small tactile edge.

### Named Rules

**The Flat-Until-State Rule.** Surfaces rest flat. Lift appears for active work, hover affordance, drag targets, or layered navigation.

## 5. Components

Chrona components are restrained and inspectable: shadcn primitives form the foundation, and product wrappers exist only when they express Chrona domain meaning.

### Buttons
- **Shape:** Medium rounded rectangle (`8px`, with smaller sizes clamped to `8-10px`).
- **Primary:** Violet Signal fill with near-white text, compact `36px` height, `10px` horizontal padding, and medium text.
- **Hover / Focus:** Primary hover darkens through opacity; focus uses a `3px` violet ring with visible border shift.
- **Secondary / Ghost / Destructive:** Secondary uses Slate Control, ghost is transparent until hover, destructive uses red tint rather than a fully saturated red fill unless the action is dangerous.

### Chips
- **Style:** Compact `20px` pills with `999px` radius, medium `12px` text, and semantic tint fills.
- **State:** Chips must name the status they represent. Success, warning, info, destructive, outline, and secondary variants are allowed; decorative chips are not.

### Cards / Containers
- **Corner Style:** Standard cards use `10-14px`; signature work headers can use larger `22px` corners when the surface needs prominence.
- **Background:** Cards use White Workbench on Cool Canvas; sidebars use their own slight neutral layer.
- **Shadow Strategy:** Default shadcn cards use primitive lift and a thin foreground ring. Prominent work headers may use Card Lift.
- **Border:** Borders are thin and low-chroma. Side-stripe accents are forbidden.
- **Internal Padding:** Common card padding is `16-24px`; compact cards use `16px`.

### Inputs / Fields
- **Style:** Transparent background, `36px` height, `8px` radius, Hairline Border stroke, and `10px` horizontal padding.
- **Focus:** Violet border plus `3px` ring at 50% ring opacity. This must remain visible in light and dark modes.
- **Error / Disabled:** Error uses destructive border and ring tint. Disabled controls reduce opacity and remove pointer interaction.

### Navigation
- **Style, typography, default/hover/active states, mobile treatment.** Desktop navigation uses a fixed left sidebar with compact icon + label rows, `8px` row radius, muted inactive labels, and Violet Field active backgrounds. Mobile uses bottom navigation with icon above `11px` labels and active state expressed by Violet Signal text.

### Work Header Card

The work header is a signature Chrona component. It combines task title, execution status, sync badge, summary, and route actions in one rounded surface so users can identify current task and execution context before reading details.

## 6. Do's and Don'ts

### Do:
- **Do** keep Chrona product UI restrained: Cool Canvas, White Workbench cards, Hairline Border, and rare Violet Signal actions.
- **Do** make current task, active node, blocked or review state, and primary action visually obvious before secondary detail.
- **Do** use shadcn primitives for buttons, badges, cards, inputs, drawers, tabs, tooltips, separators, skeletons, and alerts before creating custom foundations.
- **Do** support WCAG AA contrast, visible focus states, keyboard access, reduced motion, and non-color state indicators.
- **Do** use exact action labels: "Start execution", "Save changes", "Review proposal", "Open schedule".

### Don't:
- **Don't** use generic SaaS AI gloss: vague purple gradients, hero metrics, decorative dashboards, inflated claims, or motion that does not explain state.
- **Don't** make Chrona feel chat-first. Assistant surfaces support the workflow; schedule, task, plan, and run state stay primary.
- **Don't** use gradient text, glassmorphism as default, side-stripe borders, identical decorative card grids, or tiny uppercase tracked eyebrows as scaffolding.
- **Don't** spend Violet Signal on inactive decoration. If everything is violet, nothing is active.
- **Don't** hide blockers, approvals, stale sync, or failed execution behind generic error copy.
