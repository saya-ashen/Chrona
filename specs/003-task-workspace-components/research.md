# Research: Task Workspace Component Parity

## Decision: Use existing Chrona web stack for the redesign

**Rationale**: The repository already uses Vite, React 19, React Router 7, strict TypeScript, Vitest, Testing Library, Playwright, and `@xyflow/react`. These cover the required workspace shell, page composition, route data, flow graph, component tests, and browser checks. Staying on the local stack reduces delivery risk and preserves established ownership.

**Alternatives considered**: Adding a new UI application framework or page runtime was rejected because Chrona is explicitly not a Next.js app and the feature only targets one existing SPA page. Adding a new component library was rejected for this planning phase because component parity is mostly layout and state composition, not missing primitives.

## Decision: Reuse `@xyflow/react` for the execution flow map

**Rationale**: The reference requires ordered nodes, connections, node state styling, selected-node context, zoom, centering, and fit/expand behavior. `@xyflow/react` is already present and existing task graph components use it. Reusing it avoids a second graph engine and keeps behavior testable through current graph surfaces.

**Alternatives considered**: A custom SVG/canvas flow renderer was rejected because it would duplicate graph interaction and accessibility concerns. A new graph dependency is allowed only if implementation proves a blocking limitation in existing graph behavior.

## Decision: Derive first from existing task workspace data

**Rationale**: The feature is functional component parity, not a data model migration. Existing task, plan graph, run, artifact, approval, and event sources likely cover most visible header, flow, node detail, overview, and timeline requirements. A pure web view model can normalize these into the required regions without adding persistence.

**Alternatives considered**: Creating a new persisted task workspace projection up front was rejected because it risks old/new data-pattern duplication. A narrow read model or shared contract may be introduced later only when a required visible field cannot be derived cleanly from current sources.

## Decision: Replace obsolete workspace layout instead of preserving legacy compatibility UI

**Rationale**: User direction explicitly asks to avoid old compatibility code and old data patterns during implementation. The plan should therefore migrate the task workspace to the reference-aligned component hierarchy, not keep parallel old and new layouts behind switches unless needed for persisted data or external consumers.

**Alternatives considered**: Feature flags or dual layouts were rejected for this feature because they increase test surface and make component parity ambiguous. Compatibility remains acceptable only for concrete shipped behavior, persisted data, or external integrations.

## Decision: Add dependencies only for best-design gaps

**Rationale**: The local stack already covers expected needs. New dependencies are permitted by user direction but should be justified by a strong design advantage, such as materially better accessibility, graph behavior, or maintainability that cannot be achieved with current dependencies.

**Alternatives considered**: Free addition of UI/graph/state libraries was rejected because it increases bundle and maintenance cost without a known gap. A hard ban on dependencies was also rejected because user allows optimal-design additions.

## Decision: Keep business rules outside React components

**Rationale**: Constitution requires business logic to stay out of React components and Hono handlers. For this feature, React components should render task workspace regions and dispatch existing actions. Progress, node state, attention summary, and artifact/timeline grouping should be pure helper/view-model logic that can be tested independently.

**Alternatives considered**: Computing all state inline in page components was rejected because it mixes concerns and makes component tests brittle. Moving web-only presentation grouping into domain packages was rejected unless the rule becomes shared business behavior.

## Decision: Treat reference image as component contract, not pixel-perfect styling

**Rationale**: User explicitly said not to focus on CSS style and to focus on functional component gaps. Success should be measured by visible component categories and interactions: navigation, header, controls, flow, node details, result summary, attention, artifacts, and activity.

**Alternatives considered**: Pixel-perfect implementation was rejected as out of scope for this phase. Ignoring visual structure entirely was also rejected because component placement affects usability and parity.
