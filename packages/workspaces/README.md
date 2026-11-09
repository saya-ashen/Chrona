# @chrona/workspaces

Public host library for physical Git workspaces. Import from `@chrona/workspaces`.
It has no Chrona kernel, executor protocol, journal, model, or transport dependencies.
The server host and device adapters share this implementation.

- `prepareLockedLocalWorkspace(input, options?)` verifies a trusted canonical mapping and exact commit baseline, prepares or reopens a retained independent worktree, acquires durable physical locks, and verifies source bytes before returning. Call `release()` only after the host is finished using the directory. Release is idempotent and checks lock ownership. `prepareLocalWorkspace` is also exported for callers that already hold the required locks.
- `verifyLocalSource` rechecks the commit and manifest files on disk. Receipts bind the caller's opaque placement, baseline, sorted manifest digest, count and verification time. Symlinks and paths escaping the workspace are refused.
- `localDirectoryIdentity` binds canonical path, device and inode. `physicalLockIdentity` binds device and inode, preventing aliases from bypassing locks within the same managed lock root.
- `recoverWorkspaceLocks(managedRoot, owner, recorded)` releases only matching durable owner/key/token records. **The trusted caller must verify actual stop or durable never-started evidence first.** The library cannot establish process stop. Legacy locks without owner evidence remain held. Optional `recordLock` persists each key/token before creation; `owner` is an opaque durable binding supplied by the host.
- `cleanupLocalWorkspace(input, command, verify)` retains worktrees until an explicit preview/confirm command. The trusted `verify` callback must recheck stop, authorization, references/holds and source bindings, returning a stable digest of those facts. Cleanup also checks ownership, physical/repository identity, retention protection, clean Git state (including ignored/untracked files), and integration of the worktree HEAD into the source HEAD. It never force-removes or deletes the source repository. Replayed commands return fixed receipts; uncertain deletion intent blocks later attempts without repeating removal.

Callers validate and authorize their requests before filesystem access. `binding` and
`mapping.placement` remain host-owned opaque data; the library does not interpret
caller identity, Run or device authority. Each host must share one private canonical
`managedRoot` for workspaces that require mutual exclusion. Baseline kinds retain
the existing `commit | snapshot` shape, but physical preparation currently requires
an exact commit. No process manager is invoked; the only external program used is Git.

Workspace hashes, paths, ownership records and lock contents preserve the previous
physical implementation's format. The local ownership limit remains 1024 records;
cleanup receipts remain bounded at 2048. These are local storage bounds independent
of any transport's limits.

Run offline tests with:

```sh
bun test packages/workspaces/src
```
