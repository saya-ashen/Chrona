# Research: Shadcn UI Refactor

## Decision: Use shadcn/ui primitives as the only foundation for common controls

**Rationale**: The current UI folder contains custom foundational primitives (`buttonVariants`, `StatusBadge`, `SurfaceCard`, and field class helpers) that overlap standard button, badge, card, input, textarea, select, label, and form-field capabilities. Making shadcn primitives the foundation removes duplicate styling and behavior ownership while keeping Chrona free to compose product-specific surfaces.

**Alternatives considered**: Keep current custom primitives and restyle them to match shadcn. Rejected because it preserves two foundations and does not reduce maintenance cost. Build a new Chrona design-system layer. Rejected because it recreates the same duplication under a new name.

## Decision: Allow Chrona wrappers only when they carry product semantics

**Rationale**: Some existing components may represent domain meaning, such as task state, blocked/review status, or schedule conflict severity. These should not be deleted solely because they render a badge or card; they should become thin wrappers around shared primitives and document their domain purpose.

**Alternatives considered**: Ban all wrappers. Rejected because it would push domain meaning and repeated product composition into pages. Keep visual wrappers like `SurfaceCard` as generic aliases. Rejected because it creates duplicate generic primitives.

## Decision: Remove legacy compatibility exports during the refactor

**Rationale**: User explicitly requested complete replacement with no old compatibility or old code. Keeping aliases such as legacy `buttonVariants` paths would make future imports ambiguous and allow AI agents to keep using removed primitives.

**Alternatives considered**: Add deprecated aliases and migrate gradually. Rejected because it conflicts with the requested one-time replacement and long-term maintenance goal.

## Decision: Treat UI inventory as a required planning artifact before implementation

**Rationale**: Replacement must be safe across page components and tests. The inventory should capture import paths, consumers, classification, replacement target, and whether a wrapper remains. This gives tasks a concrete migration list and measurable completion criteria.

**Alternatives considered**: Replace files opportunistically while fixing compiler errors. Rejected because it risks missing visual-only duplications and page-specific wrappers not caught by types.

## Decision: Use documentation plus repeatable checks to prevent regression

**Rationale**: The request includes preventing future AI mistakes. Updating `AGENTS.md` and adding a repeatable inventory/check step gives future agents explicit instructions and reviewers a way to detect new duplicate primitives.

**Alternatives considered**: Rely on code review only. Rejected because the failure mode specifically involves automated agents repeating old patterns. Add a heavy custom linter immediately. Deferred unless inventory shows the simple scripted check is insufficient.

## Decision: Keep backend APIs unchanged

**Rationale**: This feature is UI foundation consolidation. No user scenario requires changed data contracts or server behavior, and the constitution blocks backend changes for visual polish without justification.

**Alternatives considered**: Introduce backend-driven UI metadata for statuses or cards. Rejected as unrelated complexity.

## Decision: Verification must include browser evidence and existing checks

**Rationale**: The refactor touches visual and interaction surfaces. Constitution requires before and after UI changes, viewport verification, and automated quality commands.

**Alternatives considered**: Trust component tests only. Rejected because dark-mode, responsive, and visual hierarchy regressions often pass unit tests.
