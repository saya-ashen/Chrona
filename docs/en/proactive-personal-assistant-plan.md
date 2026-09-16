# Proactive Personal Assistant: Development Plan

Status: Goal capture deployed with explicit approval; existing-Goal editing implemented locally, not deployed or installed into Pi yet. Live automation, permission grants and real notification sends remain unapproved.

This is the canonical development plan for making Chrona the durable, governed
backing service for a user's everyday AI assistant. It records the agreed scope,
architecture, implementation sequence, and acceptance gates. It does not claim
that proposed tools, permissions, or notification channels already exist.

For this initiative, this plan governs priorities where the older schedule-first
roadmap differs. Existing lifecycle, security, provider, and migration contracts
remain authoritative until explicitly reviewed changes are implemented. Maintain
this document as work proceeds; move lasting shipped contracts into their owning
docs rather than accumulating dated phase reports.

## Implementation status

- **Phase 0: partial.** Live HTTPS management access now verifies after the user
  repaired the expired certificate. Source-based [delivery comparison and
  recommendation](assistant-delivery.md) is available; provider enforcement,
  recipient setup and pilot limits remain open.
- **Phase 1: first capture slice deployed.** Goal search/read/new-Draft proposal
  tools, explicit Goal-only enrollment, durable idempotent receipts, bounded
  provenance and a portable [skill](../../packages/skills/chrona-assistant/README.md).
  Existing `read`/`full` scopes are not widened. No database migration was needed.
  Pi's actual adapter verified separate task/Goal credentials and the no-write
  proposal contract; its skill loader verified discovery inside/outside the repo.
  Already-open Pi sessions require `/reload` to load the new connection and skill.
- **Phase 1 follow-up: existing-Goal editing implemented locally.** The optional
  `assistant-edit` profile enables title/description/partial brief/ID-based criteria
  edits and attributed progress/finding/decision notes. Read-only previews,
  persisted `editRevision`, conflict reconciliation, atomic audit/brief history,
  and idempotent receipts preserve existing Task context. Explicit user requests
  need no redundant confirmation; inferred material edits require skill-mediated
  review. This is not server-authenticated consent or a policy-grant mechanism.
  Existing credentials remain unchanged; deployment and Pi installation are pending.
- **Phase 1 remaining gates:** user-trial intent/consent quality, real saved-Draft
  and existing-Goal edit trials, plus explicit rollout of the editing version.
  No Draft activation or permission grant is exposed. Phase 1 is not marked complete.
- **Phases 2–6: not implemented.** No policies enforced from natural language,
  recurring searches started, delivery adapters configured, or user data migrated.

This is an implementation status, not permission to bypass the gates below.
Current capture contracts and setup are documented in the
[API reference](api-reference.md#post-apimcpmanagement) and
[management guide](../zh/management-mcp.md).

### Local verification of the capture slice

- Typecheck and targeted ESLint passed; 46 targeted contract, engine, CLI and MCP
  tests passed, including concurrent retries, transaction rollback and revocation.
- Package boundaries passed with 10 existing warnings; the MCP feature suite
  passed (50 Bun tests and 5 Vitest tests).
- With the system Chromium override, the broad test command passed its Vitest,
  Bun and API stages but timed out during E2E; full E2E remains unverified.
  A separate desktop route audit passed all 6 tests.
- Global lint remains blocked by pre-existing warning-ratchet debt in
  `task-config-save.ts` and `manual-task-lifecycle.ts`, also verified at HEAD.
- A clean committed-source Linux build and packaged upgrade/backup/restore smoke
  also passed. Deployment preserved all 19 tasks; comparison of 67 database tables
  before explicit enrollment found only the expected scheduler-lease change.
- Deployed checks used the installed Pi adapter: 7 task tools and 4 Goal-scoped
  tools without name collisions, context, no-write proposal validation and denied
  task access for the assistant credential. Pi 0.85.1 discovers one installed
  prompt-visible skill in both the project and an unrelated directory.
- No live Goal/task was created and no model invoked for acceptance. These checks
  do not certify automatic intent recognition, provider enforcement, notification
  delivery or unattended execution.

### Existing-Goal editing milestone

Source contracts: `chrona_goal_update`, additive `capabilities.goals.editing`,
`chrona_goal_read` editability/editRevision/history. See the
[API contract](api-reference.md#post-apimcpmanagement) and
[skill walkthrough](../../packages/skills/chrona-assistant/README.md).

- Scope: Draft/Active/Paused only. Archived outcomes stay immutable through MCP.
  No Goal lifecycle, trigger, schedule, provider or permission-grant changes.
- Partial updates preserve omitted/unknown metadata; revised criterion meaning
  resets prior confirmation/evidence. Notes are attributed text, not accepted
  Results or verified evidence. History is management edits only, not all activity.
- `goals:write` is workspace-wide content authority; natural-language constraints
  and conversational confirmation are not per-Goal enforced permissions.
- DB: `Goal.configRevision` plus SQLite trigger covers canonical/UI edits and
  A→B→A. Current mutable release-line migration and known amendments/normalizers
  converge to the new schema; released migrations remain unchanged. Registered
  amendment `5d2fdbd1…` upgrades the currently deployed schema with backup.
- No existing Task context is rewritten or execution started; future associated
  Tasks capture the new brief. No unrelated functionality removed: only local
  helper extraction reduced complexity introduced by editing.
- Rollout is separate: upgrade/backup, explicit `assistant-edit` enrollment,
  assistant connection allowlist/credential and installed skill update, read-only
  capability check, then a user-approved real edit trial. Do not rotate task
  credentials or migrate the live database as part of development tests.

**Local verification (editing slice):**

- Typecheck passed. Targeted ESLint has no new warnings/errors; the existing CLI
  function-length warning remains. Boundaries: 0 errors, 10 existing warnings.
- 73 focused contract/engine/CLI/wire/migration tests passed. Dedicated DB
  regression: 45 passed, 1 skipped; MCP feature: 50 Bun + 5 Vitest passed.
- Broad run completed all 786 Vitest tests and 2,106 Bun tests (11 skipped), then
  hit the 420-second limit during API tests. Separate API run passed all 423 with
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/run/current-system/sw/bin/google-chrome`;
  without that override two PDF export tests failed for missing usable Chromium.
- Desktop route audit: 6 passed with that browser override and isolated test
  ports 48120/48121 after the default API port was occupied. Full E2E was not run
  to completion; no claim of an all-green `bun run test` invocation.
- Linux build and packaged fresh-start/upgrade/backup/restore smoke passed in a
  HEAD-plus-milestone snapshot excluding seven unrelated Pi-provider/docs edits.
  Build emitted existing asset-size warnings and a nonfatal Bun directory-mismatch
  diagnostic; packaged runtime smoke succeeded. No live data or deployment changed.
- Global lint still fails the pre-existing warning ratchet in
  `task-config-save.ts` and `manual-task-lifecycle.ts`; no new lint debt was added.
- Protocol/skill checks do not prove natural-language intent recognition or consent
  quality. The installed capture skill/MCP and actual user-data trial remain unchanged.

## 1. Product objective

> The user's everyday agent understands their work and proposes useful ongoing
> assistance. Chrona remembers the confirmed commitment and reliably advances it
> within the user's permissions, even after the conversation ends. Existing
> delivery infrastructure brings meaningful results and decisions back to them.

Chrona is neither a replacement chat client nor merely a cron wrapper. Its value
is durable goals, explicit authority, persistent progress, reliable activation,
recoverable execution, and traceable results.

"Always on" means an available service with event/schedule-driven bounded work,
not a model continuously thinking or an indefinitely open provider session.
The service, execution environment, tools, and delivery path must actually be
available; a laptop that is asleep cannot perform local scheduled work.

### First reference workflow

A user discusses PhD applications in their normal agent. The Chrona skill notices
a possible ongoing need, checks existing Goals, and proposes position monitoring.
The user confirms interests, sources, cadence, access, budget, and delivery.
Chrona then searches, verifies, compares against prior findings and applications,
and reports meaningful changes without repeated prompting. Feedback changes
future matching. Contacting supervisors or submitting applications remains
outside the initial authorization.

Success is useful work delivered with less user effort, not a growing count of
Tasks or runs labelled Completed.

## 2. Agreed design decisions

1. **Skills + management MCP are the primary conversational entry.** Integrate
   into the user's existing agent; do not build another mandatory chat surface.
2. **Chrona owns durable state and execution.** A skill can suggest work but cannot
   guarantee activation, scheduling, persistence, or permission enforcement.
3. **Reuse delivery infrastructure first.** Investigate existing projects and the
   user's current channels before selecting one integration. Do not build a
   messaging platform or assume a transport has delivery guarantees.
4. **Permissions are expressed naturally.** Goal/Task permission requests and
   grants are readable natural language. Execution uses validated, versioned
   constraints, not model obedience to prose alone.
5. **Simplify when a real development obstacle appears.** Do not launch a
   pre-emptive UI, schema, provider, or architecture cleanup. Remove or narrow the
   specific complexity blocking a feature; otherwise leave it alone.
6. **Reuse existing product aggregates.** No second Goal system, scheduler,
   execution engine, result lifecycle, or generic memory platform.
7. **Deliver one complete workflow before generalizing.** PhD monitoring is the
   first reference case, not a mandate to hard-code admissions logic in the core.
8. **Proposal, permission, activation, execution, result readiness, and delivery
   are different facts.** Neither a confirmed Goal nor a successful MCP command
   proves that background work or notification delivery succeeded.

### Explicit non-goals for the first release

- Continuous desktop surveillance, whole-mailbox ingestion, or full chat-history
  uploads; new context sources require explicit selection.
- Autonomous applications, outreach, purchases, credential setup, or account
  creation.
- A new Chrona chat application, redesigned global navigation, generic agent
  marketplace, multi-agent swarm, or new remote-worker network.
- Broad provider expansion, universal workflow builders, knowledge-graph/model
  training projects, or a generic document/application editor.
- Unrestricted shell access disguised as a read-only prompt.
- Exactly-once external delivery, guaranteed human readership, or hard spending
  limits that the selected provider cannot actually enforce.

## 3. Verified baseline and gaps

The following baseline was inspected in the local repository on 2026-09-16,
starting from commit `81c91b39`. It is source evidence, not a deployed-instance
acceptance report. The live management MCP connection was unavailable during
planning. Recheck runtime capabilities and the current checkout before coding.

| Area | Existing foundation | Remaining work for this goal |
| --- | --- | --- |
| Durable goals | Goal lifecycle, Operational Brief, Working Set, accepted results, GoalAssets | Expose bounded Goal management to everyday agents; confirm contextual inferences |
| Goal review | Grounded proposals for brief fields, task candidates, and next review time | Connect approved standing routines to useful review/action decisions; support no-change outcomes |
| Activation | TaskTrigger, TriggerDelivery, TaskOccurrence, schedule and bounded event activation | Configure and verify the end-to-end standing-work loop without a second scheduler |
| Due reviews | Worker emits `goal.review_due` for eligible active Goals | Event emission alone does not prove a subscribed task or autonomous review is configured |
| Management MCP | Workspace-bound credentials, task search/read/write/actions, durable commands, revisions, idempotency | Goal proposals, scoped standing authorization, routine inspection, delivery status |
| Permissions | Management scopes plus provider approval/tool-mode settings | Natural-language-to-policy workflow, non-self-approvable grants, enforceable Goal/Task restrictions |
| Recurrence | Management context advertises UTC recurrence | Do not promise arbitrary local-wall-clock/DST recurrence; validate the chosen pilot semantics |
| Delivery | Fixed in-app due indicators; management context reports no delivery channels | Select an existing transport and integrate reliable result/attention delivery |
| Assistant UI | `assistant-surface` service returns unavailable/informational responses | Not a working personal-assistant substrate; rebuilding it is not a prerequisite |
| Execution/results | Provider adapters, approvals, recovery, artifacts, result finalization | Certify one unattended execution path and preserve result-ready versus execution-complete distinctions |

Source anchors:

- [Long-horizon Goals and triggers](long-horizon-goals-and-triggers.md)
- [Management MCP](../zh/management-mcp.md) and
  [management feature ownership](../../features/mcp-control-plane/README.md)
- [Provider boundary](provider-boundary.md)
- [Management schemas](../../packages/contracts/src/api/management.schema.ts)
- [Management capability response](../../packages/engine/src/modules/management/reads.ts)
- [Goal review feature](../../packages/engine/src/modules/goals/ai/goal.review.ts)
- [Goal review application](../../packages/engine/src/modules/goals/goal-review-proposals.ts)
- [Due-review worker](../../packages/engine/src/modules/orchestration/goal-review-due-worker.ts)
- [Trigger implementation](../../packages/engine/src/modules/triggers/task-triggers.ts)
- [Assistant surface service](../../features/assistant-surface/server/assistant-surface.service.ts)

Some older overview documents describe migration targets that the more specific
Goal/trigger documentation and source now implement. Resolve discrepancies with
focused source/tests and live capabilities, not by treating every roadmap item
as missing or every documented feature as deployed.

## 4. Target architecture and ownership

```text
Everyday agent + portable Chrona skill
  | context/capability discovery, Goal lookup, bounded proposals, feedback
  v
Management MCP -> canonical engine use cases <- existing Chrona review UI
                         |
             Goal context + approved standing policy
                         |
             existing triggers / scheduler / leases
                         |
                  isolated TaskOccurrence
                         |
            policy checks -> supported provider/tools
                         |
            validated observations / finalized result
                         |
           meaningful-change and disclosure decision
                         |
          delivery adapter -> existing notification system
                         |
                channel receipt / user feedback
```

- The everyday agent decides what to *propose* based on permitted context.
- The engine decides whether an action is authorized, eligible, duplicate,
  blocked, or recoverable. MCP and HTTP must use the same use cases.
- Providers adapt execution protocols; they do not own Goal lifecycle or policy.
- Domain helpers own deterministic policy evaluation and matching/delta rules
  where appropriate; model judgments remain labelled judgments.
- Existing Goal/Task UI provides review, inspection, stop, and recovery. No global
  navigation change is required to deliver this architecture.
- Selected notification infrastructure owns transport-specific behavior.
  Chrona owns disclosure decisions and the facts needed to explain outcomes.

### Package placement

| Change | Primary owner |
| --- | --- |
| New everyday-agent skill | Proposed `packages/skills/chrona-assistant/`; distinct from run-scoped `chrona-node` |
| Public MCP/policy/observation/delivery schemas | `packages/contracts` |
| Pure policy, delta, eligibility and presentation derivation | `packages/domain` |
| Goal proposals, authorization, standing routines, result publication | Existing `packages/engine/src/modules/goals`, `management`, `tasks`, `triggers`, `orchestration`; add a cohesive module only when needed |
| Persistence and constraints | `prisma` and `packages/db` under the release-line migration policy |
| MCP transport wiring | `features/mcp-control-plane` |
| Provider enforcement/capability adaptation | `packages/providers/foundation` and the selected existing provider |
| Delivery transport/setup | `packages/integrations`, with engine-owned delivery use cases |
| Goal review/permission/receipt UI | Existing Goal, Task, Action Center and Settings feature owners |
| User-facing copy | `packages/i18n` |

Follow [package boundaries](package-boundaries.md). Do not add empty layers,
pass-through wrappers, or a generalized plugin framework to host one adapter.

## 5. Workstream A: everyday-agent skill and MCP

### Skill behavior

The skill must:

1. Read capabilities and authorization; degrade honestly if Chrona is offline.
2. Recognize sustained intent without turning every question into automation.
3. Search existing Goals/routines before proposing another one.
4. Submit only the necessary, user-approved context summary and source references.
5. Explain the proposed outcome, ongoing work, boundaries, cost controls, and
   delivery behavior; ask only unresolved questions that affect these decisions.
6. Obtain confirmation through the supported consent path, then activate the
   approved routine and verify its durable receipt/current state.
7. Return the Goal reference, next eligible run, pause/stop action, and known
   prerequisites. Never call a queued command a running or completed task.
8. Handle corrections, rejected suggestions, changed priorities, and explicit
   requests not to use Chrona without repeated pressure.

Provide an explicit invocation fallback. Host discovery/loading differs; skill
installation is not proof that every relevant conversation will trigger it.
The normal agent must remain usable when Chrona is unavailable.

### MCP contract additions

Prefer a small closed set of Goal-oriented operations over one generic executor:

| Proposed family (names not yet shipped) | Required behavior |
| --- | --- |
| Extend `chrona_context_read` | Contract version, Goal/routine capabilities, effective client authority, recurrence limits, provider enforcement readiness, delivery capabilities |
| `chrona_goal_search` / `chrona_goal_read` | Bounded Goal lookup, revision, brief, routine/policy summaries, next run, current attention and result/delivery references |
| `chrona_goal_propose` | Preview/create a bounded draft or change proposal with rationale and provenance; no implicit authorization or execution |
| `chrona_goal_update` | Implemented locally: partial content edits/notes with persisted editRevision, read-only preview and atomic audit; no lifecycle or grant authority |
| `chrona_goal_action` | Future closed actions for review, applying confirmed changes, configuring approved routines, feedback, pause/resume/stop; permission-sensitive actions require trusted consent evidence |
| Existing Task operations | Reuse canonical Task/occurrence execution and result reads; extend narrowly rather than duplicating them under Goals |

Finalize exact schemas and tool grouping in phase 1. All writes need operation
identity, workspace/Goal ownership, expected revision, validated input, audit,
and durable receipts. Dry runs must neither write nor invoke paid providers.
Identical transport retries reuse the same request identity; changed intents do
not. Semantic similarity may suggest a duplicate, but must not silently merge
unrelated Goals. Concurrent equivalent activations must not create two routines.

Preserve the boundary between external `/api/mcp/management`, run-scoped
`/api/mcp`, and run-token agent control. A provider executing a task must not gain
management authority to alter its parent Goal or grant itself permissions.

Publish a portable skill with one verified reference host first. Installation
and credential enrollment remain explicit user operations. A second real host
is the portability gate before claiming cross-agent support; mocked tool calls
alone are insufficient. Do not automatically alter global agent configuration.

## 6. Workstream B: natural-language permissions with real enforcement

### User contract

Store and show both the user's original wording and the confirmed interpretation.
For example:

> Search public PhD openings using my selected application notes. Save a shortlist
> in this Goal and send a brief to my chosen channel. Do not upload the full CV,
> contact supervisors, or submit applications. Ask before accessing other files.

The user sees a natural-language explanation of what can happen automatically,
what needs a decision, and what will never happen under this grant. They need
not author JSON, tool allowlists, or internal policy IDs.

Distinguish **requested authority** from **granted authority**. A task can explain
why it needs another resource; that explanation never grants access.

### Interpretation and confirmation

1. A bounded AI feature proposes a structured interpretation from the wording.
2. Closed-schema validation rejects unknown actions and unresolved resources.
3. Deterministic checks detect contradictions, excessive scope, unsupported
   enforcement, and missing processing/disclosure consent.
4. The user reviews a plain-language rendering of the actual candidate policy,
   including material changes from the previous version.
5. A trusted confirmation binds that exact revision/hash, identity, scope, and
   expiry. Changed wording or compilation requires a new confirmation.

A model-produced `approved: true` or quoted conversation is not proof of human
consent. Initial portable confirmation uses an authenticated Chrona review
surface. A host-native approval UI may replace the extra navigation only after
its consent mechanism is verified independently of model-controlled arguments.
The confirmation link must not embed credentials or itself grant permission.

Ambiguous requests such as "handle my applications" remain proposals until
clarified. Reading a document, sending it to a model provider, putting phrases
from it into a public search query, and sending it to another person are distinct
data uses. Explain permitted remote model processing; "do not upload" must not
be silently narrowed to "do not publish on a website."

### Internal constraints

The implementation must represent, at minimum:

- Principal/client, workspace, Goal and optional Task scope.
- Allowed action categories and concretely resolved resources/destinations.
- Permitted model processing and external disclosure, including notification data.
- Automatic versus ask-first actions, explicit denials, expiry and revocation.
- Frequency, concurrency, run/time/token limits, and any supported cost limit.
- Policy version, interpretation provenance, confirmed wording, and consent fact.

Use the smallest closed vocabulary needed by the pilot. Do not build a general
policy language or role-management product. Secrets remain referenced through
existing credential mechanisms, never embedded in permission prose or skills.

Effective authority is the intersection of installation/client authority,
confirmed Goal grant, Task-specific restrictions, current lifecycle/revocation,
and the provider's actually enforceable capabilities. Explicit denials win.
Tasks and child work may narrow authority; widening requires fresh consent.

Pin the approved upper bound at dispatch and recheck current restrictions before
protected actions. Later restrictions/revocations take effect on subsequent
actions; a later broader grant does not silently expand an in-flight run.
Cooperative cancellation cannot undo an already-sent request or external effect;
report that boundary rather than promising instantaneous rollback.

### Management and provider safeguards

Current enrollment exposes `read`/`full` profiles over management scopes; full
access includes sensitive control and approval operations. Do not give the
proactive skill a broad token and rely on its instructions not to self-approve.
Add explicit least-privilege enrollment/operation checks for proposals and
approved routines. Keep trusted administrative consent separate from delegated
execution credentials. Existing clients require a documented compatibility and
opt-in migration path; never silently widen their scopes.

Apply standing-policy checks in engine use cases and execution boundaries, not
only the new MCP routes. Legacy HTTP/MCP actions must not bypass restrictions on
Goals enrolled in this mode. An intentional administrative override, if supported,
is a separate explicit audited operation, not an implicit consequence of a token.

Certify one existing provider/tool path against the pilot's policy. If its native
shell, network, tools, or inherited extensions can bypass the restrictions, use a
restricted tool surface/sandbox supported by that runtime, or mark unattended
execution unsupported. Do not weaken the grant or silently switch runtimes.
A prompt, `toolMode` label, or tool-call trace alone is not enforcement evidence.

Hard monetary caps require enforceable accounting/reservations or provider-side
limits. If unavailable, offer honestly labelled estimates and enforceable run,
concurrency/time/token bounds; do not advertise an exact billing cap.

## 7. Workstream C: persistent context and monitoring state

Reuse Operational Brief, Working Set, selected assets and existing memory
facilities where their contracts fit. Do not create a second user profile store.
Keep stable confirmed preferences separate from temporary Goal strategy and
individual finding decisions. A rejected lab must not become a global ban on its
country unless the user says so.

Each reusable fact needs provenance, scope, last verification, uncertainty, and a
correction path. Source selection must be visible. Full conversations, raw tool
payloads, secrets, and unrelated files are not background context by default.

### First workflow's persistent ledger

Track position identity/source, recruitment round where applicable, first/last
seen times, verified deadlines, funding/eligibility evidence, matching rationale,
user disposition, and material changes. Read the user's existing application
tracker through an approved access path; do not build a replacement tracker or
write back without a separate grant.

Use deterministic identity/canonicalization and versioned comparisons. URL
normalization must not discard fields that distinguish recruitment rounds.
Store verified facts separately from model fit judgments and unknowns. Absence
from one search is not proof that an opening closed. Blocked or failed sources
must not produce a "nothing new" success summary.

Commit ledger updates with occurrence identity and optimistic version checks so
retries/concurrent runs cannot duplicate findings or overwrite newer feedback.
Reuse versioned GoalAssets/artifacts when sufficient; add dedicated operational
storage only if atomicity, query or uniqueness requirements justify it.

Machine observations are not user-accepted results. Routine deduplication may
consume committed validated observations with explicit provenance; review must
not silently promote them to accepted GoalAssets or completion evidence. Extend
review inputs narrowly if current accepted-result-only snapshots cannot express
this distinction. Publishing a finalized digest also does not accept a result on
the user's behalf.

Start with one versioned monitoring recipe using existing bounded Tasks/plans.
Keep PhD-specific fields and source rules out of generic scheduling and provider
contracts. Extract common monitoring mechanisms only after a second real workflow
shows the shared requirement; no recipe marketplace is needed.

## 8. Workstream D: bounded proactive operation

### Standing routine

Reuse existing Tasks, triggers, occurrences and leases to represent a confirmed
routine: objective, selected inputs, schedule/event rule, policy reference,
output expectation, change threshold, resource limits, and stop conditions.
Do not introduce a permanently running Goal provider session.

The loop is:

1. Deterministically check eligibility, lifecycle, last progress, freshness,
   duplicate work, provider readiness, and budget before paying for reasoning.
2. When due or materially changed, run bounded review/search work with the scoped
   context and authorization.
3. Decide among **no action**, **execute already-authorized work**, or **propose a
   change requiring consent**. A legitimate no-change result must not require an
   invented finding or action merely to satisfy a completion schema.
4. Persist observations and finalized outputs with source and occurrence identity.
5. Evaluate meaningful changes and disclosure policy; enqueue or delegate delivery.
6. Record the next eligible check without creating a private second scheduler.

Adapting keywords or fit ranking within the confirmed search scope can be
automatic. New data sources requiring permissions, broader destinations, larger
budgets, contacting people, or new classes of work require a reviewed change.
Cooldowns and material-change keys prevent repeated suggestions after rejection.

### Timing, pause and recovery

- First pilot must use explicitly supported timing. Current management UTC
  recurrence can support an agreed UTC cadence displayed in the user's zone;
  arbitrary DST-aware wall-clock promises require a separate verified change.
- For observational monitoring, propose coalescing missed runs into one fresh
  check after recovery rather than replaying every missed interval. Confirm and
  persist this behavior; do not apply it to unrelated legacy task types.
- No overlapping monitor run by default. Bound retries and distinguish transient
  transport errors, missing credentials, blocked sources, and unknown execution.
- Reuse restart/lease/epoch protections. An uncertain external effect is not
  automatically replayable just because the scheduler restarted.
- Pausing standing work prevents new starts and pending publication; cancelling
  active work is an explicit, separately reported action. Revocation prevents
  further protected actions; already-committed external effects remain recorded.
- Stopped/achieved Goals do not silently reactivate. Resuming rechecks policy,
  expiry, credentials, stale proposals, and the missed-run policy.
- Diagnostics distinguish service availability, executor/tool access, work success,
  result readiness, and channel availability. Chrona cannot notify about its own
  total outage unless an independent external monitor is configured.

## 9. Workstream E: reuse-first result delivery

### Selection study before implementation

Evaluate the user's existing agent channel first, then maintained notification
projects/adapters. Candidate starting points are [ntfy](https://docs.ntfy.sh/),
[Gotify](https://gotify.net/docs/), and
[Apprise](https://github.com/caronc/apprise). These are research candidates, not
verified dependencies or a preselected vendor.

Use current upstream documentation/license and a bounded prototype to compare:

- Works when the originating agent conversation and Chrona browser are closed.
- Reuses the user's desired device/channel without unnecessary infrastructure.
- Maintained, suitable license, self-hosted/hosted privacy and operational cost.
- Authentication, destination binding, payload/attachment limits and redaction.
- Queue durability, idempotency, retry/backoff, expiry and receipt semantics.
- Behavior on timeout after acceptance, duplicate requests and channel downtime.
- Whether callbacks require new public ingress; avoid that in the first slice.
- How result links work from the recipient device. A localhost link is not a
  remote-access solution; do not expose Chrona publicly as an incidental fix.

Select one transport and record the reuse-versus-build decision before phase 4.
Prefer an existing reliable service. If a maintained adapter covers transport,
reuse it; write only Chrona-specific policy and state integration. If no acceptable
channel is available, leave results inspectable in Chrona and label the delivery
gate blocked, rather than claiming the always-on assistant is complete.

### Chrona-owned behavior

- Decide whether a finalized result, required decision, or sustained failure is
  worth notifying. A successful background run alone is not a notification reason.
- Use quiet hours, digest frequency, relevance thresholds and suppression keys.
- Bind each message to an authorized recipient/destination and output version.
- Default to a minimal redacted summary and an access-controlled result link;
  attachments or sensitive details require explicit disclosure permission.
- Recheck current policy before send. Do not notify unfinished/failed result
  composition as a completed report; progress/error notices must say what they are.
- Preserve enough durable state to reconcile a restart between result commit and
  sending. Use the existing job mechanism or a minimal transactional outbox if
  required. Do not duplicate an external durable queue without a demonstrated gap.
- Separate queued, channel-accepted, failed/uncertain, and channel-confirmed
  delivered facts. Human read state exists only when reliable evidence is supplied.
- Retry with a stable idempotency key where supported. When acceptance is unknown
  and the channel cannot deduplicate/query, expose uncertainty and a deliberate
  retry policy; do not promise exactly-once delivery.
- Notification retries must not rerun the search. Credential recovery must not
  flush expired or revoked messages indiscriminately.

Inbound replies are deferred unless the selected channel already supports an
adequately authenticated, scoped flow. A received message is untrusted input,
not authority to change permissions. MCP or the existing Chrona UI can handle
pilot feedback and decisions without adding a public webhook endpoint.

## 10. Minimal persistent contracts and compatibility

These are required facts, not a mandate for one new table per row. Reuse existing
records where their ownership, versioning and transactional guarantees fit.

| Fact | Minimum requirement |
| --- | --- |
| Proposed ongoing commitment | Goal/draft reference, source/rationale, bounded context, unresolved questions, revision, decision |
| Confirmed authority | Original wording, validated interpretation, consent principal/evidence, policy version/hash, scope, expiry/revocation |
| Standing routine | Existing Task/trigger references, input/policy revisions, cadence, limits, catch-up policy, publication expectation |
| Monitoring observation | Occurrence/source identity, verification state, comparison key/version, provenance, user feedback linkage |
| Publication/delivery | Finalized result/change reference, disclosure/destination binding, idempotency key, status, attempts and supported receipt |

All agent-readable views remain bounded and secret-free. Commands, observations,
proposal retention, delivery metadata and context copies need documented retention,
export/deletion behavior. Do not imply deleting a Task already deletes all
management/audit receipts; inspect existing semantics and add explicit handling
where this initiative creates new personal data.

Existing manual Tasks and ordinary execution must continue working. Standing
policies are opt-in; never reinterpret old task descriptions as grants or start
new recurring work during upgrade. Existing management tokens do not silently
acquire new scopes. Public schemas reject unsupported versions and unknown kinds.

Schema work follows [AGENTS.md](../../AGENTS.md): preserve shipped migrations,
use the one current unreleased release-line migration, and register checksum-keyed
amendments for known non-disposable development databases when required. Verify
the actual release metadata at implementation time rather than copying an old
migration folder name from this plan. Unknown drift remains a hard failure.

Changes touching permission/auth, provider contracts, engine semantics, secrets,
networking or deployment require explicit approval. The subsequent phase-1
approval covers local Goal-capture management scopes and isolated tests, not
standing grants, provider enforcement changes, deployment or migration of the
user's database. Obtain the remaining approvals at their implementation gates.

## 11. Development sequence and exit gates

Progress is recorded in the implementation-status section above. The phases below
are acceptance targets, not a background execution queue. Each implementation slice should be independently reviewable, with a
small diff, focused tests, and an explicit compatibility statement.

### Phase 0 — baseline and reuse decisions

**Deliver:** verified capability matrix for the actual deployment, one selected
execution path, source/file access design, a delivery candidate comparison, and a
pilot protocol with user-confirmed limits.

- Check installed version, provider/tool readiness, source versus deployment
  differences, recurrence semantics, and restart behavior.
- Test candidates with fixtures/local fakes first. Real model calls, notification
  test sends, new credentials, installation and deployment require approval.
- Select the delivery channel and provider enforcement strategy; record known
  unsupported capabilities instead of compensating with broad permissions.
- Confirm first host, allowed sources/files, model processing, timing, budget,
  recipient and retention. Do not search unrelated private tasks or files.

**Exit:** each prerequisite has either a verified existing path or a bounded,
reviewed implementation slice in the phases below. Unknown enforcement or
transport guarantees remain blockers, not assumptions. No unattended work is
activated in this phase. Do not expand into a generic platform to avoid making
a decision; estimate effort only after these spikes.

### Phase 1 — Goal-aware MCP and portable capture skill

**Depends on:** baseline contract inventory; no unattended execution yet.

**Deliver:** bounded Goal discovery/read/proposal operations, contract/capability
versioning, idempotent draft/change receipts, and the repository-owned skill.

- Reuse engine Goal use cases and existing review surfaces.
- Add least-privilege read/proposal enrollment; opt-in `assistant-edit` additionally
  grants content edits, not execution or grant approval. Existing presets remain
  unchanged.
- Maintain existing Goals, not just a capture inbox: explicit user-requested edits,
  preview/confirmation for inferred material edits, revision conflicts, attributed
  progress/decision history and frozen existing Task context. Content-edit consent
  is conversational in this milestone; trusted permission grants belong to Phase 2.
- Provide positive and negative examples, offline handling, duplicate lookup,
  explicit invocation and safe retry behavior in the skill.
- Verify a real reference host's discovery and MCP calls without automatically
  installing into the user's global agent configuration.

**Exit:** a conversation can produce one inspectable proposal, repeated delivery
cannot duplicate it, and neither a proposal nor a task description starts work.
Record host-trigger misses honestly; a skill cannot promise universal recall.

### Phase 2 — natural-language consent and enforcement

**Depends on:** phase 1; requires permission/auth/provider-boundary approvals.

**Deliver:** policy interpretation, natural-language review, trusted confirmation,
versioned grant/revocation, Task narrowing, and one enforced provider/tool path.

- Test schema validation and policy evaluation without models first.
- Add plain-language pending/approved/ask-first/unsupported explanations to the
  existing Goal/Task controls; keep product authority out of AI-authored UI.
- Close bypasses through old HTTP/MCP routes, child work and provider-native tools.
- Implement concurrent budget reservation where caps are claimed, plus explicit
  unsupported/estimate-only behavior where actual provider usage is unavailable.

**Exit:** adversarial tests prove that the agent cannot self-approve, widen scope,
read another Goal's resources, disclose forbidden data, or continue protected
operations after revocation. Unsupported enforcement blocks unattended work.

### Phase 3 — persistent PhD monitoring and bounded reviews

**Depends on:** phase 2; requires applicable schema/engine approvals.

**Deliver:** one monitoring recipe, persistent ledger, source verification,
change detection, feedback updates, approved recurring execution, and no-op review.

- Reuse current trigger/occurrence workers and recovery machinery.
- Connect due-review events to explicit routine behavior; avoid empty wake loops.
- Separate operational observations from accepted results and user decisions.
- Implement the declared timezone, missed-run, overlap, stale-result and stop rules.
- Read the existing application tracker as a selected input, without replacing it.

**Exit:** fixture runs demonstrate first discovery, no-change silence, a changed
opening/deadline, feedback-informed filtering, source failure, and recovery without
duplicate findings or an accidentally completed recurring series.

### Phase 4 — one reused delivery channel

**Depends on:** phase 0 channel decision and phase 3 finalized outputs; adapter
research can proceed earlier, but publication cannot bypass phase 2 policy.

**Deliver:** selected integration, minimal durable send/reconciliation state,
disclosure checks, quiet/digest rules, and visible receipts/failure recovery.

**Exit:** receive one explicitly approved real pilot message with the originating
agent/browser closed. Simulate restart, revoked recipient, acceptance timeout and
channel outage; delivery retry never reruns monitoring. Unsupported receipt
states remain unknown, not fabricated success.

### Phase 5 — end-to-end pilot and release

**Depends on:** phases 1–4.

**Deliver:** an opt-in, approximately two-week PhD-monitoring pilot, operating
instructions, validated upgrade/recovery, and an evidence-based ship/adjust/stop
decision. The pilot duration is a proposed evaluation window, not a delivery-date
or automatic spending commitment.

- Start with one Goal, one routine, one provider and one channel.
- Use actual approved sources and the user's corrections; retain bounded evidence.
- Close the everyday agent and Chrona browser for scheduled tests.
- Test pause/resume, credential loss, budget exhaustion, service restart and
  channel recovery deliberately within the approved scope.
- No outreach, application submission, real destructive file operations, or
  unapproved external test messages are part of acceptance.

**Exit:** all safety/reliability gates pass and the owner judges the outputs useful
enough to outweigh review/maintenance effort. A technically successful but noisy
or unhelpful pilot is not a product success.

### Phase 6 — validate generality, then expand only where needed

**Depends on:** a useful pilot, not merely merged code.

Verify a second everyday-agent host and one adjacent workflow, such as relevant
paper monitoring or application-deadline changes. Reuse the same Goal/policy/
activation/delivery loop. Extract shared recipe abstractions only from real overlap.
Add context connectors, adaptive action types or more channels only against a
specific unmet need. General calendar intelligence, broad UI redesign and provider
expansion remain independent proposals, not prerequisites of this plan.

## 12. Acceptance and test matrix

| Area | Required cases and observable result |
| --- | --- |
| Intent recognition | Sustained search leads to a proposal; one-off questions and explicit refusal do not create automation; evidence and uncertainties are shown |
| Multi-agent capture | Same-intent retries are idempotent; concurrent candidates prompt reuse/reconciliation; cross-workspace reads/writes fail |
| Consent | Ambiguous scope asks; quoted "approval" and model-generated consent fail; changed policy needs new confirmation; broad legacy clients do not bypass standing-mode checks |
| Permissions | Allowed read/search succeeds; unselected files, disclosure, arbitrary shell, hidden child tools, new recipients and application submission are blocked |
| Lifecycle | Closing the chat does not stop approved work; pause prevents new starts; stop/expiry/revocation persists across restart; active-operation limitations are visible |
| Recurrence | First occurrence completion does not terminate the series; no overlap; missed-run policy and supported timezone semantics are verified |
| Monitoring | Stable identity/round separation, no duplicate findings, changed evidence, unknown versus expired, feedback scope, partial source outage and concurrent ledger updates |
| Prompt injection | Search pages, emails, notes, tool outputs and notification replies cannot change goals, grants, system instructions or destinations |
| Result state | Execution complete but finalization pending/failed does not send a completed digest; machine observations are not falsely user-accepted |
| Delivery | Quiet/no-change suppression, redaction, destination revocation, timeout uncertainty, retry/idempotency, restart reconciliation, accessible authorized result link |
| Budget | Concurrent admission respects enforceable caps; unknown usage is reported; provider limits are not exaggerated |
| Recovery | Lost provider credentials, offline executor, uncertain dispatch, stale events and channel outages each have a clear next action without silent duplicate execution |
| Compatibility | Existing manual/AI Tasks, MCP clients, Goal assets, approvals and ordinary schedules retain their documented behavior |
| Privacy | Minimal context transfer, secret-free logs/receipts, retention/export/deletion behavior, explicit remote model processing and recipient consent |

Use deterministic unit/contract tests for state and policy first, integration
fixtures for tools/transports next, real host tests for skill loading and consent,
and finally separately approved live-provider/channel checks. Mock success does
not certify provider isolation or notification delivery.

### Product measures

Before the pilot, agree the minimum useful frequency and output format. Record:

- User-rated relevance and usefulness of new findings; reasons for rejection.
- Duplicate/noise rate and missed *known fixture* changes, without claiming full
  recall over the entire web.
- Corrections successfully affecting subsequent runs without overgeneralization.
- User interventions, setup/maintenance time, and approximate time saved.
- Provider cost/usage where available, versus explicitly unknown costs.
- Scheduled eligibility to result-ready/channel-accepted latency under declared
  availability conditions; do not imply a service-level guarantee.
- Safety violations, failed/uncertain operations and their recovery outcomes.

Fixture duplicate suppression and authorization tests must pass completely.
Real-world usefulness has a human review gate, not a manufactured precision score.
If value is weak, reduce sources/frequency, fix the specific failure, or stop the
pilot before adding features.

### Repository checks by change type

Follow [testing guidance](../zh/testing.md) and the root [AGENTS.md](../../AGENTS.md).

- Contracts/domain/state: `bun run typecheck` and targeted tests; state derivation
  and policy precedence use table-driven cases.
- Implementation release gate: `bun run typecheck`, `bun run lint`,
  `bun run test`, and applicable `bun run test:bun` / `bun run test:api`.
- MCP surface: `bun run test:feature mcp-control-plane` plus schema, auth,
  idempotency, stale revision, cross-workspace and real-client compatibility tests.
- UI foundations: `bun run check:ui-foundation`; use shadcn primitives and i18n.
  Cover empty/loading/error/blocked/waiting/completed states, not CSS alone.
- Task/schedule/navigation flows: targeted tests and
  `bun run test:e2e:desktop`; run `bun run test:e2e` when those flows change.
  Validate desktop 1440x900, tablet 1024x768 and mobile 390x844 without overflow.
- UI protocol changes: `bun run test:bun`, `bun run typecheck`, catalog/builder
  validation and fallback tests. Do not introduce json-render changes unless needed.
- Boundaries: `bun run check:boundaries` for affected package ownership/dependencies.
- Schema/release: fresh SQLite install and upgrade from the previous released
  snapshot, backup/restore and amendment checks; then
  `bun run chrona build <target>` and `bun run build:smoke`.
- Documentation-only updates: local link/path checks and `git diff --check`;
  do not claim implementation checks ran when no implementation changed.

## 13. Complexity reduction policy

No deletion backlog is created by this plan. Existing screens, plans, calendar
features, editors and providers stay unless they obstruct a concrete slice.
Lack of current investment is not a command to remove working functionality.

When a blocker appears, include in that slice's review:

1. The actual conflict or recurring maintenance cost, with a concrete example.
2. The smallest reduction: reuse, narrow a branch, hide a misleading entry,
   consolidate ownership, or remove an unused path.
3. Affected users/data/APIs, compatibility and rollback/migration implications.
4. Tests showing the new path works and unrelated behavior remains intact.

For example, if an existing MCP create schema forces a calendar work block for
non-calendar activation, revise that narrow contract through the canonical
occurrence model rather than rewriting all scheduling. If a generic editor does
not block monitoring, leave it alone. If a provider cannot enforce a grant, mark
that workflow unsupported before considering a broad provider rewrite.

Security defects, data-corruption risks and falsely advertised capabilities are
exceptions: triage them directly rather than waiting for a feature conflict.
Never simplify away authorization, isolation, provenance, idempotency or recovery.
Large redesigns and unsafe-area changes retain their explicit approval gates.

## 14. Rollout, rollback and decisions still required

### Rollout

- Ship versioned contracts and opt-in capabilities; no automatic enrollment,
  source scanning, standing grants, recurring jobs or notifications on upgrade.
- Back up before schema upgrades; preserve existing data and shipped migration
  checksums. Validate the packaged upgrade, not only a development database.
- Certify one provider/host/channel combination and publish its limits. A running
  Chrona service on one device does not grant access to files on another device.
- Document service availability, restart/credential recovery, budgets, pause/stop,
  data retention, result access and notification troubleshooting.
- Require explicit deployment/network/credential approval. Do not open a public
  port or install a background service merely to make a pilot link work.

### Rollback and kill controls

Provide separate stop controls for standing execution and outbound publication.
Preserve diagnostic/consent history; stop new admissions and pending sends,
request cancellation where supported, and report any uncertain in-flight effects.
Disabling the initiative must not disable unrelated legacy tasks or erase results.

Rollback code only against a compatible schema. If a backup restore is required,
stop the service first and explicitly handle post-backup user data. Never silently
downgrade a live database or replay ambiguous external effects after restore.

### Decisions to close before their implementation gates

| Decision | Due | Decision owner / default posture |
| --- | --- | --- |
| Reference daily-agent host and execution provider | Phase 0 | Owner chooses; prefer existing setup, certify enforcement rather than adding providers |
| Source/file access and model-processing permission | Phase 0 | User confirms exact scope; no whole-workspace ingestion |
| Delivery channel and existing project/library | Phase 0, before phase 4 | Compare reuse options; user approves recipient and any setup/cost |
| Timing, missed-run policy, budget, quiet hours | Phase 0 | User confirms; supported UTC cadence/coalesced monitoring are proposals, not silent defaults |
| Consent surface and least-privilege scope changes | Phase 1–2 | Auth/security review; independent trusted confirmation required |
| Persistent storage changes and retention | Before relevant schema slice | Reuse-first schema review under the current release-line policy |
| Any execution/provider/auth/network/deployment changes | Before each unsafe slice | Explicit human approval, separate from approval of this planning document |
| Broader workflows and abstractions | After pilot | Evidence from a second real need; no speculative expansion |

Do not invent fixed effort estimates before phase 0 resolves integration and
provider constraints. After that phase, estimate each bounded slice separately
and set an explicit development/pilot budget with the owner.

## 15. Completion definition

This initiative's first release is complete only when the approved PhD workflow:

1. Can be proposed and configured from a verified everyday agent through skill + MCP.
2. Persists one understandable Goal and an explicitly authorized standing routine.
3. Continues on the supported service/executor while the initiating chat is closed.
4. Produces source-backed, incremental results using durable monitoring state.
5. Delivers meaningful updates through one verified reused channel.
6. Applies feedback, respects limits, and stops or asks when authority is insufficient.
7. Makes failures, uncertainty, cost and recovery visible without exposing secrets.
8. Passes the safety, compatibility, release and human-usefulness gates above.

A proposal-only integration, an unverified scheduled search, or a report that the
user must repeatedly remember to retrieve is a partial milestone, not completion
of the personal-assistant goal.
