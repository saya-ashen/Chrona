# Content-first work pages

**Status: implemented in the working tree, not deployed.** The separately deployed
work-record/result integrations do not yet include this page capability. Existing
credentials are unchanged. Installation, credential enrollment and live database
migration require a separate rollout decision.

## User experience

The default home is `/:lang/home`: browse all content through user-defined
classification groups/folders, search by title, or create blank content and write
a note. [The content library](./content-library.md) replaces the earlier recent
pages feed; each placement opens the same Task, never a content copy. New pages
use the existing manual, non-automatic Task + work-record lifecycle, not a new
task system.

A manual Task opens its content-first page. Managed AI Tasks retain their existing
execution workspace and can also open `/:lang/tasks/:taskId/page`. The page shows
useful conclusions, optional tables/comparisons, questions and **My notes**. Detail
is progressively disclosed, rather than making the user decode a status console.

- **Calendar remains primary navigation.** A product-owned calendar button opens
  scheduling. A date or preference inside an authored form is only content; it
  never creates a time block, reminder, payment or execution.
- Page **More** opens source/follow-through records, result versions and review,
  and task/execution settings. Global **More tools** retains dashboard, work
  inbox, Goals, Tasks and Settings; managed task creation remains available.
- Source-reported meeting context and unresolved changes remain product-owned.
- Results are reviewed separately at `/results`. Form submission does not accept
  a result, complete a Task, or confirm Goal achievement.
- Notes and answers persist through reloads. Unsaved navigation prompts preserve
  drafts. Transport-unknown writes retain their original UUID and arguments;
  revision conflicts require explicit comparison and reconciliation.
- Updating an authored page preserves notes. Previous-version form answers remain
  in history; the new form does not inherit old answers without a new submission.

This is a bounded compositional page system, not an unrestricted Notion editor.
Users write notes and answer forms; Agents compose the versioned page. Advanced
result composition includes JSON validation and a read-only page preview.

## Authoring contract

A page is optional `TaskResultVersion.content.page`. It accompanies semantic
`outcome`, `readiness`, findings, decisions, caveats and next actions. Publication
uses the existing immutable result writer; no Provider, Plan, Run or second
result hierarchy is introduced.

The isolated json-render catalog in `packages/ui-protocol/src/work-pages/` accepts
only literal trees with these components:

| Component | Purpose |
| --- | --- |
| Section | Heading, summary, stack/columns, optional collapse |
| Text / Callout | Escaped text, contextual explanation or uncertainty |
| Table / Comparison | Bounded inline data; local sorting/filtering or options |
| Metric | Deterministic sum/count/min/max over numeric data |
| Link | User-clicked HTTP(S) link, no credential-bearing URLs |
| Form | Version-bound typed fields and optional conditional visibility |

Fields support text, textarea, number, select, multiselect, checkbox and real ISO
dates. Conditions can reference only an earlier field in the same form; hidden
values are discarded by server validation. A required checkbox asks for a boolean
answer, not mandatory agreement or legal consent. Arithmetic overflow produces no
metric rather than a misleading total.

No HTML, CSS, JavaScript, expressions, event handlers, remote datasets, arbitrary
API/SQL actions or runtime-control catalog components are accepted. Product
controls, authorization and writes stay in the host. Text/source labels are not
permission grants. Validation checks structure, not the truth of an Agent's claim.

Limits: 128 elements, tree depth 12, no orphans/cycles/shared children; 12 datasets,
200 rows × 12 columns each; 8 forms × 30 fields. Keys are bounded safe identifiers.
The entire result request remains <=96 KiB; large material belongs in separately
authorized result files. No automatic provider call or external Agent wake occurs.

## MCP authority and workflow

New scopes are **explicit**, not additions to old `full`, `results-*` or `work-*`
presets:

- `pages-read`: tasks:read, results:read, pages:read.
- `pages-author`: tasks:read, results:read/write, pages:read/write.
- Neither can record user answers, review/accept results, create Tasks, upload
  files, invoke execution, or grant further authority. Combine capabilities only
  through an explicitly reviewed enrollment. Never bypass scope denial using
  owner HTTP or a browser session.

`chrona_context_read.capabilities.workPages` reports effective permissions and
flags. New tools share the same workspace/Task/occurrence checks as results:

| Tool | Input and behavior |
| --- | --- |
| `chrona_page_catalog` | Task scope; returns the current machine-readable catalog |
| `chrona_page_validate` | Scope + candidate page; bounded issues, no writes |
| `chrona_page_read` | Scope; current/history, optional exact version and kind, pagination |
| `chrona_result_submit` | Existing result publication, now with optional page |

Adding **or removing** a page requires pages:read/write. Legacy result readers
receive semantic content without the page or user inputs. Reviewing a page-bearing
version also requires pages:read; old review authority does not authorize reviewing
content that credential cannot read. Idempotent replay rechecks current authority.

The [Agent skill](../../packages/skills/chrona-pages/SKILL.md) teaches the full loop:
read existing result and review feedback → read all notes/current and historical
answers → obtain catalog → compose and validate → publish with observed revision
and stable retry UUID → read back → return the page link. Before interpreting an
old answer, read its exact version and form definition. Never treat a reused field
key with changed meaning as the same question.

### Flags

- `CHRONA_WORK_PAGES_WRITES_ENABLED=true`: page publication/removal and owner
  notes/answers. Default off; reads and validation remain available.
- `CHRONA_RESULT_WRITES_ENABLED=true`: still required for result publication/review.
- `CHRONA_WORK_WRITES_ENABLED=true`: still required for blank page/work capture.

Turning flags off does not delete saved data or revert schema. These flags do not
grant capabilities to a credential. Page input authority is internal owner-only
`pages:respond`; it is deliberately absent from enrollable MCP scopes.

## Owner HTTP and persistence

Under existing authenticated `/api/results` owner routes:

- `POST /page/catalog`, `/page/validate`, `/page/read` mirror the shared read APIs.
- `POST /page/input` takes `taskId`, optional `occurrenceId`, UUID `requestId`,
  nullable `expectedRevision`, and one action:
  - `{type: "note", noteId: UUID, text}`;
  - `{type: "respond", versionId, formKey, answers}`.

Existing API-key/local-owner and origin checks, JSON/body limits and in-transaction
reauthorization remain in place. “Owner” is authority, not proof a human personally
performed a request. A network-trusted owner API is not a sandbox for restricted
Agents; public authentication/network redesign is outside this slice.

`TaskResult.inputRevision` is separate from result `editRevision`:
`page-input-v1:<resultId>:<revision>`. A first note may create an empty result
container, but never fabricates a result version. Re-read the result revision
before later publication. Exact-head form submissions validate on the server.
Stale forms fail; unknown outcomes remain unknown until identical replay/readback.

`WorkPageInput` is append-only history. Editing a note appends to its stable note
UUID; editing answers appends to the exact version/form key. Current projection
selects the newest entry per key; history preserves earlier values. Notes are
cross-version, answers are not. `WorkPageCommand` records actor-bound UUID payload
hash and durable receipt. Both are scoped to the owning TaskResult and protected
by immutable/scope triggers. Input events contain metadata only, not private text.

Limits: 8,000-character notes; 32 KiB normalized input; 2,000 entries/result and
20,000 retained command receipts/workspace. Reads return <=20 entries/request and
trim to an 80 KiB entry budget with a resumable `nextOffset`. Quotas fail explicitly;
there is no silent pruning. Closed work is readable but not writable. These are
not a high-volume general database or a conversation archive.

The sole mutable release migration has an additive `inputRevision` column plus
two tables. `pre-work-pages.sqlite` and the checksum-keyed `6ade2bf6…` amendment
preserve the pre-page development schema/data. All recognized development paths
reach the same fingerprint; released SQL remains immutable. See [migration
rules](./migrations.md); a binary-only downgrade is not a safe rollback procedure.

## Run the isolated fictional demo

From the repository root, with dependencies and generated Prisma client present:

```sh
# Parent must exist. The target itself must NOT exist (no reset/reuse).
bun run scripts/demo-work-pages.ts --data-dir /tmp/chrona-pages-demo-NEW
# Use the same absolute directory printed by initialization:
bun run scripts/demo-work-pages.ts --serve --data-dir /tmp/chrona-pages-demo-NEW
```

The script also seeds explicitly fictional Topic/Ownership classification groups,
Agent-created folders and placement receipts. Open `http://127.0.0.1:43200/zh/home`
to browse both paths to the same computer page. These sample rules are demo data,
not default classifications or a claim about the user's real preferences.

The script refuses existing directories, initializes only a new private SQLite
DB, creates one non-automatic manual Task and one fictional external page, and
asserts zero Providers/Plans/Runs/execution sessions/reviews/time blocks. Startup
uses a fresh environment, explicit demo config/DB, loopback ports **43200/43201**,
and disabled provider-debug/orchestration/AI-summary capabilities. It does not
issue credentials, start automatically, reset user data or contact shops. Stop
with Ctrl-C; demo notes remain in that directory. Do not expose this owner demo
to a network or enter sensitive information.

Try this sequence:

1. Open the printed page link. Read the parts and budget; expand the two options.
2. Choose “再等等”, enter a date and a thought, then save. Write a separate note.
3. Reload. Both are persisted; no purchase, reminder or time block exists.
4. Open **More → results** to inspect the exact version. Acceptance is separate.
5. Visit Home, create another page and start typing; visit Calendar and More tools
   to verify advanced functionality remains discoverable.

The fake prices (9,260/9,680) and requirements are UI examples, not real research.
`packages/skills/chrona-pages/examples/pc-plan.json` is the validated authoring
sample. Automated tests exercise a second independent reader and publication of
v2 without losing human notes or the v1 answer history:

```sh
bun run typecheck
bun run test
bun run test:e2e:pages
bun run test:e2e:work
bun run test:e2e:results
bun run check:ui-foundation
bun run check:boundaries
bun run check:release-consistency
bun run lint
bun run chrona build linux-x64
bun run build:smoke
```

## Deliberate remaining boundaries

No arbitrary HTML hosting, AG-UI/A2UI adapter, automatic notifications/Agent wake,
form-driven domain actions, cross-version answer migration, legacy Run result
convergence, or external-result promotion to Goal assets is claimed. This version
is not production-deployed or installed into the everyday Pi connection. A live
rollout needs a frozen reviewed build, backup/migration rehearsal, explicit flags
and least-privilege enrollment. Ordinary-user usability still needs human feedback;
passing E2E is not proof that everyone understands the interface.
