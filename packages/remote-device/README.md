# Standalone remote execution device (S5)

This package builds `chrona-remote-device`, a standalone Linux command for the remote execution application's device v1 protocol. Local Linux x86-64 is verified. Windows and macOS are unsupported by this device package; Linux arm64 has not been verified locally.

The device pairs with an app bearer and generates its own Ed25519 signing key. It accepts no owner API key or provider credentials. An explicitly configured Pi 1.5.0 executable runs through public `@chrona/pi` / `@chrona/remote-model`, a private authenticated loopback model gateway, and the packaged native process guardian. Every model request goes through the app to trusted kernel `execution.model` reservations; device counters cannot substitute for kernel budget admission. There is no provider fallback.

With no reviewed Pi configured, a launch produces `unavailable` and signed `never_started`. A configured launch whose model route fails or returns a pending/rejected reservation produces `unavailable` after confirmed native shutdown; ambiguous requests never create replacement reservations. Production deployment requires the app's authoritative reconciliation and model HTTP routes. An opt-in acceptance test exercises this device through the actual production server router, real app SDK process and native kernel, using deterministic model I/O and actual Pi.

## Build and checks

From this package directory, using the repository's existing dependencies:

```sh
bun run build
bun run test
bun run typecheck
bun run smoke:build
```

`build` needs Bun and a native C compiler (`CC`, default `cc`) on Linux. It compiles the public process package's guardian at build time, embeds that binary and both Pi extension resources, and compiles the device and its public dependencies into `dist/chrona-remote-device`. Distribute that command by itself. Runtime extraction verifies resource hashes and private permissions; the command never compiles a helper or resolves repository files, workspace packages, or `node_modules`. The build normalizes the command/helper ELF interpreters and removes builder library search paths. Linux still requires a compatible system libc/loader; this is not a static binary.

The device artifact includes its own runtime, adapter, helper and extension resources. The full upstream Pi CLI is a separately installed, reviewed execution dependency, configured by absolute path and pinned to 1.5.0. It is not embedded in the command. No running Chrona kernel, monorepo checkout, compiler or package manager is needed on the device.

The smoke check copies the command into an unrelated temporary directory and runs it with an empty `PATH`. It checks private initialization/status, embedded resources, the default unavailable reason, actual execution and descendant stop with the extracted helper, portable ELF interpreter paths, and rejection of a modified helper. It uses no network. On NixOS only the public host loader location is supplied through `NIX_LD` / `NIX_LD_LIBRARY_PATH`; no source or resource overrides are supplied. This local check does not establish compatibility with another Linux distribution.

Integration tests use the actual app SQLite relay and loopback HTTP with an independently implemented deterministic trusted-kernel fixture. They verify exact kernel stop schemas, signature bytes and all immutable target fields. Real process tests include an escaped descendant and cancellation. The optional actual Pi tests exercise RPC, a native file read, two distinct deterministic model reservations, final text, signed stop, pending reservations, and a missing route. No real model or external network is used:

```sh
CHRONA_TEST_PI_COMMAND=/absolute/reviewed/pi-1.5.0 bun run test
```

Without that explicit command, actual Pi cases are skipped. The default relay fixture does not claim real kernel admission. A separate opt-in acceptance test uses the production HTTP ingress, actual app SDK process and native kernel with this package's `RemoteDevice` / `DeviceHTTP`, two trusted model reservations, actual Pi/native file read, a kernel-verified Ed25519 stop, real cleanup preview/confirm, and cancellation of a held claim before the device receives its identity:

```sh
DATABASE_URL=file:/tmp/chrona-remote-device-test.db \
CHRONA_TEST_DEVICE_HTTP=1 CHRONA_TEST_PI_COMMAND=/absolute/reviewed/pi-1.5.0 \
bun test src/production.bun.test.ts
```

The completion I/O boundary in that fixture is a deterministic trusted local module. It exercises kernel budget admission, not an external provider. Source-level test imports of the server and engine are excluded from the standalone build.

## Device setup

```sh
./chrona-remote-device init --dir /absolute/private/device --server https://chrona.example --device-id my-linux-device
./chrona-remote-device pair --dir /absolute/private/device --code PAIRING_CODE
./chrona-remote-device doctor --dir /absolute/private/device
./chrona-remote-device status --dir /absolute/private/device
./chrona-remote-device run --dir /absolute/private/device
```

`init` prints only the public device ID, incarnation, key ID and Ed25519 PEM public key for owner pairing. The owner creates the pairing using the app owner surface. Pairing persists the exact request and credential before sending it; repeat `pair --dir ...` after a lost reply. The private app bearer is sent only in the Authorization header to `/api/remote-execution/device/v1/{pair,poll,report,reconcile,model}`. HTTPS is required except for loopback development. HTTP redirects are rejected. Pairing alone grants no kernel execution authority.

Configure the reviewed upstream Pi executable using `pi --dir ... --file /absolute/private/pi.json`. The JSON file must be mode 0600:

```json
{"command":"/absolute/reviewed/pi","expectedVersion":"1.5.0"}
```

The executable must be a regular executable file, resolved to its canonical absolute path, without group/world write access. Review its installation and parent directories as trusted operator configuration. The adapter checks the version and uses a private profile outside the approved working directory, with an environment allowlist and a private model proxy. `doctor` reports configured Pi as unverified: a local executable check cannot certify server routes or kernel authority.

Local mappings are trusted operator input, installed with `map --dir ... --file /absolute/private/mapping.json`. The JSON file must be mode 0600 and contain:

```json
{
  "workspaceRef": "owner-configured-local-alias",
  "targetRef": "exact-approved-kernel-target",
  "targetRevision": 1,
  "projectRef": "project",
  "path": "/absolute/project",
  "baseline": { "kind": "commit", "digest": "exact-commit-hash" },
  "workspaceModes": ["existing"]
}
```

The package resolves the canonical path and computes its directory identity using `@chrona/workspaces`. Owner mapping and separate kernel authority approval must agree on subject/epoch/key, receiver activation, target/revision/project, directory, baseline and modes. Poll's `localWorkspaceRef` selects this local alias; the kernel's distinct native `launch.workspaceRef` is preserved unchanged. A mapping never supplies a replacement launch digest or fence.

## Durable execution rules

- The private directory has an OS-backed exclusive SQLite lock. Config, signing key/bearer, journal and any recovery sidecars, and lock database are private; journal writes use SQLite EXTRA synchronization and config writes use file/parent fsync. Serving verifies the passed config exactly matches its saved private copy. Startup validates retained attempts, reports, receipts, controls and model inputs.
- Every accepted immutable target and launch is journaled, with two stable subject capacity slots and exclusive directory capacity locks. A rejected additional offer cannot block accepted launches or control draining. Exact kernel `executionDigest` ordering is used for launch and stop evidence; app receipt digests use the application's distinct canonical JSON algorithm.
- Workspace locks and their ownership tokens are recorded before creation. `spawn_possible` is durably committed before any execution driver can spawn. The public Pi native launcher uses the packaged supervisor; a root-process exit alone never proves descendant shutdown.
- Restart reconciles the existing journal before new launches. `intent` is settled as signed `never_started`; `spawn_possible` and `running` become `unknown`, hold capacity/workspace locks, and never replay. A lost native stop certificate cannot be reconstructed from a PID, deadline, heartbeat or disconnect. Missing journal reports block new launches.
- A proven native stop atomically commits final, Ed25519 stop proof, and stopped state before releasing workspace locks. Signature bytes are exactly `Buffer.from(executionDigest(statement), 'hex')`; the statement binds the full immutable target, process identity, final digest and source watermark.
- Source/final/stop/control acknowledgments are durable outbox records. A lost reply retries the same report. Receipt digest/identity/state must match before marking custody acknowledged. Evidence remains locally retained even after app acknowledgment; an app custody receipt does not claim kernel verification. Ordinary source report envelopes are cumulatively bounded to 256 KiB and 512 reports per delivery. Before exceeding either bound, the device durably records an explicit contiguous backpressure gap, marks the final incomplete, and stops the native process. The app reserves gap, terminal and cancellation headroom separately; final and stop stay deliverable. The journal retains at most 100 deliveries and has no automatic pruning.
- Model key and input are committed before possible HTTP I/O, bound to the immutable delivery, deadline and budget. The started report's app custody receipt precedes the first model call. A request with unknown outcome is never replayed automatically, even after restart. Only trusted kernel reservation admission enforces shared model budget.
- Cancellation drains even while reconciliation or report upload fails, and later cancel controls drain after a rejected input or blocked cleanup. An authenticated ready poll may carry a nonlaunchable held identity with its exact matching cancel before the device has ever journaled it. After successful complete-journal reconciliation, the device journals that immutable identity and emits cancelled final, signed `never_started`, and the durable cancel acknowledgment without reaching the execution driver. A nonlaunchable identity without a matching cancel is ignored. Existing `spawn_possible`/`running`/`unknown` records retain their uncertainty; missing previously offered journal entries remain quarantined and cannot acquire fabricated stop evidence. Disconnecting does not certify a running process stopped. Explicit local shutdown requests native stop. Uncertain writes/answers never replay; an uncertain cancel never generates an applied acknowledgment.
- Cleanup preview/confirm reuses the exact saved workspace binding and trusted local mapping. It requires stopped state, validates the saved final/stop signature and stable capacity, then calls public `@chrona/workspaces` ownership/physical-lock/clean-tree/preview guards. A fixed command key and input digest are committed before the call. The resulting native cleanup receipt and report are retained; lost custody replies resend the same report. An intent without a receipt after restart becomes `unknown` and never repeats deletion. Confirm receipts preserve the admitted preview digest, including blocked/unknown outcomes. Only the original stopped independent worktree is eligible; the source project is retained.
- Pi questions use live promises and fresh request IDs. Bounded durable question events omit editor prefill and dialog messages. Structured `ProviderAnswer` controls must match the live request and method before resolving it. Expiry/abort cancels the question. Answers are never injected as text or recreated after restart; stale/missing providers do not produce applied acknowledgments.

## Finite SQLite storage admission

`src/storage.ts` is a package-local copy of the app's physical policy, with identical defaults: 4,096-byte pages, `max_page_count=32768` (128 MiB including free/reserve pages) reapplied on every open, and a separate 8,192-page (32 MiB) ordinary-admission high-water limit excluding evidence reservations. A changed persisted policy or a retained attempt lacking its reservation requires explicit recovery. New accepted deliveries allocate and commit 2,048 actual SQLite pages (8 MiB) for their terminal/drain records. A model request allocates 256 pages (1 MiB) for its reply before possible I/O; the bounded shared restart/binding area reserves 256 pages. The admission and allocation are one immediate transaction. Failed new admissions roll back completely and do not block the reserved evidence paths.

Terminal/drain writes release the identity's blob into measured page credit and debit actual SQLite growth, including indexes and duplicated rows. Before any subsequent ordinary write commits, all unused credit must again occupy live blob backing. Separate metadata/blob tables avoid copying blobs during credit updates. This prevents ordinary allocations from quietly spending the freelist reserved for final/stop/cancellation, and retains usable backing across reopen. Tests measure `stat.blocks`, actual SQLite pages, failed admission rollback and custody after restart. No injected budget counter stands in for SQLite pressure.

Report envelopes and their receipts are bounded along with the existing source/final payload bounds: at most 512 ordinary source reports plus one gap, 16 stop records, 100 retained controls/cleanup requests per delivery, and 4 KiB per app custody receipt. Fixed business keys prevent repeated started/final records consuming evidence space; control/cleanup reports require their saved control. The last control slot belongs to cancellation. A model receipt is at most 512 KiB and uses its pre-I/O model reserve. New model/cleanup requests and ordinary write/answer controls can fail admission; an already admitted effect's evidence keeps its reserved path.

WAL is disabled. Opening a WAL-mode store must complete SQLite's exclusive checkpoint/mode transition to DELETE or fail. `cache_spill=OFF`, `temp_store=MEMORY`, `auto_vacuum=NONE`, `synchronous=EXTRA` and `journal_size_limit=0` prevent accumulating checkpoint debt and remove the rollback journal after successful commits. With this single-database writer and spill disabled, the transient rollback journal holds at most one image of each original page: bounded conservatively by `32768 * (4096 + 8) + 65536` bytes, below 129 MiB. Allow less than 257 MiB per store for DB plus transient journal, **plus** filesystem overhead and operational free space. A concurrent sampling test observes the real rollback file during commits; tests also verify WAL conversion retains committed rows.

The existing 100-delivery limit remains **retention**, not pruning. The physical ceiling can reject work earlier. Stopped attempts, acknowledged receipts/outboxes, model requests with unknown outcomes and process ownership with unknown stop are never deleted or reused. At exhaustion the device drains admitted work, retains the exact evidence and refuses new work. Sustained operation needs a separately proven archival protocol preserving replay tombstones and unresolved ownership; clearing the journal to resume work is unsafe.

Preallocation cannot guarantee a commit if unrelated writers consume the filesystem, disk/inode quotas are exhausted, or the storage device fails: SQLite still needs free space for its rollback journal. Such failures cannot yield a custody acknowledgment or authorize replay. This policy bounds the journal, not working directories, Pi state/output, or kernel storage.

Run the actual storage/recovery checks without external models:

```sh
bun --no-install test packages/remote-device/src/{storage,device}.bun.test.ts --timeout 20000
```

The exhaustion case retains one unknown live owner and fills ordinary admission, then commits 513 source reports including the gap, a large final, 16 signed stops, 100 control acknowledgments and their custody receipts, and a reserved model observation. It reopens the exhausted database, verifies unknown ownership/capacity and fixed receipts, refuses a fresh identity, and forbids respawn. The smaller storage tests additionally force actual SQLITE_FULL and faults around reserve release/allocation, nested cancellation admission, restart policy checks, integrity checks and measured rollback-journal bounds.

## Remaining integration work

The app's native governance routes and actual server ingress are maintained separately. This package requires authoritative kernel reconciliation before fresh launches and the deployed `/device/v1/model` route before model execution can complete. The production acceptance test covers one local Linux deployment; receiver generation replacement, old activation drain routing, lifecycle recovery and a release platform matrix require separate acceptance. A current authenticated, reconciled ready poll may advance the receiver activation only after every old attempt is stopped, all capacity is empty, and every old outbox record has a custody receipt. Saved old targets are never rewritten. Device generation replacement still requires separate acceptance.

Interactive answers preserve the kernel's structured `ProviderAnswer` object through the current app control contract. An actual Pi confirmation test exercises a live question, submitted boolean answer, resulting native file effect and a lost acknowledgment reply. The device rejects obsolete string answers. Text `write` uses the public adapter's injection method. The device emits native cleanup receipts only after its own durable observation; the kernel still independently requires its verified stop and admitted cleanup command.

The journal now has finite physical page admission and preallocated evidence reserves, described below. It deliberately has no safe garbage collection or unlimited sustained-operation guarantee. Exhausted retained capacity fails closed. The separately installed full Pi CLI and foreign Linux compatibility need release acceptance. These limitations, plus unverified macOS/Windows device execution, prevent an S5/S6 production-completion claim.
