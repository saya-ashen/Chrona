# Personal steward: direction and current implementation

**Current product direction, 2026-10-13.** The canonical [Chinese direction](../zh/personal-steward.md) supersedes earlier product plans. This document separates that target from the source implementation in this checkout. This rebuild is unreleased, not deployed, and has not migrated real user data; earlier result-layer deployment records are not steward rollout claims.

## Direction and boundaries

Chrona is a proactive personal steward: reachable through everyday conversation, controllable through a web affairs centre, supported by a reliable background event service. It is not a chat client, workflow editor, or merely a results repository. The product question is **whether my affairs are being looked after**, not how every task executes.

Tell it once; retain context; observe authorized changes; act within explicit boundaries; show what happened and what remains owed. Not every message becomes a task, and not every task executes automatically.

The authorized rebuild may change internal architecture, pages, domain models, APIs and development schema, and retire heavyweight managed orchestration without compatibility shells. It does **not** authorize real-data deletion/migration, deployment/publishing/push, live databases, host/network changes, private accounts, real external sends, broader account permissions, or disabling authentication, approval or secret redaction. Preserve genuine Plan/Run/results; never fabricate execution history.

| Owner | Responsibility |
| --- | --- |
| Chrona | Durable affairs, commitments, delegations, enforceable permissions, event/handling records, result versions/review, notification policy/receipts; scheduling and delivery authority |
| Assessor | Replaceable interpretation/proposal port; not a permission authority or delivery retry owner |
| SourceAdapter | Read-only input boundary; polling/webhook capability must be declared, not inferred from a callable tool |
| DeliveryAdapter | One send attempt, reporting accepted/rejected/uncertain honestly |

The [shared contract](../../packages/contracts/src/steward/index.ts) is supervisor-owned. [Data model](data-model.md) documents Affair, SourceConnection, InboundEvent, EventAssessment, Delegation, AttentionItem, StewardNotification, FollowUp, ManagedTool, StewardAudit and StewardState.

## Current pages

Browser routes are locale-prefixed (`/:lang`), composed in [router.tsx](../../apps/web/src/router.tsx) and [pages.tsx](../../apps/web/src/pages.tsx), with UI in `features/steward`.

| Page | Route | Current role |
| --- | --- | --- |
| Today (default landing) | `/today` | Decisions, changes/failures, commitments, suggestions, results, upcoming follow-ups and health |
| Affairs | `/affairs`, `/affairs/:affairId` | Goal/context, messages and suggested links, attention, delegations, follow-ups and tools |
| Schedule | `/schedule` | Steward projection alongside retained scheduling UI; appointments, deadlines, checks, follow-ups and unconfirmed dates stay distinct |
| Delegations | `/delegations` | Propose then grant; revision-checked pause/resume/revoke |
| Connections | `/connections` | Source readiness, coverage, sync and controls; events and delivery records |

Legacy Task/Goal/workbench/managed-execution pages remain reachable through secondary navigation; they have not been made read-only or removed. Existing result facilities remain the result layer, not the product centre.

## How it works

All engine paths below are under `packages/engine/src/modules/steward/`.

1. **Compose and wake:** [steward-runtime.ts](../../apps/server/src/steward-runtime.ts) supplies adapters and `rule-assessor-v1`, shares one composition between HTTP and worker, and visits each workspace. One non-overlapping server timer calls the steward tick. `CHRONA_STEWARD_TICK_SECONDS` defaults to `60`; non-finite or non-positive values disable it. Tests (`NODE_ENV=test`, `BUN_ENV=test`, or a `test` argv entry) disable automatic start. This is the steward timer, not a claim that legacy schedulers were removed.
2. **Poll due sources:** [tick.ts](../../packages/engine/src/modules/steward/tick.ts) requires a covering active, unexpired delegation with allowed `read_source` before automatically polling active/failing connections. Due time respects both `nextCheckAt` and delegation cadence. [connections.ts](../../packages/engine/src/modules/steward/connections.ts) checks adapter readiness on creation/resume. Poll failures are sanitized and deferred by the connection interval (fallback 60 seconds).
3. **Persist before processing:** [ingest.ts](../../packages/engine/src/modules/steward/ingest.ts) commits items and cursor together. First sync records `baseline` only; later items are `pending`. `(connectionId, externalId)` is unique. Cursor races retry from committed state, not a stale poll snapshot.
4. **Associate and assess:** [process.ts](../../packages/engine/src/modules/steward/process.ts) reuses confirmed same-connection thread links; assessor guesses stay `suggested` and cannot grant affair-scoped authority. The [built-in assessor](../../packages/integrations/src/steward/rule-assessor.ts) uses limited deterministic English rules: dated request → decision; question addressed to you → notify; informational markers → retain; otherwise digest. Exactly one literal keyword-matched affair may be suggested. External-Agent assessment is **not wired**.
5. **Recover assessment:** unavailable assessor leaves events pending with exponential backoff (30 seconds up to 30 minutes) and visible health/backlog. Other failures become failed after five attempts and raise one failure item. A transaction claims each pending event and commits assessment, permission result and derived records together.
6. **Enforce authority:** [permission.ts](../../packages/domain/src/steward/permission.ts) applies the table below. `process.ts` chooses a matching active, unexpired delegation; suggested links do not count as confirmed scope. External message content cannot grant actions or change destinations. `retain` persists assessment; `digest`/`notify_now` produce changes; `await_decision` produces a decision; allowed `act/create_follow_up` can persist a follow-up. This is not a general action executor. Notification generation additionally requires allowed `notify_user`.
7. **Raise commitments and suggestions:** [follow-ups.ts](../../packages/engine/src/modules/steward/follow-ups.ts) raises each due pending follow-up once; completion/cancellation updates its generated commitment. [suggest.ts](../../packages/engine/src/modules/steward/suggest.ts) records restrained proposals and audits, not automatic grants, tool enables or sends.
8. **Digest and deliver:** [digest.ts](../../packages/engine/src/modules/steward/digest.ts) queues at most one digest per permitted delegation/local day, after suggestions and before delivery. It includes open changes owned by that delegation created since its previous digest, counts all matching items and lists up to ten titles. No changes means silence. The day uses quiet-hours timezone or UTC; `digest:<delegationId>:<localDay>` deduplicates retries. Digests have no attention-item link and still pass normal delivery policy checks. [delivery.ts](../../packages/engine/src/modules/steward/delivery.ts) claims due outbox rows, rechecks authority and policy, sends once via an adapter, records outcome and retries independently of event assessment.
9. **Project and decide:** [reads.ts](../../packages/engine/src/modules/steward/reads.ts), [affairs.ts](../../packages/engine/src/modules/steward/affairs.ts) and [schedule.ts](../../packages/engine/src/modules/steward/schedule.ts) serve durable state through the [Steward API](api-reference.md). Decisions, link confirmation/rejection and transitions are explicit. Schedule is a read-only projection; tentative dates become commitments only through explicit approval: approving a dated decision creates one idempotent FollowUp, using nextStep or title as its note; declining creates none.

### Permission rules (first match wins)

| Condition | Outcome |
| --- | --- |
| `reply_external`, `mark_read_external`, `delete_external` | Always denied during the read-only pilot |
| Missing delegation or status other than `active` | Denied |
| Invalid current time, invalid expiry, or `expiresAt <= now` | Denied, even if stored status is still active |
| Action in `askFirstActions` | `ask_first`, even when also allowed |
| Action in `allowedActions` | Allowed |
| Everything else | Denied |

Delegations start proposed; grant is distinct from creation. Revision checks prevent stale transitions. Pausing/revoking a **connection** stops polling/assessment; delivery rechecks both connection and delegation. Pausing/revoking the last covering read-authorized delegation stops automatic polling on the next tick: `nextCheckAt` becomes null and coverage explains the idle state, without marking the connection failing. Explicit owner Sync now remains permitted without a delegation. Covering means matching connectionId or null (workspace-wide). Tick respects the connection due time and the smallest configured covering cadence, records lastCheckAt and success/sanitized failure on covering delegations, and passes the smallest covering `maxEventsPerCheck` to the workspace assessment batch.

### Delivery semantics

| Status | Meaning in current code |
| --- | --- |
| `generated` | Persistence default/vocabulary for generated output; current event processing creates eligible outbox rows directly as queued |
| `queued` | Eligible for delivery, possibly deferred by backoff/policy |
| `sent` | Adapter accepted; not proof of user reading |
| `failed` | Permanent rejection, unavailable channel or exhausted retry attempts; failure attention is deduplicated |
| `uncertain` | Claimed/in flight or outcome unknown; do not assume success or blindly resend |
| `suppressed` | No longer permitted by owning delegation/connection or policy |
| `acknowledged` | Explicit user acknowledgment of sent/uncertain notification, not resolution of its attention item |

The unique `idempotencyKey` (`attention:<id>:v1` for event notifications) is retained across retries. Atomic compare-and-set claims reserve delivery and daily capacity; `nextAttemptAt` carries the **five-minute lease** while uncertain. Expired claims retry automatically only with an explicitly idempotent adapter. Late receipts are fenced by claim attempt/state. Retryable rejections use 1/5/15/60-minute backoff, capped at six attempts; explicit retry applies to failed rows and preserves the key. Quiet hours, daily caps and attention cooldown defer; silent policy or lost permission suppresses.

Besides `in_app`, the chat channel `hermes_qqbot` delivers through the host's `hermes send` to one allowlisted QQ private chat; see [the chat loop](../zh/steward-chat-loop.md) for proposal/confirmation by reply ref, recipient binding, sanitising and uncertain-send rules. `in_app` is the only channel without an external account, implemented by [in-app-delivery.ts](../../packages/integrations/src/steward/in-app-delivery.ts): a stable local receipt, no external send. `local_test` delivery is registered only when `CHRONA_E2E_TEST_ROUTES` is `1` or `true` (trimmed, case-insensitive). Other channels fail visibly. There is no real external notification integration. Digest disposition produces attention; the tick then aggregates eligible open changes into daily digest notifications.

Delegation creation through direct proposals, approved suggestions and management tools explicitly persists the contract default when policy is omitted: `mode: digest`, `channel: in_app`. Prisma's legacy `local_test` default is not relied on by these paths; existing rows are not migrated.

### Tools: choose lightly, authorize separately

[handling.ts](../../packages/domain/src/steward/handling.ts) chooses among direct answer, result page, reuse, script, delegation, panel and Agent iteration, recording its rationale. These are recommendations, not evidence that every mode has an executor.

[tools.ts](../../packages/engine/src/modules/steward/tools.ts) persists a tool only for script/panel choices. Lifecycle: **generated → validated → authorized → enabled**; failed validation, disable and retirement are separate states. Version checks protect transitions; edits reset validation/authority. Authorization requires an explicit user actor. Running still requires an active, unexpired affair-scoped `run_tool` delegation with no connection restriction; an affair-less tool has no implicit workspace-wide authority.

[tool-spec.ts](../../packages/domain/src/steward/tool-spec.ts) admits only declarative `event_rule` and `table_panel` data, never executable code. Rules require passing positive and negative examples; panels reject duplicate columns. Runs evaluate bounded input or read scoped rows; they do not execute generated shell/JavaScript or external writes. The service supports edits, but no tool-edit HTTP route is registered.

### Proactive suggestions and restraint

Thresholds come from [suggestions.ts](../../packages/domain/src/steward/suggestions.ts), not model guesses:

| Detector | Evidence/threshold |
| --- | --- |
| Approaching deadline | `DEADLINE_HORIZON_MS`: inclusive next 72 hours, active/watching affair, pending follow-up or open commitment/decision, and another open preparation decision |
| Repeated manual work | `MIN_REPEATED_EVENTS = 3` distinct assessed events with the same pattern within inclusive `REPETITION_WINDOW_MS = 14 days`; no active delegation or enabled tool covering the affair |
| Wrap-up | Every decision resolved within inclusive `WRAP_UP_WINDOW_MS = 48 hours`, but pending follow-ups or active/enabled resources remain |
| Season over | Paused/closed affair still has active delegations or enabled tools |
| Stalled goal | Active nonempty goal, every known activity at least `STALLED_AFTER_MS = 14 days` old; UTC ISO-week bucket |

Priority is deadline, repetition, wrap-up, season-over, stalled. `DEFAULT_MAX_PER_RUN = 3`. Stable fact keys deduplicate; family-level dismiss/decline cooldown is `DISMISS_COOLDOWN_MS = 14 days`, less-often is `LESS_OFTEN_COOLDOWN_MS = 30 days`; snooze lasts to expiry (missing/invalid expiry stays restrained). Cooldowns expire exactly at their boundary. The engine reads assessed events from the last 30 days and builds patterns from disposition plus matching affair keyword or normalized author. Approval can create a **proposed** delegation or point to tool drafting; it does not grant or enable anything.

### Authorization model

[steward.routes.ts](../../apps/server/src/routes/steward.routes.ts) uses [isLocalOwnerAuthorized](../../apps/server/src/middleware/auth.ts): with `API_KEY`, require the matching Bearer key; without it, accept only requests with no Authorization header. Scoped MCP bearers are not owner credentials. Every normal steward route requires `?workspaceId=` identifying an existing workspace. Engine operations scope records and referenced IDs to that workspace and check write authority.

This is a **single local owner**, not multi-user membership/RBAC. The owner's workspace selector is data scoping, not a separate access grant. Contract comments about membership describe a stronger model than the actual owner-only route.

## Verification and remaining gaps

The [API loop suite](../../apps/server/src/__tests__/api/steward-loop.bun.test.ts) covers baseline, dedupe, backlog recovery, delivery retry, pause/revoke, untrusted text, cross-workspace isolation, restart, tool lifecycle, in-app delivery and the gated test channel. Domain/engine/adapter tests sit beside implementation; UI tests live in `features/steward`. Test existence is not a claim that this documentation change reran them.

The local source is process-local test data; restart tests replay its log while durable DB state survives. Reddit is a read-only mapping boundary with injected transport/token ports, but runtime injects neither. It remains `needs_authorization`; explicit account authorization is the blocker, and no live verification is claimed. Conversation integration exists only as the Hermes QQ chat bridge described in [the chat loop](../zh/steward-chat-loop.md); the [chat acceptance suite](../../apps/server/src/__tests__/api/steward-chat-loop.bun.test.ts) covers proposal ≠ grant, replayed confirmations, sanitising, restart without resend, rejected/uncertain sends, pause/resume/revoke, backlog and identity. Today has a result bucket, but this loop does not yet bridge legacy result versions into it. The standing-behaviour tests in `digest.bun.test.ts` cover delegation-gated polling, manual sync, cadence, sanitized check telemetry, batch limits, default in-app delivery, daily digests and idempotent approved-date follow-ups.

For development start, environment variables and isolated test commands, see [如何运行](../zh/personal-steward.md#如何运行). No live account, deployment or data-migration operation is part of those documentation claims.
