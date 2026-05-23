# Research: Workspace Activity Feed

## Decision: Use `Activity` as the singular node drawer label

**Rationale**: `Activity` names a collective operational feed, matches the existing Command Center tab, and is the most natural product label for a timeline of execution events. It avoids the awkward plural `Activities` and better replaces Evidence as the primary answer to “what happened here?”

**Alternatives considered**: `Activities` was rejected because it reads like a collection of discrete modules rather than a feed. Keeping `Evidence` was rejected because the new surface is broader than result evidence and includes live provider work, tool calls, reasoning, approvals, and node lifecycle events.

## Decision: Make structured node-aware Activity the final model

**Rationale**: The requested final state explicitly excludes old code and data compatibility. A single structured model prevents permanent branching between coarse summaries, evidence lines, and provider events. Node identity must be recorded on activity-producing events so the node drawer can filter accurately.

**Alternatives considered**: Preserving the coarse timeline for old events was rejected because it keeps duplicate user-facing models. Inferring node identity from time windows was rejected because it can misattribute events when nodes overlap, retries occur, or provider runs span multiple node lifecycle boundaries.

## Decision: Merge live and persisted activity by stable identity

**Rationale**: Users need one coherent feed while tasks are running and after refresh. Persisted activity gives durable history; live runtime events give immediacy. Deduplication must use stable event identity from task/run/provider/node/type/sequence where available so refreshes do not show the same event twice.

**Alternatives considered**: Showing separate “Live” and “History” sections was rejected because it makes users reconcile two timelines. Relying only on live events was rejected because refresh and completed task inspection need durable history.

## Decision: Render provider tool calls as first-class activity

**Rationale**: Tool calls are the most actionable provider events. The feed must show started, completed, and failed states with tool identity, preview/input summary, duration, and error when available so users can understand provider work without opening the provider UI.

**Alternatives considered**: Showing tool calls as generic raw events was rejected because it does not meet the “similar to provider TUI” requirement. Showing every raw payload by default was rejected because it harms scanability and mobile layout.

## Decision: Use progressive history browsing after the initial feed

**Rationale**: Tasks can have thousands of events. The newest activity must appear quickly, while older events remain reachable. Phase 1 can improve the latest feed, and Phase 2 can add cursor-based or equivalent progressive browsing to avoid unbounded initial payloads.

**Alternatives considered**: Increasing the initial page size indefinitely was rejected because it risks slow initial loads and excessive rendering. Hiding older activity permanently was rejected because long-running task inspection requires history.

## Decision: Keep SSE routed through the shared frontend helper

**Rationale**: Existing workspace live events already flow through the project-standard SSE helper, which centralizes headers, errors, JSON parsing, and fallback behavior. Activity changes should reuse that path rather than adding manual stream parsing.

**Alternatives considered**: Hand-rolled component-level stream parsing was rejected because it violates project guidance and would duplicate error handling.

## Decision: Use shadcn primitives for generic feed controls

**Rationale**: The activity feed will need buttons, badges, cards, tabs, separators, skeletons, alerts, and expandable disclosure controls. Project UI foundation rules require official primitives for these generic roles, with Chrona wrappers only when product-specific meaning exists.

**Alternatives considered**: Local generic variants or custom primitive helpers were rejected because they conflict with the current UI foundation direction.

## Decision: Treat final legacy removal as a release exit criterion

**Rationale**: The user explicitly requested phased progress to the optimal final version and no final old-code/data compatibility. Phase 3 must therefore include audit work to remove Evidence drawer terminology, old coarse-only activity renderers, old-data compatibility fallbacks, and unreliable historical inference.

**Alternatives considered**: Keeping compatibility indefinitely was rejected because it conflicts with the requested final state and increases maintenance burden.
