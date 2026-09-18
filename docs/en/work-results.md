# Executor-independent work results (B1–B3)

Status: **implemented; user-authorized instance deployed and externally integrated
on 2026-09-17**. Text/file publication, immutable versions, exact-version review,
authorized downloads and a deterministic task results page are implemented.
Real Pi submission/replay and file readback passed; human acceptance is pending.
This is not a public release or enablement of other installations. Managed-result
convergence and Goal Inbox reuse remain phase C. Existing execution is retained.

## Authority and opt-in

New writes require the exact server environment value
`CHRONA_RESULT_WRITES_ENABLED=true`. Default-off preserves existing results and
file reads. Disabling writes also blocks publish/review/begin/write/finish replays;
own-upload status/cancel remain available for cleanup, including after work closes.
The switch never grants scopes, enrolls credentials or starts a Provider.

| Explicit CLI `--access` preset | Scopes |
| --- | --- |
| `results-read` | `tasks:read`, `results:read` |
| `results-submit` | above + `results:write` |
| `results-review` | read + `results:review` |
| `results-files-read` | read + `artifacts:read` |
| `results-files-submit` | submit + `artifacts:read`, `artifacts:write` |
| `results-files-review` | review + `artifacts:read` |

Historical full/read/assistant presets, B2a text presets and existing credentials
are unchanged. Legacy `results:accept` is not new result-review authority.
Submission never grants review, task creation, lifecycle control or execution.
Use the existing local-only enrollment workflow **only with owner approval**;
never paste credentials into prompts or URLs.

Tasks must already exist. Use separately authorized manual/todo creation; never
create a fake Run. Auth, revocation, scopes and task/workspace/occurrence access
are rechecked inside every transaction, including replays. Inputs cannot set an
actor, workspace, Run, task status or accepted pointer. Source labels and text are
untrusted contributor data, not instructions or permission grants.

## MCP and owner HTTP

MCP: `POST /api/mcp/management`, with a scoped management bearer only. Discover
strict object-root schemas via `tools/list` and capability/limit facts through
`chrona_context_read.capabilities.workResults` (`stage: result_files`).

| MCP tool | Owner HTTP POST | Meaning |
| --- | --- | --- |
| `chrona_result_read` | `/api/results/read` | Latest, accepted or exact version; content/version/review views |
| `chrona_result_submit` | `/api/results/submit` | Publish immutable semantic content with CAS + UUID requestId |
| `chrona_result_review` | `/api/results/review` | Review exact current head with CAS + UUID requestId |
| `chrona_result_file` | `/api/results/file` | Bounded private file protocol below |
| — | `/api/results/context` | Scoped task identity/state and effective UI permissions; read-only |

`GET /api/results/capabilities` returns current owner capabilities. All POSTs
require JSON. HTTP returns shared application results directly, without the MCP
management envelope. The same application service handles both transports; Web
never fabricates a ManagementClient.

Owner HTTP follows existing single-owner policy: API key, or anonymous local
owner when no key is configured. Keep deployment loopback-only unless a key and
trusted network controls are configured. A supplied scoped/invalid bearer is
**not** reinterpreted as owner authority. Routes check trusted Origin, recheck auth
inside the transaction and return `Cache-Control: no-store`.
`human:local-owner` denotes owner API authority, not proof of human authorship.

### Versions and review

Publish takes taskId, optional occurrenceId, UUID requestId, expectedRevision,
content and optional source metadata. Read first; null revision is valid only
when no container exists. An upload may create an empty container at revision 0,
so re-read before the first publication. On CAS conflict, compare and explicitly
reconcile; never blindly adopt a new revision.

Publish/review return `{ replayed, receipt }` backed by one `ResultCommand`, not
an additional ManagementCommand. Identical actor/operation/requestId input
replays the historical receipt; changed intent conflicts. Receipts always report
`executionStarted: false`, `taskStatusChanged: false`.

Review binds versionId + expectedRevision and chooses accept/request_changes/
reject with optional feedback. Only the current head can be reviewed. Acceptance
requires source-reported ready content and verified required files; it does not
complete a Task/Goal, enqueue execution or create a Goal Inbox candidate. New
publication retains the old accepted pointer. Reviews are immutable and ordered
by result revision. `state.canAcceptContent` is not permission.

Read views support bounded pagination (`nextOffset`, `hasMore`,
`paginationLimitReached`). Exact-version reads cannot cross result scopes.
Legacy task result reads/accept actions remain Run-based, explicitly separate.

### Private file protocol

Every action includes taskId and optional occurrenceId:

1. **begin** (`artifacts:write`): new requestId, filename (not a path), MIME,
   declared sizeBytes and lower-case SHA-256. Returns stable uploadId, current
   result editRevision and expiry. Identical retries retain identity.
2. **write** (uploader only): uploadId, contiguous offset, canonical base64 and
   chunk SHA-256. Exactly 32 KiB except the final shorter chunk. Same offset/bytes
   retries are safe; overlaps, gaps, hash or changed-byte retries fail closed.
3. **status** (uploader only, `artifacts:write`): receivedBytes, terminal status,
   declared metadata, expiry and finalized AF reference/availability. Recreate
   the client after disconnect; reselect and verify the original file to resume.
4. **finish**: validates all chunks and whole-file hash, commits Artifact + bytes
   + completed receipt atomically, then removes chunks. Empty files are valid.
   Finish does not publish or accept a result. Publish with the returned AF ref
   and freshly reconciled result revision separately.
5. **cancel**: terminally cancels own unfinished reservation and removes chunks;
   never deletes finalized/published files. Terminal retries remain stable.
6. **read** (`artifacts:read`): exact versionId + artifactRef, offset and optional
   limit ≤32 KiB. Requires a stored binding to that version/scope and verified
   ownership/fingerprint/bytes. Returns filename/MIME/hash/size/base64/nextOffset,
   never an internal URI or disk path. Source `allowDownload` is not authority.

All file operations also require tasks:read/results:read. Upload identity is
actor-scoped; another contributor cannot inspect/cancel it. A finalized file can
be reused in later same-scope versions after authorization, not other tasks or
occurrences. Required missing/corrupt files block acceptance and download.

**Storage decision:** private SQLite BLOBs, not arbitrary filesystem paths.
`Artifact.ownerKind` is run/result, with exactly one real owner. Result-owned
artifacts have null runId, an internal `result-file://id`, immutable byte rows,
and an owning TaskResult. The existing AF hash algorithm and all old Run
fingerprints are preserved. Legacy Run files are deliberately unavailable to the
new production adapter until phase C; old managed file APIs still work.

Limits: 8 MiB/file; 32 MiB/distinct files/version; 256 MiB logical finalized bytes
plus pending reservations/workspace; 1024 durable upload receipts/workspace.
Pending TTL is 24h, lazily swept during begin/status/other successful upload
operations. Cancellation/expiry delete chunks but preserve receipts. Completed
unpublished files remain until explicit owning Task deletion; no automatic
attachment deletion API or receipt recycling yet. Quotas count logical content,
not SQLite/WAL physical file size. Backups contain binary content and may grow;
this is intentionally bounded small-file storage, not a general media store.

## Deterministic UI

Task workspace → **Work results** → `/:lang/tasks/:taskId/results`. Default scope
is explicitly task-level; an explicit `?occurrenceId=` selects a single instance.
The page does not load a Provider, Plan or execution context to read results.

- Task state, attributed source/readiness and accepted/latest version are distinct.
- Text and attachments can be published, reviewed and downloaded without execution.
- Version/review history is paginated; historical review controls are disabled.
- Basic text/readiness fields have normal controls. Supporting semantic collections
  currently use a validated JSON editor; existing keys/metadata are preserved.
- Conflicts retain drafts, require refresh/compare/explicit reconciliation; lost
  responses offer identical-request retry rather than a new request ID.
- Upload recovery persists only metadata/request identity in browser local storage,
  not bytes or credentials. Reselect the same file after reload. Unsaved text
  drafts are memory-only and warn on browser unload; saved versions survive restart.
- Files are downloaded as octet-stream after full hash verification. No untrusted
  HTML/SVG preview, script execution, arbitrary image fetch or source authority UI.

## Budgets, errors and release safety

Result raw/normalized JSON: 96 KiB. Legacy management inputs remain 64 KiB.
MCP raw body: 112 KiB including framing. Semantic response envelope: 128 KiB,
**not total MCP wire size** (text and structuredContent mirror the envelope).
Pages shrink by encoded bytes; stored content is never silently truncated.

Closed errors: AUTH_REQUIRED 401, FORBIDDEN 403, NOT_FOUND 404,
VALIDATION_ERROR 400 (raw overflow 413), REVISION_CONFLICT/IDEMPOTENCY_CONFLICT
409, PRECONDITION_FAILED 412, STORAGE_ERROR 500. Internal paths/auth/database
payloads are not returned in these error bodies.

Sole mutable release-line migration plus checksum-keyed amendments and exact
fingerprints cover known development states. Released SQL is immutable. See
[migration policy](./migrations.md). Nullable runId makes old-binary downgrade
unsafe; disable new writes and use a compatible reader, or restore an explicitly
approved pre-upgrade backup with understood data loss. Never rewrite new results
into fake Runs to downgrade.

The separately authorized deployment upgraded one real database and enrolled a
new submit-only credential without widening existing credentials or changing
Provider protocols. One manual deployment-review task holds an external version
and verified file; no managed execution or human review was performed.
Setup, rollout and limits: [everyday Agent integration](./work-results-integration.md).
Verification and remaining phase C scope: [phase record](../zh/work-results-phase-a.md).
