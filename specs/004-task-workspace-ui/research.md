# Research: Task Workspace UI Functionality

## Decision: Use the existing Chrona task workspace stack

**Rationale**: The page already lives in the Vite React task workspace and the previous component-parity work established the relevant task workspace, graph, query, and overview areas. Existing React 19, React Router 7, Hono, shared contracts, Prisma-backed data, Vitest, Testing Library, and Playwright cover the required UI action wiring and verification.

**Alternatives considered**: Adding a new UI framework or runtime was rejected because the project is not a Next.js app and the feature targets one existing SPA page. Adding a state-management or UI dependency was rejected because the problem is dead UI/action wiring, not missing primitives.

## Decision: Make a workspace action inventory the source of truth

**Rationale**: The user request is explicitly to find UI components with no actual effect, add real behavior where appropriate, and clean up useless components. An action inventory turns this into testable work: each interactive component is classified as retained-working, retained-needs-wiring, intentionally disabled, or removed.

**Alternatives considered**: Fixing controls opportunistically during implementation was rejected because it can leave hidden dead controls behind. A visual-only cleanup was rejected because the acceptance criteria require real behavior.

## Decision: Reuse existing task data and action paths first

**Rationale**: Current task, plan, run, artifact, approval, and activity data should already support many workspace interactions from the previous component-parity feature. Reusing them reduces risk and avoids duplicate read models. New server APIs should be added only when a retained action needs a real state change that current contracts cannot perform.

**Alternatives considered**: Creating a new task workspace API surface up front was rejected because it would duplicate existing behavior and increase integration risk. Avoiding backend changes entirely was rejected because the user explicitly allows API changes where needed to make controls functional.

## Decision: Remove future-only controls instead of shipping disabled placeholders

**Rationale**: A disabled control is useful only when it teaches the user what condition makes the action available. Future-only or speculative controls without current workflow value should be removed to satisfy the requirement that the workspace has no placeholder controls or inactive clickable elements.

**Alternatives considered**: Keeping future controls as disabled hints was rejected unless the condition is tied to current task state, permissions, or data availability. Hiding controls behind feature flags was rejected unless there is a concrete shipped-behavior or external-consumer need.

## Decision: Keep action availability rules outside React render bodies

**Rationale**: Constitution requires business logic to stay out of React components and Hono handlers. Availability, disabled reasons, duplicate-submission guards, and action status mapping should be pure helpers or domain rules when shared, with components rendering the result and dispatching actions.

**Alternatives considered**: Inline conditional logic in each component was rejected because it scatters behavior and makes the inventory hard to test. Moving all UI-specific state to domain packages was rejected unless the rules become shared business behavior.

## Decision: Test both retained behavior and removed UI

**Rationale**: This feature can regress by leaving dead controls in place as much as by breaking a wired action. Tests need to assert retained actions work, disabled states explain themselves, and removed controls no longer appear as interactive elements.

**Alternatives considered**: Manual verification only was rejected because the constitution requires automated tests for behavior changes. Snapshot-only coverage was rejected because it does not prove action outcomes or failure handling.
