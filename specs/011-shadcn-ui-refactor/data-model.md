# Data Model: Shadcn UI Refactor

This feature does not introduce persisted application data. The model below defines planning and governance records used to execute and verify the UI consolidation.

## UIComponentInventoryItem

Represents one active frontend UI component, exported variant, or page/component import that may participate in the foundation consolidation.

**Fields**:

- `name`: Component, helper, or exported symbol name.
- `filePath`: Project-relative source path.
- `exportType`: Default export, named export, type export, constant helper, or CSS-class helper.
- `consumers`: Project-relative files importing or referencing the item.
- `category`: Foundational primitive, Chrona domain wrapper, page composition, test-only utility, or removal candidate.
- `duplicatesFoundation`: Whether the item duplicates a shared primitive capability.
- `replacementTarget`: Shared primitive or approved wrapper that replaces it.
- `notes`: Required rationale for any item not removed.

**Validation Rules**:

- Every active component in `apps/web/src/components/ui` must have one inventory item.
- Every removed duplicate must have zero active source consumers after migration.
- Every retained wrapper must include a product/domain rationale.

## ComponentClassification

Represents the decision category assigned to an inventory item.

**Values**:

- `shared-foundation`: Standard primitive owned by the shared UI foundation.
- `chrona-wrapper`: Thin product or brand wrapper around shared primitives.
- `page-composition`: Composition that belongs to one feature/page and is not reusable foundation.
- `remove`: Duplicate or obsolete item to delete.

**Validation Rules**:

- `remove` items cannot keep compatibility aliases.
- `chrona-wrapper` items cannot duplicate generic primitive APIs without domain meaning.
- `shared-foundation` items must be the canonical import target for basic controls.

## ReplacementDecision

Represents how one old custom primitive or wrapper is migrated.

**Fields**:

- `sourceName`: Existing symbol or file being replaced.
- `sourcePath`: Existing project-relative file path.
- `targetName`: New shared primitive or wrapper symbol.
- `targetPath`: New project-relative import path.
- `scope`: List of affected source areas or pages.
- `behaviorPreserved`: Confirmation that user-visible behavior remains unchanged.
- `requiresVisualCheck`: Whether browser evidence is required for affected screens.

**Validation Rules**:

- Every duplicate foundational component must have one replacement decision.
- Replacement decisions must not point to removed legacy paths.
- Behavior changes must be explicitly documented; otherwise behavior is preserved.

## ChronaWrapper

Represents an allowed lightweight wrapper that remains after consolidation.

**Fields**:

- `name`: Wrapper symbol name.
- `ownerArea`: Feature or product area owning the wrapper.
- `foundationDependencies`: Shared primitives it composes.
- `domainPurpose`: Product meaning that justifies the wrapper.
- `allowedVariants`: Small set of domain variants, if needed.

**Validation Rules**:

- Wrapper must compose shared primitives instead of rebuilding base behavior.
- Wrapper must not expose a generic API that competes with the shared primitive.
- Wrapper must live near the owning product area unless it is truly shared domain UI.

## VerificationEvidence

Represents required proof that the UI refactor did not regress product behavior.

**Fields**:

- `screenOrFlow`: Affected screen, component, or flow.
- `preEditEvidence`: Browser observation and screenshot references captured before implementation.
- `postEditEvidence`: Browser verification and screenshot references captured after implementation.
- `viewports`: Desktop `1440x900`, tablet `1024x768`, and mobile `390x844`.
- `modes`: Light and dark mode coverage where supported.
- `automatedChecks`: Typecheck, lint, test, and e2e commands run.
- `result`: Pass, fail, or blocked with reason.

**Validation Rules**:

- Frontend visual or interaction changes must include pre-edit and post-edit browser evidence.
- Mobile evidence must confirm no horizontal scrolling.
- Failures must be resolved before the feature is accepted.

## DuplicatePrimitiveGuardrail

Represents documentation or automated review mechanism that prevents future duplicate foundational components.

**Fields**:

- `ruleName`: Guardrail name.
- `coveredPatterns`: Component names, imports, or file patterns that indicate duplicate primitives.
- `expectedAction`: Use shared primitive, create domain wrapper with rationale, or reject change.
- `enforcementMethod`: Documentation, scripted check, lint rule, or review checklist.

**Validation Rules**:

- Guardrail must explicitly cover button, badge, card, field/input, select, textarea, and similar foundational controls.
- Guardrail must be discoverable by future AI agents through `AGENTS.md`.
- Guardrail must provide a repeatable way to surface violations before acceptance.
