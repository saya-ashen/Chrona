# Coding command protocol

Both `coding.command({input: JSON.stringify(command)})` and HTTP dispatch call `handleCodingCommand(context, command)`. A routed `chrona.call("coding.command", {input: ...})` returns the handler output directly (e.g. `{receipt}` or `{sessions}`). The SDK event return wraps it as `{result: <handler output>}`; this wrapper is consumed by routing. HTTP returns `{result: <handler output>}`. Only authenticated owner / routed owner-admitted applications may call the tool; no Provider relay.

All command objects are strict: fields not listed below are rejected. No client identity, selected conversation, draft, cwd, or Agent tool name is accepted. IDs/request keys match `[A-Za-z0-9][A-Za-z0-9._:-]*`, max 100 chars. Text max 20,000 chars; answer text max 8,000; path max 4,096; title max 200; create name matches `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`. Whole command max 32 KiB UTF-8. Ordinary send text must be nonblank; answer text may be empty or whitespace. No text may contain NUL.

| op | Required fields besides op | Optional fields | Handler output |
|---|---|---|---|
| `projects.list` | — | — | `{projects:[{projectRef,path,label}],defaultProjectRef:string|null}` |
| `projects.register` | `requestKey,path` | — | `{receipt}` with `value` a direct project |
| `projects.create` | `requestKey,name` | — | `unsupported`; no configured Coding project root |
| `projects.default` | `requestKey,projectRef` | — | `{receipt}` with `value:{defaultProjectRef}` |
| `conversations.list` | — | `projectRef`, `after` (session ID), `limit` (1..100, default 50) | `{sessions:[Session],after:string|null}`; follow `after` for subsequent pages |
| `conversations.create` | `requestKey,projectRef,title` | — | `{receipt}` with `value:Session` (does not start execution) |
| `conversations.get` | `sessionId` | `before` (history cursor), `workBefore` (round-list cursor) | `{session:Session,view:ExecutionView|null,history:HistoryPage}` |
| `round.send` | `requestKey,sessionId,workId,text` | — | `{receipt}`; `workId` is the expected current work ID, **null** for first send |
| `round.retry` | `requestKey,sessionId,originalRequestKey` | — | `{receipt}`; recover an unresolved send/answer/stop/accept through the original call receipt; value is `{receipt:<original receipt>}` |
| `round.stop` | `requestKey,sessionId,workId,runId,attemptId` | — | `{receipt}`; accepted means stop requested, inspect view for actual stop |
| `round.answer` | `requestKey,sessionId,workId,runId,attemptId,questionId,text` | — | `{receipt}`; confirm text `是`/`否`, select text equals option |
| `events` | `sessionId,workId,runId,attemptId` | `cursor`, `limit` (1..100, default 100) | Coding projection (`events,cursor,highWatermark,gap,snapshotRequired`); opaque kernel cursor unchanged |
| `snapshot` | `sessionId,workId,runId,attemptId` | — | Coding `ExecutionSnapshot` projected from generic `read` |
| `results` | `sessionId,workId` | — | `{results:[ExecutionResult]}` |
| `read-result` | `sessionId,workId,resultId` | — | `{base64,mime:"application/json"}` after scoped immutable result lookup |
| `accept` | `requestKey,sessionId,workId,resultId` | — | `{receipt}` with `value` the existing acceptance response |
| `receipt` | `requestKey` | — | `{receipt}` or `not_found` |

`Session` = `{id,title,projectRef,workIds,currentWorkId,worksBefore,turns,hasEarlierTurns}`. `workIds` holds at most 100 rounds; `worksBefore` is null or the cursor for the preceding rounds, passed as `conversations.get.workBefore`. `turns` contains `{key,kind,workId,text,createdAt,accepted,rejected?,questionId?}`, bounded to the most recent 32 KiB within that round page; full text remains available through paged history. List responses omit turn bodies (`turns:[]`); `hasEarlierTurns` makes omission explicit. List pages also stop at 96 KiB. No transcript or round is deleted by pagination. `currentWorkId` is persistent business round identity, not client selection. `HistoryPage` = `{messages,hasEarlier,before,limited,snapshot:ExecutionSnapshot|null,snapshotOmitted:boolean,progress:[{sequence,text}]}`. Message bodies are paged at 96 KiB; recent progress is capped at 32 KiB and older omitted progress sets `limited:true`. Snapshots over 32 KiB encoded are omitted (`snapshot:null,snapshotOmitted:true,limited:true`); the explicit snapshot command can fetch smaller snapshots or report `too_large`. ExecutionView includes `{workId,sessionId,runId,attemptId,projectRef,status,cancelRequested,stopConfirmed}`; its `sessionId` is the kernel `contextId`, distinct from Coding conversation `Session.id`. Its `attemptId` equals the kernel `runId`.

Round-send/answer receipt values are `{sessionId:<Coding conversation ID>,workId,execution:<Agent execution view or acceptance>}`. This prevents confusing the Coding conversation with Agent's `execution.sessionId`.

Projects belong to Coding's local registry (at most 100). Registration accepts an existing absolute directory and resolves its canonical path. No kernel project API is called. The selected path is prompt data, without setting kernel cwd, Provider configuration or filesystem authority.

Local `conversations.create` and `projects.default` save accepted receipt and local state in one atomic replacement. External commands save pending intent before dispatch. Kernel writes return `{accepted:true}`; malformed replies remain pending. Coded definitive pre-admission errors (`invalid`, `forbidden`, `unauthorized`, `unsupported`, `unsupported_version`, `capacity`) record rejected receipts; transport failures and conflicts remain pending.

Every encoded response, including JSON escapes, base64 and transport envelope, is bounded to 230 KiB. Oversized reads return `too_large`; output checks preserve already accepted mutation receipts. Result artifacts are bounded to 96 KiB before base64; omissions are explicitly marked in the artifact.

`Receipt` = `{requestKey,op,status:"pending"|"accepted"|"rejected",sessionId?,workId?,value?,error?:{code,message}}`. A successful mutation returns `{receipt}`. Unknown external outcomes return a pending receipt and retain the original command. Definitive validation/admission failures may throw a coded error; after persistence the corresponding rejected receipt remains queryable. Reusing a key with identical arguments returns the same receipt without re-dispatch. Changed arguments return `conflict`. `round.retry` has its own key and refers to an original pending receipt; it is the explicit recovery action. Recovery reads `callStatus` for the original target and call-options key. Missing/unavailable receipts never cause a mutation to be resubmitted. Project registration is an idempotent local canonical-path update; project creation reports `unsupported`.

Reads do not advance conversations. `round.send` continues a running round through Agent write, or starts a new attempt resuming the previous Agent session only after terminal status **and** stopConfirmed. Unknown stops block progression. After a stop response with `stopConfirmed:false`, a terminal inactive read still cannot release the fence; another explicit stop must confirm it. Every event/snapshot/answer/stop is scoped to the owning conversation and exact run/attempt. Old questions are rejected. Results and result reads are scoped through conversation → work → immutable result; accepting never commits or merges Git.

The kernel has no trusted project baseline, diff, workspace placement or cleanup API. Baseline-backed result capture and dormant workspace execution report `unsupported`; no synthetic baseline or check evidence is produced. The existing scoped immutable reader remains available for genuinely stored results. Transcript text is bounded to 8 MiB encoded in Coding history, with snapshots capped at 24,000 characters and truncation marked explicitly. Unprojected normalized events set `gap:true`; genuine matching usage payloads are projected. Missing transcript data and a full 300-entry retention window set missing evidence.

Coding uses only direct kernel `agent.run/read/write/stop` targets, with mutation keys in call options. Workflow fields and start budgets stay local; the kernel governs execution budgets. There is no current completion caller. Errors carry `code` and `message` (e.g. `invalid`, `not_found`, `conflict`, `forbidden`, `capacity`). There are no DAG, work-v2, arbitrary Agent relay, health, schedule, or UI commands.
