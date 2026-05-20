# UI Component Governance Contract

This contract defines the accepted component ownership model after the shadcn UI refactor. It is a repository governance contract, not a backend API contract.

## Canonical Foundation Rule

Basic UI controls must use the shared shadcn foundation in `apps/web/src/components/ui`.

Covered controls include:

- Button-like controls and variant helpers
- Badge/status-pill visuals
- Card/surface containers
- Field, label, input, textarea, and select controls
- Dialog, dropdown, tabs, tooltip, separator, skeleton, alert, and related primitives when present

## Import Rule

Page and feature components must import shared primitives from the canonical UI path or import a documented Chrona wrapper with domain meaning.

Disallowed imports after migration:

- Removed legacy primitive files
- Compatibility aliases that forward old names to new primitives
- Page-local generic button, badge, card, or field implementations
- New generic `*Variants` helpers that duplicate an existing shared primitive variant API

## Wrapper Rule

Chrona wrappers are allowed only when all conditions are true:

- The wrapper adds product/domain meaning or repeated product composition.
- The wrapper composes shared primitives rather than rebuilding base behavior.
- The wrapper name communicates domain meaning, not generic foundation ownership.
- The wrapper has a short rationale in inventory or nearby documentation.

Examples of allowed wrapper intent:

- Task lifecycle status display
- Schedule conflict severity display
- Work execution result state display
- Product-specific panel composition used repeatedly in one domain area

Examples of disallowed wrapper intent:

- A generic replacement for Button
- A generic replacement for Badge
- A generic replacement for Card
- A generic field class helper competing with input, select, textarea, label, or form primitives

## Deletion Rule

When a duplicate primitive is replaced:

- Delete old source files when no approved wrapper remains.
- Delete stale exports.
- Delete old tests that only verify removed implementation details.
- Update tests to verify preserved product behavior instead.
- Do not keep deprecated aliases or compatibility exports.

## Verification Rule

Each migration batch must prove:

- No active source imports removed legacy component names or paths.
- Typecheck passes.
- Lint passes.
- Existing tests pass.
- Browser verification covers affected screens and required viewports.
- Dark mode and mobile no-horizontal-scroll checks pass.

## Future AI Guardrail

Future AI agents must follow this decision order before adding UI components:

1. Use an existing shared primitive from `apps/web/src/components/ui`.
2. If product meaning is needed, create or reuse a thin domain wrapper that composes shared primitives.
3. If neither is enough, document why the shared foundation cannot cover the case before adding a new primitive.
4. Never introduce a custom foundational component when a shadcn primitive already covers the role.
