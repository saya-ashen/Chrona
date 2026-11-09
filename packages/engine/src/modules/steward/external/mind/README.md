# Mind backend and coordinator contract

Mind is an ordinary private follow-up application. Background checks and Notify integration start **disabled**. Installation, page registration, suggestions, links and external text grant no authority. This replaces the obsolete implementation; retained legacy `agenda.json`, `decisions.json` or `state.json` requires an explicit owner decision and is never silently ignored or migrated. There is no old API compatibility.

`index.ts` registers `MAIN_PAGE` from `page.ts` and `SETTINGS_PAGE` from `settings-page.ts`. It retries optional `web.page-set` registration after absence and on activation. Both pages use application tools admitted by the kernel; Mind adds no kernel APIs or wildcard tool declarations.

## Public tools (exact argument names)

All arguments use kebab-case. Unknown arguments are rejected. `schema.ts` exports `inputs` and `outputs`, along with `concernSchema`, `proposalSchema`, `settingsSchema`, `DEFAULT_SETTINGS`, `freshState`, and the other local persisted structs. Returned struct fields use camelCase. `manifest.ts` generates `module.json` from those local schemas. Current shared manifest contracts accept structural JSON Schema only: input bound descriptions document the local constraints, and local Zod enforces numeric, string and array bounds for all inputs, outputs and disk state. Do not add unsupported top-level `parameters.additionalProperties`.

| Tool | Arguments | Output / actual caller |
| --- | --- | --- |
| `agenda` | `{cursor?: string, limit?: number}` (1–100, default 50) | `{concerns, proposals, runtime, stats, cursor, nextCursor, limited, total}`; modules-visible, actual Mind reasoning only. No `all` argument. |
| `ui-agenda` | Same pagination arguments as `agenda` | Same output; owner-only application UI wrapper. |
| `decisions` | `{cursor?: string, limit?: number}` (1–100, default 50) | `{decisions, cursor, nextCursor, limited, total}` newest first; owner-only. Omits private `prompt`, `contextKey`, `runKey`, candidate queue and retry internals. |
| `ui-dismiss` | Exactly `request-key`, `id` | `{proposal}`; owner-only application UI wrapper dismissing one pending suggestion. |
| `note` | `request-key` required; optional `id`, `title`, `goal`, `project`, `status`, `priority`, `user-explicit`, `due-at`, `revisit-at`, `silent-until`, `expected-progress-at`, `progress-at`, `awaiting`, `links`, `proposal-id` | `{concern}`; owner-only route. No id creates a concern and needs title unless accepting a proposal. `proposal-id` accepts a pending suggestion and supplies its title/goal/project when creating. |
| `propose` | Required `request-key`, `title`, `reason`; optional `goal`, `project`, `signal-ids` | `{proposal}`; modules-visible. Produces a pending suggestion only. Authenticated sources can suggest using only their own signal ids. `id` and `action` are rejected. |
| `signal` | `request-key`, `event-id`, `event`, `ref`, `version`, `occurred-at`; optional `thread`, `from`, `domain`, `kind` (`event` default / `summary`), `text`, `progress-at` | `{signalId, associations: string[], duplicate: boolean}`. Other authenticated modules only. **No source/module-id/caller arguments**: source and moduleId come from the real caller. |
| `report` | `request-key`, `decision-id`, `result` (JSON string) | `{accepted: true, reportId, decisionId, pendingVerification: true}`. Current Mind reasoning candidate only; owner cannot forge a report. Acceptance does not mean verified or applied. |
| `check` | `{}` | `{runtime}`. Owner-only route explicitly starts one foreground review or reconciles outstanding work. It does not return/rewrite the agenda. |
| `ui-settings` | `{}` to read; optional scalar `enabled`, `interval-minutes`, `daily-wakes`, `daily-time`, `quiet-start`, `quiet-end`, `timezone`, `notify-enabled`, `feedback-minimum`, `feedback-half-life-days`, `waiting-recheck-hours` | Full Settings object; owner-only read/save. Numeric preferences are **decimal strings at the routed public boundary**, matching Web Input values; outputs retain numbers. Local service fixtures also accept numbers. Scalar saves are naturally repeatable. |

The exact owner-only routes are `ui-agenda`, `ui-dismiss`, `decisions`, `note`, `check`, and `ui-settings`. Kernel admission checks the current approved manifest before delivering an owner-only tool to a module such as Web. Only the entry passes the internal admission flag to these routes; Mind preserves the real caller identity and scopes Web receipts as `module:<web-id>:<tool>`. Calling a modules-visible route grants no owner authority. Public reasoning tools `agenda`, `propose`, `report`, and source `signal` are modules-visible; the reasoning selection remains exactly `mind.agenda`, `mind.propose`, `mind.report`. Direct local owner service fixtures may read `agenda`, but its manifest does not expose it to the owner catalog.

Agenda and decision pages measure the actual UTF-8 encoding of the complete `{result: ...}` response and stop at **230 KiB** or the requested item limit, whichever comes first. Complete records are preserved. `total` is the overall row count; agenda counts concerns plus proposals. Follow `nextCursor` until `limited` is false. Cursors bind the state revision; a concurrent mutation returns `conflict` and requires a fresh first page. The UI shows partial-page notices and first/next controls for both collections. A single oversized record fails explicitly with `capacity`. Invalid inputs, permission failures, stale cursors and full capacity cross the SDK boundary as coded `ModelError` replies (`invalid`, `forbidden`, `conflict`, `capacity`); Zod failures map to `invalid`.

Every `note`, `ui-dismiss`, `propose`, `signal` and `report` mutation requires a stable `request-key` (1–160 characters). Retry a lost response with precisely the same key and arguments; conflicting reuse fails. Do not generate a new key to retry an uncertain operation. The Web action runtime supplies request keys to keyed tools. A read can be repeated freely.

Concern status: `watching | acting | waiting-user | waiting-external | done | dropped`. Priority: `low | normal | critical`. `project` is a simple group string, not a project service or permission. New owner concerns default to `userExplicit: true`. Empty time arguments clear nullable timestamps; nonempty times must be ISO datetimes with an offset. Snooze is bounded to 30 days. Progress must describe an observation already made. `done`/`dropped` stops future automatic selection. Agent reports never change concern status.

`awaiting` is a JSON array (maximum 12):

```json
[{"source":"mail","moduleId":"mail-instance-id","event":"message-received","ref":"application-7","thread":"thread-42","from":"admissions@example.test","domain":"example.test","textAll":["received","complete"]}]
```

Every identity field is required and compared exactly without trimming or case folding. An empty thread/from/domain is an exact empty match, not a wildcard. Every optional `textAll` substring must also match (case-sensitive AND). There is no keyword routing. Awaiting entries are alternatives; all conditions within an entry are AND. One event may associate uniquely with multiple concerns. Associations trigger verification only. Signal text never authorizes or completes anything.

`links` is a JSON array (maximum 20):

```json
[{"source":"mail","moduleId":"mail-instance-id","ref":"message-42","version":"v3","checkedAt":"2026-11-09T12:00:00Z","conclusion":"Acknowledgement observed; next step remains open."}]
```

A link is metadata, never authority to call that source. Observations are fresh for seven days; a later observation of the same complete source/event/ref/thread/from/domain/kind identity supersedes older evidence (receipt order breaks identical timestamp ties). Owner edits retract associations that no longer match the current conditions. A new version must have a new `event-id`; reusing the original event-id with changed evidence fails. `progressAt` advances only from owner input or fresh, precisely associated source observations cited in a verified final report.

Report `result` JSON:

```json
{"summary":"Acknowledgement observed; follow up remains open.","concerns":[{"id":"c-...","revision":1,"conclusion":"Checked the latest acknowledgement.","signalIds":["s-..."]}],"feedback":{"newEvidence":true,"progress":true,"internal":false,"redundant":false,"unavailable":false,"userVisible":true}}
```

All six feedback booleans are required. Agent context tool calls currently retain the originating Mind module identity rather than a distinct run caller. Up to eight distinct unverified report candidates may be retained for the current decision; a candidate does not reserve the final report slot. Consequently a submitted candidate counts **only** after `agent.stream` for the persisted current run contains a successful `m_mind_report` result matching its unique report receipt, and `agent.get` confirms terminal `finished`. Model text, failed tool results, other runs and owner calls cannot establish a report. Verified receipts observed while active persist across transcript tail loss. Reports arriving after an owner revision change do not update that concern. Missing/unavailable or uncited observations never create negative feedback.

## Scheduling, recovery and UI states

`Runtime` includes `nextCheckAt`, `lastCheckAt`, `lastDailyDate`, `currentDecisionId`, `lastError`, `phase`, `runId`, `interactions`. Public phases: `idle | prepared | running | waiting | unknown`. Waiting interactions expose only id/title/message/expiry, never prefilled answers. The UI should show unknown as unresolved and retain it; do not turn it into a fresh check. Decision terminal phases are `completed | unreported | failed`. Show report conclusions as established only for `completed` with a verified report. Notification state is separately `pending | unknown | accepted | unavailable`; accepted means Notify accepted the request, not external delivery.

`Stats` is `{open, pendingProposals, unmatched, wakes24h, trustworthyReports}`. Concerns retain `revision`, `lastCheckedAt`, `lastAssessment`, `expectedProgressAt`, actual `progressAt`, timestamps and an escalation band (`none | early | day-before | final`). `Proposal` includes `id/title/goal/project/reason/source/moduleId/signalIds/status/concernId/createdAt/updatedAt`; statuses are `pending | accepted | dismissed`. No suggestion implicitly activates a concern or installs an adapter.

The keepAlive timer reconciles every 30 seconds, but persisted `nextCheckAt` controls ordinary background selection. Default interval is 15 minutes, rolling background wake budget six; explicit foreground checks do not consume it. Default daily review is 09:00 UTC, quiet hours 22:00–08:00; missed days coalesce to one current review after restart. Waiting concerns recheck after 24 hours; due bands rise at three days, one day and six hours. Manual `check` is explicit foreground work and bypasses the app background budget/quiet/snooze limits; all Agent governance still applies. At most one Mind reasoning decision remains outstanding. Pausing background does not abandon uncertain or existing runs.

Low-priority nonexplicit concerns without deadlines may defer repetitive signals to daily review only after enough recent source+kind feedback (default minimum five). Samples decay with a seven-day half-life, expire at 30 days, and need an 80% redundant share with at least half the minimum effective sample weight. Critical/deadline/user-explicit concerns are never feedback-suppressed. Unknown inputs and pending proposals go through the Agent daily suggestion path; there are no global chat reads. No suppression is permanent.

Each reasoning prompt, exact selected tools, context/run request keys and snapshot revisions is durably committed before an Agent call. Recovery polls a known run or replays the exact same context/run key and arguments. Unknown retains the slot. There is no second execution queue. Tools are exactly `mind.agenda`, `mind.propose`, `mind.report`; the manifest declares those calls explicitly. Source adapters currently use authenticated module push (`signal`, including summaries). There is no installed Events dependency, broad owner catalog, source permission inferred from links, or implicit source adapter activation. Future read adapters must be explicitly declared and authorized read-only tools.

Notify is optional and off by default. Only a verified final report with material user-visible information and available evidence can request a bounded summary. Its stable key and unknown-before-send state persist before the outbound call. Unknown sends are never repeated. The private decision exposes the receipt for inspection; delivery status belongs to Notify.

## Private state and bounded capacity

`mind-v1.json` is strict versioned state, capped at 8 MiB. Transactions serialize within the one module process across store instances. Writes validate, use exclusive private 0600 temporary files, fsync the file, rename, and fsync the directory. Corrupt schemas/JSON, symlinks and nonprivate files fail closed. A durability failure after rename blocks further actions in that process until restart. No corrupt state is reset. Request receipts are retained rather than evicted so old keys cannot create new effects.

Caps: 200 concerns, 64 pending proposals, 512 live signals, 4,096 archived event identities, 256 decisions, 1,024 feedback rows and 2,048 idempotency receipts. Terminal proposals are pruned before suggestion admission while their original request receipts remain replayable. Before live signal capacity is checked, expired or superseded signals may become durable tombstones preserving caller/event identity, fingerprint and original signal id; unfinished decision evidence and pending proposal evidence remain protected. A repeated archived event returns its original id with `duplicate: true` and no current associations; changed evidence conflicts. Tombstone saturation fails closed. Terminal prompts may be compacted by encoded byte pressure and reasoning admission reserves settlement space. Decision identities, run keys, verified evidence and receipts remain durable; feedback uses a rolling window. A full store rejects new work visibly.

## Offline verification

`test.ts` is the offline author entry. `offline.ts` checks real persistence/trust/recovery policy with injected Agent/Notify stubs. It creates fresh temporary private stores and leaves copied nonempty app data untouched, so repeated checks are safe. `offline-entry.ts` exercises the actual SDK entry with a private fixture directory, one simulated Web absence and fully stubbed Agent calls. It cannot start without an explicit offline-directory environment variable. No check uses real models, services, accounts or sends.

Generate contracts with `bun packages/engine/src/modules/steward/external/mind/manifest.ts`. Run focused author checks through Chrona's author-test loader, and `backend.bun.test.ts` through the official isolated Bun test runner. Heavy validation uses serial `flock /tmp/chrona-permanent-check.lock`; direct invocations must use an explicit temporary `DATABASE_URL=file:.../test.db`. Root typecheck and scoped ESLint cover this folder. `ui.bun.test.ts` covers page rendering, owner wrapper actions, pagination navigation, unknown submission locks and settings values. Offline checks cover actual caller receipt scope and Unicode response traversal as well as persistence and runtime trust.
