# Author: ordinary material authoring and local distribution

Author is an ordinary SDK application. It owns requirements, prompts, bounded source workspaces, local package staging and declared provenance. The kernel owns admission, actual caller identity, immutable materials, idempotent submission receipts, checks and activation. Author requests only `modules.source`, `modules.submit` and `modules.candidate-check`; it never calls owner admission or Agent tools and has no network effect, credentials or host-project access.

`module.json` declares eight tools, with output schemas. `prepare`, `stage`, `source`, `submit` and `receipt` have owner visibility. The kernel can admit an owner entry application while retaining its real module caller identity; the runtime accepts that routed identity. `write`, `read` and `list` declare `provider`, `modules` and `owner` visibility. Agent-selected tools retain the originating module identity, so module visibility is required even for editing Author's own files. Providers and modules can use these bounded file tools when selected/admitted by the router. Public arguments never select a caller, root or cwd. Missing callers and provider calls to owner actions fail closed. The runtime guard supplements routing; a module caller's identity alone is not proof of owner authorization.

## Material workflow

Structured tools take one `input` string containing JSON, as in the existing author SDK conventions. This preserves nullable target identity fields without weakening the manifest input schema. The file tools use scalar arguments directly.

1. Call `author.prepare` with:

   ```json
   {
     "requestKey": "material-1",
     "submitter": { "moduleId": "approved-author-id", "hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
     "targets": [{ "name": "fixture", "moduleId": null, "expectedActiveHash": null }],
     "goal": "Create a local fixture",
     "intent": { "changes": ["Create fixture"], "preserves": ["No network"] }
   }
   ```

   The result includes the requirements, reusable prompt and a draft `admission` object. `execution` is omitted from the admission arguments for material-only admission. The SDK does not expose Author's own immutable identity, so `submitter` is an owner-selected draft field: the owner must verify it against the approved Author module/version. It is never forwarded by `submit`, used to impersonate another module or treated as authorization.

2. The owner submits the verified draft to **`modules.admit-candidates`**, outside Author. That tool must remain owner-only. Keep its `admissionId` and the draft's `requestKey`. An update target requires both exact `moduleId` and `expectedActiveHash`; new targets use `null` for both. Prepare accepts one to four unique targets and refuses Agent. The kernel must enforce the full fixed target set and actual caller binding again.

3. Write explicit source material using `author.write({path:"sources/work/module.json",content:"..."})` and `author.write({path:"sources/work/index.ts",content:"..."})`. For admitted updates, `author.source` instead forwards `{admissionId,moduleId,hash,to:"sources/work"}` to the kernel, which exports the exact immutable version into an empty directory belonging to the actual caller. Read and edit it through Author's file tools.

4. Optionally call `author.stage` with `{name:"fixture",from:"sources/work",to:"packages/release",provenance:{kind:"local",label:"Offline source"}}`. It copies an independently bounded tree, checks that `module.json.name` matches the target and that its entry file exists, and writes `packages/release/provenance.json` alongside `packages/release/source`. A kernel import can be described with `{kind:"kernel-source",moduleId,hash,ref,materialDigest}` from its receipt. All supplied provenance is explicitly **caller-declared**; it is not proof of origin or admission. The local `materialDigest` is SHA-256 of the sorted JSON file index (`path`, byte count, SHA-256). It is not the kernel's immutable material identifier.

5. Call `author.submit` with `{admissionId,requestKey,items:[{name:"fixture",dir:"packages/release/source",intent:{changes:["Create fixture"],preserves:[]}}]}`. A direct `sources/work` directory also works. Include the entire admitted set. Author forwards exactly these fields; the kernel derives its content root from the actual routed caller. Author does not re-read mutable directories before forwarding, so a replay can recover the original receipt even after local material changed or disappeared. Kernel-side key matching, snapshotting and target enforcement are prerequisites.

6. Query `author.receipt` using exactly `{receiptId}` or `{admissionId,requestKey}`. `source`, `submit` and `receipt` return upstream objects unchanged, including error objects, unknown states and future fields. Thrown SDK errors retain their code and message. There is no latest selector, automatic retry, status synthesis or claim of successful activation/business recovery. After uncertain delivery, query the original key rather than issuing a new one.

## File boundary and limits

Public writes are confined to `sources/<workspace>/...`; public reads/lists also cover staged `packages/<stage>/...`. Workspaces/stages use a letter followed by up to 63 lowercase letters, digits or hyphens. Paths reject absolute forms, backslashes, control characters, empty/dot/traversal segments, hidden segments, dependency directories and paths deeper than 16 segments. This deliberately excludes credential dotfiles and Git internals.

The implementation targets Chrona's Linux runtime. It opens its SDK content root without following symlinks, walks directories with `O_DIRECTORY|O_NOFOLLOW`, and anchors each descendant operation through its own directory descriptor under `/proc/self/fd`. It never traverses arbitrary host paths. Reads reject symlinks, special files and multiply linked files, and bound reads even when a file grows. Public writes use exclusive temporary files and replace the destination entry atomically, preserving the old inode if another process acquires a hard link. OS errors are reduced to safe application errors without host paths.

Each source file is at most 64 KiB. Reads return at most 2,000 UTF-16 code units with `nextOffset` and `eof`; tool file results stay within 16 KiB JSON. Staging accepts at most 200 files, 400 total entries and 1 MiB of source bytes. Lists fail above 200 entries or the output budget. Oversized inputs fail explicitly; material is never silently truncated. Stages must be new, cannot be edited by public writes, and are not overwritten. An IO failure can leave a partial stage: inspect it and choose a fresh stage name rather than treating it as a successful package.

## Execution prerequisite and integration

**Bounded author execution is unavailable: `agent.context/run` do not yet enforce admission-bound exact model, timeout, and submission caps. Supply source material explicitly; no model execution was started.** Author exposes no model-driven `create`/`update` workflow and makes no fabricated execution claim.

The coordinator must provide and authorize the planned camelCase interfaces:

```ts
modules.source({ admissionId, moduleId, hash, to })
modules.submit({ admissionId, requestKey, items: [{ name, dir, intent }] })
modules["candidate-check"]({ receiptId } | { admissionId, requestKey })
```

These calls must bind the real Author identity to an owner-issued admission. SDK fakes test the app contract, not kernel authorization or activation. No catalog, bootstrap, generated contracts or initialization wiring is included here. Remote fetching, Git operations and provider execution are not implemented; distribution currently stages local source or kernel source imports only.

`authorPrompt`/`prepareMaterial` in `workflow.ts`, the parsers in `contracts.ts`, and `packageMaterial` in `distribution.ts` are reusable functions for a future independent CLI adapter. They do not issue admission or reach a database/model/network.

Run the offline SDK author harness with:

```sh
bun test packages/engine/src/modules/steward/external/author/author.bun.test.ts
```

The wrapper runs `test.ts` through the existing `createScriptSandbox().runModule` and `chrona/testing` fake SDK in temporary directories, with a 60-second deadline, 2 GiB memory cap and `network:false`. Trusted-local mode does not itself isolate the network; tests contain no network/model/live-database calls. The wrapper also validates actual successful examples for all eight output schemas. Filesystem tests cover escapes, symlinked roots/parents/files, hard links, oversize reads/writes/material, immutable staging, manifest mismatch and atomic replacement. Protocol tests cover visibility, exact forwarding, unknown/error receipt preservation and replay after local source removal.
