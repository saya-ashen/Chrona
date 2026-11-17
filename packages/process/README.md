# Native process supervision (S4 slice)

This package supervises trusted local commands using a small independent native guardian. It does not provide an isolation boundary. Linux descendant supervision has local execution evidence. A Windows Job Object backend is implemented but **has not been compiled or run on Windows in this change**. macOS remains group-only and cannot satisfy descendant supervision. S4/S6 native acceptance, binary distribution, and remaining caller integration are pending. See [native backend evidence and limits](NATIVE-EVIDENCE.md).

## Build and use

Build on the target host (C11 compiler required at build time only). Linux/macOS use `CC` or `cc`; Windows uses `CC` or `cl` from a Visual Studio developer environment with a Windows 10+ SDK. `clang-cl` and MinGW-w64 `CC` command forms are supported by the build script but unverified here:

```sh
bun run --cwd packages/process build:helper
```

The binary is generated at `packages/process/bin/<platform>-<arch>/chrona-process-guardian` (`.exe` on Windows) and is ignored by git. No compiler, shell, systemd, flock, or downloaded helper is invoked at runtime. A deployment must ship the correct native executable. Supply an absolute `helperPath`, or `CHRONA_PROCESS_HELPER`, when the JS is bundled or moved away from this source layout. Missing executables and unsupported platforms fail closed.

```ts
import { spawnSupervised, requireDescendantStop } from "@chrona/process";

const task = spawnSupervised(program, argv, {
  cwd,
  env,
  helperPath, // optional in the source layout after build:helper
  timeoutMs: 60_000,
  signal,
});
task.process.stdout.on("data", consumeStdout);
task.process.stderr.on("data", consumeStderr);
task.process.stdin.end(input);
const { pid, groupId } = await task.ready; // actual command, not guardian
const exit = requireDescendantStop(await task.exited);
// Only now publish completion / release capacity.
```

`task.pid` and `task.process.pid` identify the **guardian**, not the command. Use `task.stop()` (idempotent, forced cleanup) rather than killing that PID or group. `task.process` supplies Node-compatible streams. Do not close its private descriptors. `exited` always includes separate stop evidence; command exit status alone is insufficient. `requireDescendantStop()` throws `ProcessStopUnknownError` for unknown or group-only evidence. A caller must retain capacity and uncertainty when it throws, rather than convert that error to a successful stop.

## Ownership and native evidence

On POSIX, the owner spawns the guardian in a detached session using `node:child_process.spawn` and five pipes. The native guardian starts the command in a separate process group. Private fd 3 is an owner-lifetime/control pipe and fd 4 carries bounded status records. Both are closed before command `exec`, so descendants cannot hold the lifetime pipe open. Kernel closure on JS owner `SIGKILL`, abnormal exit, or ordinary exit triggers cleanup without depending on a JS signal/exit hook.

The guardian observes command exit through `waitid(...WNOWAIT)`. It retains the exited command leader until after signalling the original group, preventing stale PGID reuse before that signal. It cleans the group even when the command already exited. Command return code/signal are preserved separately from cleanup evidence.

Linux additionally enables `PR_SET_CHILD_SUBREAPER` before forking and requires `/proc/self/task/<guardian-pid>/children`. On cleanup it kills the original group, reaps children, enumerates and kills adopted children repeatedly, and continues until `waitpid(-1, ..., WNOHANG)` returns `ECHILD`. Thus descendants that call `setsid`/create new groups are also collected, including when the command or JS owner has already died. This is the Linux native observation required for `scope: "descendants", state: "stopped", treeClean: true`.

Cleanup observation is bounded to approximately two seconds. Missing `/proc`, an unkillable child, invalid/missing status, or loss of the guardian cannot produce positive descendant evidence. Waiting for stdout/stderr after guardian exit is bounded to 250 ms so inherited pipes do not hang an unknown-stop result. A valid cleanup record may still be conservatively rejected if output cannot drain within that bound.

On POSIX, killing the native guardian itself with SIGKILL, killing the whole owning OS scope, or OOM killing the guardian can leave processes alive. The real guardian-death test proves this limitation and requires `unknown`, not tree-clean. There is no kernel-owned kill-on-close container here. These are trusted local processes with the user's OS permissions; a malicious process can attack its supervisor or change identity to defeat signalling. Treat isolation/host compromise separately.

On Windows 10+/Server 2016+, the owner listens on a random private duplex named pipe, and the helper connects before launching anything. This avoids Node/Bun's runtime-specific Windows CRT mapping for extra stdio slots: only stdin/stdout/stderr use child stdio. A cancel byte keeps the status direction open; owner death closes the pipe in the kernel. Tasks inherit neither that pipe nor the unnamed Job handle. The pipe name is a capability in this trusted-local model, not an authenticated boundary against hostile processes with the same OS identity.

The helper sets `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, permits no breakaway, and uses `PROC_THREAD_ATTRIBUTE_JOB_LIST` to assign the command during `CreateProcessW(CREATE_SUSPENDED)`. It checks membership through the returned process handle before resuming the initial thread. Unsupported assignment or nested-job restrictions fail without a runnable task; there is no suspended-create/late-assign crash gap. `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` restricts inheritance to the three duplicated standard handles. After root exit/cancel/owner EOF, `TerminateJobObject` and a successful accounting query with `ActiveProcesses == 0` are required for positive evidence, including nested jobs. No PID enumeration, PGID signal, or completion-port message is trusted. Guardian death closes the sole Job handle and the OS kills its members; without a valid exit record the wrapper still returns **unknown**.

`ready.groupId` remains equal to the task PID for wire compatibility. On Windows it is an opaque compatibility field, **not a process group or a Job handle**, and must never be used for signalling. Cancellation uses the existing normalized signal 9 in the result, not a claim that Windows delivered a POSIX signal. External broker/service/WMI-created work is outside Job inheritance; the required broader scope would need a stronger execution backend.

## Platform evidence (2026-11-09)

| Platform | Implemented evidence | Actual local execution | Result exposed to sandbox |
| --- | --- | --- | --- |
| Linux x64 | Detached groups + native subreaper + `/proc` adoption + ECHILD | Bun 1.4.2 and Node v22.22.3, real subprocesses | Available with built helper; whole descendant evidence required |
| macOS | POSIX detached group and waitable leader; no subreaper equivalent | **Pending**, no macOS host used | Unavailable: group-only evidence cannot satisfy descendant cleanup |
| Windows | Atomic Job assignment, kill-on-close, no breakaway, handle-based empty accounting | **Pending**, not compiled/run on Windows | Installed helper reports descendant capability with `validation: pending`; launch and positive evidence require native API success |
| Other platforms | No backend | Unsupported | Unavailable |

`processCapability()` is an installation/platform check, not a successful runtime self-test. Linux kernel/proc preconditions are checked natively before command launch; capability availability cannot replace `ready` and `exited` evidence. macOS package callers may explicitly use the group-only primitive, but must not claim all descendants stopped. The script sandbox deliberately requires full descendant capability before starting work.

## Reproducible checks

```sh
bun test packages/process/src
```

Current Linux result: **28 passed, 22 skipped, 0 failed**. The skips are the 21 Windows native cases and one macOS native refusal case. This includes the existing Linux three-generation/escaped-session/owner-death/guardian-death tests plus new malformed-evidence and private duplex transport contracts. The transport contracts use a Unix socket on Linux and synthetic status; **they do not validate Windows Job APIs or Windows named pipes**. Scoped TypeScript checking passed; ESLint reported 0 errors and 4 complexity warnings in the wrapper. No full-repository acceptance is claimed.

Tests build helpers into temporary directories and use real local Bun/Node processes, without model calls or network. Windows tests require both runtimes and an installed native compiler; missing prerequisites fail rather than masquerade as a native pass. They exercise three detached generations, root exit/death, owner exit/death, guardian death, abort/cancel/timeout, Unicode/quoted argv, status-like command output, explicit breakaway denial, and a nested Job whose child requests breakaway from the inner job. macOS tests deliberately demonstrate an escaped child surviving group cleanup and require refusal of descendant evidence. All Windows/macOS results remain pending until run natively.

The new `.github/workflows/process-native-acceptance.yml` runs these checks on Linux, macOS 14 and Windows Server 2022, records revision/runtime/platform, and builds the host-native helper without root workspace installation. Adding the workflow is not an execution result. See [NATIVE-EVIDENCE.md](NATIVE-EVIDENCE.md) for pending gates.

## Handoff to concurrent S4 owners

`script-sandbox.ts` is integrated directly. Its `startModule` preserves `pid`, streams, stderr, `kill()` and `{code,signal}` completion shape; `kill()` now requests native cleanup, `exited` rejects on uncertain descendant stop, and additive `ready` / `stopEvidence` expose details. `runModule` includes `stopEvidence` on completed results and rejects `ProcessStopUnknownError` on uncertainty. The optional `processHelper` constructor setting supports deployments/tests. Authenticated IPC environment is passed through the existing `env` field; `socketPath` is optional during the concurrent transport migration.

`module-channel.ts`, `module-supervisor.ts`, `module-sdk/sdk.ts`, shared engine ports, and Pi files were left to their owners. This workspace's sandbox uses a direct source import of the new library so runtime checks work without changing shared aliases/lockfiles. Root workspaces already include `packages/*`; the main integrator should add `@chrona/process: workspace:*` to importing manifests and refresh the workspace lock/aliases when switching to named imports.

For **SDK `chrona.exec`**, preserve credential lifetime, bounded collection, redaction, and secret cleanup, but replace `spawn` with `spawnSupervised(command,args,{env,cwd,helperPath})`; use `task.process` streams, change timeout/disconnect cancellation to `task.stop()`, and replace the child `close` handler with `task.exited.then(requireDescendantStop)`. Do not remove secret files or release reservations on direct-child closure. Secret-file cleanup after *unknown* stop must be an explicit policy decision because descendants may still need/access them. The installed SDK is copied outside the monorepo, so it needs a shipped/vendored copy of this wrapper **including `windows-transport.ts` (or its bundled equivalent)** and access to the native binary; importing a workspace-relative path from the copied SDK is insufficient. This change edits no SDK package; the main owner will perform byte-copy synchronization after review. Do not assume the module's outer guardian makes an independently completed `exec` safe: descendants of a completed exec can remain while the module continues running.

For **Pi `PiProcess`** (the independent Pi module’s `adapter/src/pi-process.ts`), the exact adapter is:

```ts
const task = spawnSupervised(input.file, input.args, {
  cwd: input.cwd, env: input.env, helperPath,
});
return {
  stdin: task.process.stdin,
  stdout: task.process.stdout,
  stderr: task.process.stderr,
  closed: task.exited.then(requireDescendantStop)
    .then(({ code, signal }) => ({ code, signal })),
  kill: (_signal: NodeJS.Signals) => task.stop(),
};
```

Inject this at the existing Pi launch boundary and gate health on descendant capability. All supplied signals map to full cleanup here; graceful stop semantics would require a separately designed deadline/escalation protocol. Do not reinterpret rejected `closed` as an observed stop. The Pi command `--version` probe (`pi-launch.ts`), completion launcher (`pi-completion.ts`), and module package installer (`module-packages.ts`) also still launch direct children; migrate them through the same primitive with output draining and `task.stop()` on timeout. No Pi runtime/model was invoked for these changes.
