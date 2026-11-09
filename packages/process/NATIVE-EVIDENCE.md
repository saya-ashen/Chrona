# S4 process backend evidence and pending S6 acceptance

Recorded 2026-11-09, base revision `a35dd2b8d75a62fede578015759c27513efc55a9`, **dirty shared worktree**, with these process changes not committed. This record is scoped to `packages/process` and the newly owned `process-native-acceptance.yml`. No SDK/integration/other package edits, root install, native Windows/macOS execution, or full S4/S6 completion are claimed.

## Executed here

Host: Linux 7.3.0-cachyos x86_64; Bun 1.4.2; Node v22.22.3; GCC 15.2.0.

| Command | Observed result |
| --- | --- |
| `bun test packages/process/src` | 28 pass, 22 skip, 0 fail; Linux real process regression + host transport/parser contracts |
| `bun run --cwd packages/process build:helper` | Host-native Linux helper built in ignored `bin/linux-x64/` |
| `bun -e` default-helper launch smoke (command below) | Actual exit code 6 preserved; descendant stop confirmed |
| Scoped `tsc` command below | Pass |
| Scoped ESLint command below | 0 errors; 4 complexity warnings in `src/index.ts` |

```sh
node_modules/.bin/tsc --noEmit --strict --target ES2022 --module preserve \
  --moduleResolution bundler --allowImportingTsExtensions --types bun,node \
  --skipLibCheck packages/process/src/index.ts \
  packages/process/src/windows-transport.ts packages/process/scripts/build-helper.ts \
  packages/process/src/protocol.bun.test.ts packages/process/src/windows.bun.test.ts \
  packages/process/src/darwin.bun.test.ts packages/process/src/process.bun.test.ts

node_modules/.bin/eslint packages/process/src/index.ts \
  packages/process/src/windows-transport.ts packages/process/scripts/build-helper.ts \
  packages/process/src/protocol.bun.test.ts packages/process/src/windows.bun.test.ts \
  packages/process/src/darwin.bun.test.ts packages/process/src/windows.fixture.mjs
```

Default-path launch command:

```sh
bun -e 'import {spawnSupervised,requireDescendantStop} from "./packages/process/src/index.ts"; const task=spawnSupervised(process.execPath,["-e","process.exit(6)"]); task.process.stdin.end(); task.process.stdout.resume(); task.process.stderr.resume(); const result=requireDescendantStop(await task.exited); if(result.code!==6) throw new Error(JSON.stringify(result)); console.log(JSON.stringify(result));'
```

Linux's native `guardian.c`, its subreaper/adoption algorithm, wire records and fd 3/4 path are unchanged. New TypeScript code selects the Windows transport only on `process.platform === "win32"`. Synthetic host records exercise rejection of missing/malformed/duplicate/truncated/oversized/premature/negative evidence; they cannot establish native containment. A Unix-socket transport contract checks the cancellation half-close, EOF, failed helper spawn and separation from command output.

## Windows implementation and limits

The helper requires Windows 10+/Server 2016+ and a matching host-native build. The build script selects MSVC/clang-cl flags or MinGW-w64 flags by compiler executable name; **none of those Windows builds has been run here**. A compiler is a packaging prerequisite only.

The native sequence is:

1. Connect the owner's random duplex named pipe; create an unnamed non-inheritable Job with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` and no breakaway flags.
2. Allow inheritance only of duplicated stdin/out/err using `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`. Keep the pipe and Job handle private to the helper.
3. Assign the task to the Job atomically using `PROC_THREAD_ATTRIBUTE_JOB_LIST` in `CreateProcessW`, with `CREATE_SUSPENDED`; confirm membership with `IsProcessInJob(task.hProcess, job)` and resume only after that succeeds. An unsupported attribute or incompatible inherited Job hierarchy fails closed. A plain create-suspended/AssignProcess sequence would leave an unassigned task if the guardian died between calls, so there is no such fallback.
4. Observe the root using its pinned process handle. On root exit, cancel, control error or owner EOF, terminate the Job, then query `JobObjectBasicAccountingInformation` until `ActiveProcesses == 0` (bounded to two seconds). Both successful termination and successful empty observation are required for positive evidence. Nested-job accounting includes child jobs. Completion-port messages and PID snapshots are not proof.
5. Close the only Job handle on every exit path. Kernel kill-on-close also covers guardian termination. A lost helper/status stream remains `unknown`, even if the kernel subsequently killed all members.

Only 0/1/2 use child stdio. The private named pipe carries cancellation/lifetime and status in opposite directions. This deliberately avoids relying on libuv's extra-fd Windows CRT startup layout (`lpReserved2`) being installed/understood by a separately compiled C helper. The owner retains the duplex stream after sending cancel, reads final status/EOF and closes it; helper exit retains the existing 250 ms output/status drain bound. Helper connection startup is bounded to five seconds. The pipe name acts as a capability within the trusted-local model; hostile same-user code is not isolated.

Microsoft's guarantee follows **Job membership and normal process creation**, not all logically requested work: `Win32_Process.Create` via WMI is explicitly outside normal child Job inheritance. Services, elevation, scheduled tasks or other external brokers can create processes outside this Job. Task code is trusted local code, not a security sandbox. If the intended scope includes arbitrary broker-created work, this backend **cannot satisfy that scope**; broker cooperation or a stronger execution/container/VM boundary is required. This limitation must not be hidden by a passing detached-process test.

Primary references consulted:

- [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects): inheritance, breakaway, WMI exception, kill-on-close, notification limitations.
- [UpdateProcThreadAttribute](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute): `HANDLE_LIST`, `JOB_LIST`, Windows 10/Server 2016 support.
- [QueryInformationJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-queryinformationjobobject): native accounting observation.
- [Nested Jobs](https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs): parent membership, breakaway limited by ancestor Jobs, accounting includes descendants, termination of child jobs.
- [libuv Windows process stdio implementation](https://github.com/libuv/libuv/blob/v1.x/src/win/process-stdio.c): CRT startup descriptor mapping, including unaligned HANDLE entries. Consulted source is upstream `v1.x`, not evidence for every installed Node/Bun version.

## macOS: no descendant claim

The existing POSIX process-group primitive remains available, with `scope: "process-group"`, `validation: "pending"`, and `treeClean: false`. `requireDescendantStop` rejects its evidence. A caller needing descendant cleanup must fail closed before execution when capability scope is only a group. The package exposes a group primitive deliberately; it does not upgrade group cleanup to descendant cleanup.

The researched unprivileged mechanisms do not establish complete descendant containment:

- `setsid`/new process groups allow a descendant to leave the original PGID. Retaining the leader prevents PGID reuse for the original signal; it does not contain escaped descendants.
- `EVFILT_PROC`/`NOTE_FORK` is an observation of a registered process, not automatic recursive membership. Current Apple XNU `bsd/sys/event.h` says the child PID in the kernel hint **does not get passed through in the actual kevent**, and says `NOTE_TRACK`, `NOTE_TRACKERR`, `NOTE_CHILD` are **no longer supported as of 10.5**. A FreeBSD-style recursive tracking implementation cannot be assumed on Darwin.
- Polling process/parent PID snapshots cannot close the fork/exit/reparenting window or pin future membership; no PID-list-empty or parent-exit result is used as proof.
- Endpoint Security requires an Apple-approved entitlement. Its own sequence-number documentation describes dropped events; observation alone is not a kill-on-close descendant container. It is not a drop-in proof mechanism for this unentitled helper. Any privileged/entitled design would need a separate lifecycle/identity/loss-handling proof and native acceptance before enabling descendant capability.

No general impossibility theorem for all macOS APIs is claimed. The current unprivileged group/observation primitives cannot meet the required scope. A stronger independently justified backend (potentially an entitled service or a VM with a separately proven lifetime boundary) remains necessary. Merely using launchd, process notifications or a PID poller would not establish the missing proof.

Primary Apple references:

- [setsid(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/setsid.2.html), [setpgid(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/setpgid.2.html).
- [kqueue(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kqueue.2.html).
- [Apple XNU event.h](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/event.h), `EVFILT_PROC` hint comment and deprecated tracking flags (upstream `main` consulted 2026-11-09; not a pinned installed-kernel test).
- [Endpoint Security entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.endpoint-security.client) and [message sequence numbers](https://developer.apple.com/documentation/endpointsecurity/es_message_t/seq_num). Apple documentation JSON for these pages was consulted directly.

## Native acceptance still pending

The new workflow records the actual checked-out revision, OS release/architecture and runtimes before `build:helper` and `bun test packages/process/src`, on `ubuntu-latest`, `macos-14`, `windows-2022`. It performs no root workspace installation. **The workflow has not been run in this session.**

Windows pending:

- Compile the production helper and C escape probe with MSVC `/std:c11 /W4 /WX`; run all 21 Windows cases with real Bun and Node. No Windows compile result is implied by Linux TypeScript success.
- Verify three detached generations on cancel/timeout/abort, root exit/death, owner ordinary/forced exit, and guardian forced death. Guardian death must kill members yet report unknown. Tests check observed test-task PID liveness and stopped heartbeat files; production cleanup never trusts PIDs.
- Verify explicit breakaway fails from the outer Job. Verify nested Job membership and a child requesting breakaway from an inner Job that allows it remains contained by the outer Job. The inner Job deliberately omits kill-on-close.
- Verify Unicode/empty/quote/trailing-backslash argv, stdin/out/err, status-like task output, failed executable, and installed-helper capability remaining `validation: pending`.
- Additional evidence needed beyond this first runner: Windows 10/11 desktop and supported architectures; inherited/restrictive nested Job environments; compiler variants; resource exhaustion, failed native API/handle operations, and guardian termination around launch under native debugger/fault injection. The atomic Job-list design addresses the launch gap by API contract; this session has not run crash-window stress or failure injection.

macOS pending:

- Compile/run on macOS 14 and additional supported macOS/architecture combinations. Run existing group tests and the dedicated detached-child escape case, which must show that descendant capacity cannot be released even if group cleanup succeeds.
- Do not accept a group-only native pass as S4 descendant support. A valid stronger backend remains unimplemented.

Integration/SDK byte-copy, binary packaging/signing/distribution, and complete S4/S6 three-platform acceptance remain with their owners. The copied wrapper must include `windows-transport.ts` or bundle it. Nothing in this process-only patch performs that synchronization.
