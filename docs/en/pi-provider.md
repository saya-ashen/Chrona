# Pi provider (experimental)

Chrona can use the **official Pi CLI**, separately from Oh My Pi (`omp`). The
adapter is `packages/providers/pi`; it runs `pi --mode rpc`. Pi must already be
installed on the **Chrona server's machine**, version **0.85.0 or newer**. It is
not bundled with Chrona. Codex remains the recommended stable default.

## Setup

1. In your terminal, configure/login to Pi and verify your chosen model works.
2. Open **Settings → AI Clients → Add Client**, choose **Pi**.
3. Leave model/provider blank to use Pi's default. Or specify an exact
   `provider/model-id`; with a separate provider field, put only the model ID
   in the model field. Model IDs containing slashes are preserved.
4. Optionally set **Pi agent directory** (`PI_CODING_AGENT_DIR`, normally
   `~/.pi/agent`) and **Pi working directory**. The latter controls project
   resource discovery and filesystem tool scope; default is Chrona server cwd.
5. Test connectivity, save, and explicitly select the desired feature bindings.
   Connectivity testing performs a small, potentially billable model request.

Do not copy Pi credentials into Chrona. The UI does not collect a Pi API key or
base URL: Pi owns authentication, model registry, settings and credential
helpers. `binaryPath` is an operator-only config escape hatch, not a UI field.
Chrona's service must have the appropriate PATH and permissions.

## Execution versus isolated features

- **Task execution:** discovers the existing Pi user/project extensions,
  skills, prompts and context using Pi's normal saved trust rules. No automatic
  trust approval. Trusted extensions and tools run with the server user's
  privileges; this is **not a sandbox**. Select a working directory/profile
  you trust. Chrona does not guarantee every third-party extension works in RPC.
- **Planning, Goal review, result finalization and read-only follow-ups:** disable
  automatic extensions, skills, prompt templates, themes and context discovery.
  Only explicitly declared result tools are enabled; automatic retry and
  compaction are disabled. These features require a model available without
  loading arbitrary extensions (built-in providers or `models.json`). Trusted
  credential helpers may still execute; isolation is a tool/resource contract,
  not OS-level containment.
- **Yes/no extension confirmations:** appear as a Chrona approval with
  approve-once/deny only. Unsupported selection, text/editor dialogs and startup
  interactions fail closed. TUI-only `ctx.ui.custom()` is unsupported by Pi RPC
  itself and may return no UI; do not use extensions requiring it unattended.
- Extension/protocol/startup failure stops the run. Chrona never silently retries
  with extensions disabled, switches transport, or falls back to another model.

## Control and continuity

Chrona injects a temporary, versioned bridge extension stored in its own data
area. It does not install anything in or edit the user's Pi profile. The parent
adapter keeps run-scoped credentials and communicates with `/api/mcp` and
`/api/agent/control`. Credentials are not put into Pi's arguments, extension
source, tool catalog or model prompt. Terminal execution submissions require a
durable engine acknowledgement; assistant text is not completion evidence.
The adapter waits for Pi's **`agent_settled`**, not `agent_end` (which can precede
retries, compaction and extension follow-ups). EOF or process exit before that
boundary, including exit code zero, is failure rather than successful completion.
The injected bridge uses Node's public namespaced JSON child-process IPC
(`stdio: ["pipe", "pipe", "pipe", "ipc"]`, JSON serialization), while Pi's
official stdin/stdout LF JSONL RPC remains unchanged. The parent waits for the
bridge's application-level `initialized` acknowledgement (complete catalog
registration) before requesting Pi state; `ready` follows only after both that
boundary and Pi session start. Native IPC callback acceptance is only a bounded
write fact, not proof Pi consumed a bridge reply. Startup is abortable;
subprocess and tool cleanup are bounded.

Result publication has separate deadlines: five minutes for composition and one
minute for optional editorial review. A validated candidate is persisted before
review (still not acceptable while Running). Failed, invalid or timed-out review
falls back to that candidate; late responses cannot overwrite a newer revision.

Sessions and operation claims live under
`<Chrona data directory>/providers/pi`. Only Chrona-owned session IDs can resume;
your interactive Pi history is not taken over. Effective models are resolved
before task model pinning and checked on launch/resume; silent model fallback
is rejected.

Session-history resume is **not** recovery of a running process. There is no
active-run lookup, stream replay/reconnect, or automatic restart replay. An
uncertain operation cannot be started twice; start a new operation explicitly
after reviewing evidence. An interrupted session lock also fails closed: use
fresh context rather than removing locks while another process might be active.

## Validation and limits

Deterministic tests cover JSONL framing, terminal acknowledgements, duplicate
submission, approvals, failures, cancellation, ownership and resume. Real Pi CLI
compatibility tests use temporary profiles and a local mock model, **not personal
credentials**:

```sh
bun test packages/providers/pi/src
CHRONA_RUN_LIVE_PI_TESTS=1 bun test packages/providers/pi/src/pi-aimock-live.bun.test.ts
```

The real CLI suite verifies extension tool execution, isolated result tools,
termination, consecutive compose/review sessions with 20KB requests, and
persisted-session resume. A separate bridge test checks exit while the parent
keeps its IPC input open. Linux Pi 0.85.0 is the validated
baseline; macOS/Windows and arbitrary extension stacks are not certified.
On POSIX cancellation terminates the child process group; Windows currently
terminates Pi itself and does not guarantee descendant cleanup. Detached work
created outside the process group by an extension has its own lifecycle.
