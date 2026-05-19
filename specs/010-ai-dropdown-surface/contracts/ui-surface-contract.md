# Contract: AI Dropdown UI Surface

## Purpose

Defines user-visible behavior for the single global Chrona AI dropdown.

## Trigger

- Lives in the global top bar.
- Shows emoji status icon.
- Shows the active page's highest-priority summary or a rotating set of summaries.
- Prioritizes `error`, `blocked`, and `conflict` before lower-severity states.
- Opens a dropdown menu, not a sidebar, modal chat workspace, or full preview surface.

## Dropdown Content

- Page summary.
- Current highest-priority state.
- Backend/page-state supplied quick actions.
- Short current-page input.
- Brief recent proposal entries.

## Forbidden UI Behavior

- No complex diff rendering.
- No direct confirm/apply controls for mutating proposals.
- No generic chat sidebar fallback.
- No hardcoded quick-action list in front-end presentation components.

## Required States

- Loading surface state.
- Ready with summaries and actions.
- Ready with no valid actions.
- Disabled action with visible disabled reason.
- Unsupported page.
- Stale context.
- Error loading or running assistant action.

## Responsive Requirements

- Desktop `1440x900`: trigger and dropdown integrate with existing top bar controls.
- Tablet `1024x768`: dropdown fits without covering essential navigation unexpectedly.
- Mobile `390x844`: trigger remains reachable, dropdown remains usable, and page has no horizontal scrolling.
