# Author: ordinary material authoring and local distribution

Author is an ordinary SDK application. It owns requirements, prompts, bounded source and artifact workspaces, trusted-local binary transport, local package staging and declared provenance. The kernel owns admission, actual caller identity, immutable materials, idempotent submission receipts, checks and activation. Author requests only `modules.source`, `modules.submit` and `modules.receipt`; it never calls owner admission or Agent tools and has no network effect or credentials. Owner-admitted import/export explicitly copy selected material between a trusted-local task workspace and Author private content; they grant no caller or Run authority.

`module.json` declares ten tools, with output schemas. `prepare`, `import`, `export`, `stage`, `source`, `submit` and `receipt` have owner visibility. The kernel can admit an owner entry application while retaining its real module caller identity; the runtime accepts that routed identity. `write`, `read` and `list` declare `provider`, `modules` and `owner` visibility. Agent-selected tools retain the originating module identity, so module visibility is required even for editing Author's own files. Providers and modules can use these bounded file tools when selected/admitted by the router. Public arguments never select a caller, Run or authorized cwd. Only import/export accept an explicit absolute workspace directory as material input. Missing callers and provider calls to owner actions fail closed. The runtime guard supplements routing; a module caller's identity alone is not proof of owner authorization.

## Current-conversation material workflow

The current conversation's Agent Run builds and tests in its existing task workspace using its admitted tools and bash, then copies explicit source and artifact selections through `author.import`. `author.write` remains a bounded text convenience. `prepare` is pure: it returns requirements, a prompt and draft admission arguments; it does not start a model, write files, issue admission, submit candidates or install an application. Prepared materials mean the current Agent proceeds with the work. Submission, checks and activation require their own receipts. No nested Agent, new Run, extra queue, new kernel API or additional authority is needed.

Structured tools take one `input` string containing JSON, as in the existing author SDK conventions. This preserves nullable target identity fields without weakening the manifest input schema. The file tools use scalar arguments directly.

1. The real owner-entry principal discovers the current approved Author identity through `modules.list` and uses its `moduleId` and active hash as the draft `submitter`. Call `author.prepare` with:

   ```json
   {
     "requestKey": "material-1",
     "submitter": { "moduleId": "approved-author-id", "hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
     "targets": [{ "name": "fixture", "moduleId": null, "expectedActiveHash": null }],
     "goal": "Create a local fixture",
     "intent": { "changes": ["Create fixture"], "preserves": ["No network"] }
   }
   ```

   The result has `kind: "material-preparation"`, requirements, a reusable prompt and a draft `admission` object. There is no `execution` field. `submitter` remains a draft field to verify against the current approved Author module/version; discovery itself grants no authority. It is never forwarded by `submit`, used to impersonate another module or treated as authorization.

2. The real owner-entry principal submits the verified draft to **`modules.admit`**, outside Author and under its existing owner authority. Author cannot issue its own admission. The admission binds the approved Author submitter, complete fixed target set and exact active bases. It authorizes material submission, not model execution. Keep its `admissionId` and the draft's `requestKey`; remove that key from admission arguments and pass it as the call option `key`. An update target requires both exact `moduleId` and `expectedActiveHash`; new targets use `null` for both. Prepare accepts one to four unique targets and refuses Agent. The kernel enforces the full fixed target set and actual caller binding again.

3. Build/test in the existing task workspace, then call `author.import` with explicit files (see below). For admitted updates, `author.source` first forwards `{admissionId,moduleId,hash,to:"sources/baseline"}` to the kernel as Author, which exports the exact admitted immutable version into a new directory in Author's own content root. Call `author.export({path:"sources/baseline",to:"/absolute/new-workspace"})`, edit/build/test there, then import into a fresh `sources/work`. This preserves the exact baseline, complete binary artifacts and executable modes. Do not reconstruct binary bytes through model text. No command in the build notes is executed by Author.

4. Optionally call `author.stage` with `{name:"fixture",from:"sources/work",to:"packages/release",provenance:{kind:"local",label:"Offline source"}}`. It atomically copies the complete source/artifact tree and generated material record, checks that `module.json.name` matches the target and that its entry file exists, and writes `packages/release/provenance.json` alongside `packages/release/source`. A kernel import can be described with `{kind:"kernel-source",moduleId,hash,ref,materialDigest}` from its receipt. All supplied provenance is explicitly **caller-declared**; it is not proof of origin or admission. The local `materialDigest` is SHA-256 of the sorted JSON file index (`path`, byte count, SHA-256, executable flag). It is not the kernel's immutable material identifier.

5. Call `author.submit` with `{admissionId,requestKey,items:[{name:"fixture",dir:"packages/release/source",intent:{changes:["Create fixture"],preserves:[]}}]}`. A direct `sources/work` directory also works. Include the entire admitted set. Author forwards exactly these fields as its real module identity; the kernel checks that identity against the admitted Author submitter and derives Author's content root from the routed caller. Author does not re-read mutable directories before forwarding, so a replay can recover the original receipt even after local material changed or disappeared. Kernel-side key matching, snapshotting and target enforcement are prerequisites.

6. Query `author.receipt` using exactly `{receiptId}` or `{admissionId,requestKey}`. `source`, `submit` and `receipt` execute their kernel calls as Author and return upstream objects unchanged, including error objects, unknown states and future fields. Thrown SDK errors retain their code and message. There is no latest selector, automatic retry, status synthesis or claim of successful activation/business recovery. After uncertain delivery, query the original key rather than issuing a new one.

## Explicit binary transport and shared record

Tools take `{input: JSON.stringify(value)}`. Example import value:

```json
{
  "from": "/absolute/task-workspace",
  "to": "sources/work",
  "source": ["module.json", "src/main.c", "build.sh", ".gitignore"],
  "artifacts": [{ "path": "bin/fixture", "executable": true }],
  "build": { "commands": ["./build.sh", "./test.sh"], "toolchain": "existing host tools", "target": "host" }
}
```

Selections name files, not directories or globs. Include source, dependency locks and build scripts deliberately. `.gitignore` is source documentation; it is neither a sole release filter nor a security rule. Unselected files are not read or copied. Source/artifact paths must be disjoint, and cannot overlap their ancestors. The generated root record is automatically added and must not appear in `source` or `artifacts`. Caller-supplied digests, principal, Run and cwd fields are rejected. The result is `{path,record,files,bytes,materialDigest}`.

The generated `chrona-material.json` has exactly this shared shape:

```ts
{ schema: 1, source: string[],
  artifacts: { path: string, sha256: string, executable?: boolean }[],
  build: { commands: string[], toolchain: string, target: string } }
```

Digests come from the actual copied bytes. Build notes describe the current Agent's work; they are not independently verified reproducibility evidence. Subsequent snapshots and staging verify the complete recorded membership, actual artifact digests and executable flags. A changed artifact or extra/missing file requires a fresh import/record. Legacy text workspaces remain supported without a record. Object entries such as `{path:"bin/fixture",args:[]}` or `{path:"dist/app.jar",runtime:"java",args:["-jar"]}` are retained; staging checks the entry path exists and leaves complete entry/runtime validation to the kernel.

Export takes `{path:"sources/work",to:"/absolute/new-directory"}` or a staged `packages/<stage>/source` path and returns `{path,to,files,bytes,materialDigest}`. Its destination must not exist and its real parent must already exist. It copies every recorded file, including binaries and the record. No files are transcribed through the model. For trusted Web executable components, register through `web.component-set` in the application's own `activated` handler with the actual app identity and active version. Use the returned `type` verbatim in `web.page-set`: for example, `local-player:Player`. `app:Player` is a placeholder and must never be copied literally. Preserve routed callback contracts and include runtime bundles among artifacts; these components execute directly in the browser without a security sandbox.

Before submission, execute the application's actual activation handler against real Web registration/page validators. In an existing Chrona checkout matching the target Web version, build a single portable helper directly into the ordinary app's workspace:

```sh
cd /absolute/Chrona-checkout
bun run packages/engine/src/modules/steward/external/web/build.ts --registration-test-only /absolute/app-workspace/test-support
cd /absolute/app-workspace
bun --no-install test ./web-registration.bun.test.ts
```

The app workspace's `web-registration.bun.test.ts` imports `createRegistrationTest` from `./test-support/registration-test.mjs`, creates `h = await createRegistrationTest(absoluteAppEntry)`, awaits `h.activate()`, asserts the returned component type and `h.pages.get(actualAppName, actualPageId)`, and always awaits `h.close()` in `finally`. The manifest defaults to `module.json` beside the real entry; pass `{manifest: absoluteManifestPath}` for a nested entry or bundle. The complete runnable example is in [Web registration testing](../../../../../../../docs/zh/web-executable-components.md#提交前执行实际激活登记).

Helper generation is limited to the existing Chrona checkout: it bundles the real Web component/page, manifest, tool argument/output and callback contract validators into `registration-test.mjs`. Copying that single file lets an exported app/source workspace run the test with Bun alone, without monorepo imports, SDK preload, `DATABASE_URL` or dependencies belonging to the helper. The app's own imports must be locally available; the command disables automatic dependency installation. Plain `bun run build.ts` in exported Web source still builds only its browser artifacts; `--registration-test-only` does not change those artifacts or the material record. Select the helper explicitly if retaining it in exported application test materials. This is an application-owned test utility, not a new SDK/kernel API or automatic candidate-check gate.

Supported test SDK calls are `on('activated')`, `chrona.paths`, synchronous `chrona.call` to `web.*`, and `ModelError`. Other SDK imports and routed targets fail instead of silently passing; applications using those need separate tests for that setup. The helper executes trusted application code in process and supplies a test identity from the validated manifest, not production activation authority. It proves registration and stored contracts, not browser page loading or playback. A fake DOM unit test verifies neither registration nor page loading. Verify package declarations and lockfiles against the candidate's frozen-install policy, respecting the configured offline policy. Keep missing lockfile, lockfile mismatch, offline cache miss and other install errors separate; do not remove frozen checks or enable downloads to make a candidate pass.

After submission, retain the original receipt and exact candidate hash, check matching-version activation, and provide the page entry. Browser functionality needs its own checks: for an audio player, select a file, confirm advancing playback and pause, and check cleanup. Record what ran and what remains unverified. If browser tools are unavailable, say so. Reserve time before the current Run deadline to hand over these identifiers and results. Run termination, candidate approval, activation and browser acceptance remain separate facts; no automatic continuation follows a timeout.

## Optional local desktop applications

Use an ordinary SDK application and the existing native/interpreter entry format. The app owns a persistent toolkit child through `child_process` or `Bun.spawn`; bounded `chrona.exec` is unsuitable for a long-lived window. Keep module readiness separate from toolkit map evidence, present/reuse a single window on repeated open, and keep the SDK module ready after the user closes its window. Missing desktop session or backend must fail explicitly. Declare host toolkit prerequisites and carry the entry, helper, build scripts, tests and runtime artifacts through explicit source/artifact selections.

The [desktop demo](../../../../../../../examples/desktop-demo/README.md) provides build/import instructions and a temporary-data `startModule` harness. Its offline fixture proves lifecycle contracts and existing supervisor descendant cleanup, not a real window. Run the separate desktop check to establish toolkit mapping, inspect visibility/focus, close/reopen, and confirm cleanup through the actual stop/disable/update lifecycle. A kill request alone does not establish descendant-empty stop. No desktop module type or additional kernel API is needed.

## File boundary and limits

Public writes are confined to `sources/<workspace>/...`; public reads/lists also cover staged `packages/<stage>/...`. For `list`, `path: ""` and `path: "."` select the public root and return canonical `path: ""`, revealing only existing real `sources` and `packages` directories. An empty installation returns `entries: []` without creating directories. Missing paths return `not_found`. Root aliases apply only to listing. Workspaces/stages use a letter followed by up to 63 lowercase letters, digits or hyphens. Paths reject absolute forms, backslashes, control characters, empty/dot/traversal segments and Git internals. Explicit material selections allow hidden build configuration such as `.cargo/config.toml`; installed root dependency directories remain excluded. Material paths are limited to 1,024 characters.

The implementation targets Chrona's Linux runtime. It opens its SDK content root without following symlinks, walks directories with `O_DIRECTORY|O_NOFOLLOW`, and anchors each descendant operation through its own directory descriptor under `/proc/self/fd`. Only import/export traverse the explicit workspace input; all private paths come from SDK roots, without hardcoded host session layouts. Inputs must be normalized absolute paths with real parents, without symlink components; overlapping Author content/data/module roots and their ancestors or descendants are rejected. This trusted-local interface is not malicious-code isolation or a global filesystem sandbox: OS permissions still apply, and other applications must expose their own routed tools for private data. The SDK supplies Author's content/data/module roots, not a global inventory of other applications' private roots; private-root exclusion covers those supplied roots only. Reads reject symlinks, special files and multiply linked files, and bound reads even when a file grows. Public writes use exclusive temporary files and replace the destination entry atomically, preserving the old inode if another process acquires a hard link. OS errors are reduced to safe application errors without host paths. At the SDK boundary, local `unsafe_source` becomes `invalid` and local `source_io` becomes `failed`; these application-only codes must not be sent as wire error codes. Other Author codes and upstream SDK errors keep their meanings.

Text writes and reads retain their 64 KiB file limit. Binary-safe material transport supports larger sources within the aggregate source budget. Reads return at most 2,000 UTF-16 code units with `nextOffset` and `eof`; tool file results stay within 16 KiB JSON. Unrecorded legacy material accepts at most 200 files, 400 total entries and 1 MiB of source bytes. Recorded material permits up to 1,000 artifacts at 64 MiB each, 256 MiB of artifacts plus 1 MiB of sources/record and 1,200 files including the automatic record, with 4,000 total entries. At most 199 source files plus the record share the kernel’s 1 MiB source budget; selected source paths retain the 400-entry cap. The record itself is bounded to 1 MiB and counts toward source and material bytes. Executable flags must match the actual workspace files; copied modes normalize to private `0700` executable or `0600` non-executable. Lists fail above 200 entries or the output budget. Oversized inputs fail explicitly; material is never silently truncated. Imports, exports and stages require new destinations and publish a whole staged sibling directory with Linux `renameat2(RENAME_NOREPLACE)`. Existing files, symlinks and even empty directories conflict; they are never replaced. Failure removes only the temporary directory inode created by that operation. Generated temporary names are hidden from public lists. The Linux implementation uses Bun FFI and glibc/musl libc names; missing `/proc` or atomic no-replace support fails closed. No shell or compiler is invoked. Publication is atomic for concurrent readers, not a promise of crash durability. File bytes, modes, link count, inode and timestamps are checked during reads and again before publication; directory identities are anchored by open handles.

## Runtime boundary and integration

The current Agent uses the existing conversation Run; Author never invokes `agent.run` or other model tools. The returned prompt guides that ongoing work without creating an execution or granting permissions. If the current Run lacks a required tool, report that blocker. Do not introduce another queue or relax routing, owner admission, budgets or activation checks.

Author forwards the existing camelCase interfaces:

```ts
modules.source({ admissionId, moduleId, hash, to })
modules.submit({ admissionId, requestKey, items: [{ name, dir, intent }] })
modules["candidate-check"]({ receiptId } | { admissionId, requestKey })
```

These calls must bind the real Author identity to an owner-issued admission. SDK fakes test the app contract, not kernel authorization or activation. No catalog, bootstrap, generated contracts or initialization wiring is included here. Distribution stages explicit local source/artifact snapshots or kernel source exports; Author performs no remote fetching, Git operations or provider execution.

`authorPrompt`/`prepareMaterial` in `workflow.ts`, the parsers in `contracts.ts`, and `packageMaterial` in `distribution.ts` are reusable functions for a future independent CLI adapter. They do not issue admission or reach a database/model/network.

Run the offline SDK author harness with:

```sh
flock /tmp/chrona-heavy-check.lock env NODE_OPTIONS=--max-old-space-size=6144 bun test ./packages/engine/src/modules/steward/external/author/{author,material}.bun.test.ts
```

The wrapper runs `test.ts` through the existing `createScriptSandbox().runModule` and `chrona/testing` fake SDK in temporary directories, with a 60-second deadline, 2 GiB memory cap and `network:false`. Trusted-local mode does not itself isolate the network; tests contain no network/model/live-database calls. The wrapper also validates actual successful examples for all ten output schemas. Filesystem tests cover escapes, symlinked roots/parents/files, hard links, oversize reads/writes/material, immutable staging, manifest mismatch, binary mode/digest/membership checks, 64 MiB artifacts, concurrent destination publication, race detection and atomic text replacement. Protocol tests cover pure preparation with no routed calls or file writes, current-Agent guidance, visibility, exact forwarding, unknown/error receipt preservation and replay after local source removal.
