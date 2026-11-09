# Coding Web ordinary peer

Optional ordinary SDK application. It registers its own `main` workspace page on activation through `web.page-set`. It calls `coding.command` and `web.page-set`. Its checked manifest declares owner authority (`uses: ["*"]`) so authenticated owner actions can reach the owner-only Coding protocol. It declares no effects, HTTP listener or keepalive resource.

The page calls only its own owner-visible tools. Handlers accept the actual owner or the routed Web caller, then forward fixed Coding operations using `{input: JSON.stringify(command)}`. They never take a target, caller, filesystem content path or Agent operation from the caller. The kernel must still validate current module identity and tool visibility on every real call.

Projects, conversations, execution state, receipts and saved results belong to Coding. Project/conversation selection, pagination, drafts and result display belong to each browser page's state store. There are no selection preferences or client records in server data. Closing a page, stopping this process or removing this client never sends stop to Coding.

Supported UI: register an existing project, explicitly set the shared default project, page conversations, create conversations, send first/follow-up turns, read paged history and bounded progress, answer the current question, request stop, inspect receipts, explicitly retry uncertain round operations, and view scoped saved results/checks/final replies/diffs. There is no execution engine, model policy, automatic replay, Git commit/merge or orchestration here. Progress is bounded to 100 events per read; gaps, additional events, missing snapshots and truncated artifacts are marked in the UI.

Mutation keys stay in browser page state until a definitive receipt. Unknown transport failures retain the key and draft for explicit receipt lookup. Defined validation/admission failures become rejected UI results; conflicts retain the recovery path. A retry uses the protocol's nested original receipt. Drafts edited while an accepted send is in flight are retained. The page protects against showing controls from a previously selected conversation during loading.

## Offline checks

From repository root:

```sh
bun test packages/engine/src/modules/steward/external/coding-web/coding-web.bun.test.ts
NODE_OPTIONS=--max-old-space-size=2048 bunx tsc --noEmit -p packages/engine/src/modules/steward/external/coding-web/tsconfig.json
bun packages/engine/src/modules/steward/external/coding-web/browser-check.ts
```

The SDK harness uses only fake routed targets and fresh temporary directories. It validates every tool output against the strict manifest, actual caller rejection, fixed forwarding, request receipts, state derivation and removable page registration. The browser fixture uses production Web rendering and fake Coding data over loopback only. It checks desktop 1440×900, tablet 1024×768, phone 390×844, draft preservation, lost replies, questions/results, viewport fit and independent browser page selections. Set `CHRONA_TEST_CHROME` when Chromium is outside the checked system paths. No Web build is modified or required by this fixture.

## Integration handoff

Implemented against `../coding/protocol.md`; no Coding files were changed. Real routed integration is a coordinator gate, not established by the isolated fakes.

Coding and coding-web are ordinary owner applications. Current approved identity and manifest owner authority are checked by routing; installing or updating that authority follows the existing governed lifecycle. The client does not supply a caller identity or promote a principal. End-to-end acceptance is recorded in the repository implementation report.
