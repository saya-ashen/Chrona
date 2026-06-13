# T10 — Manual golden-path checklist (Claude Code provider)

> **Status:** Manual evidence form. Per `tasks.md` T10: *"manual run + recording
> acceptable as evidence"*. Run this on a workstation with `claude` on `PATH`
> and an `ANTHROPIC_API_KEY` available. CI does **not** spawn real Claude Code
> (T9); this file gives the exact steps a human (or a record-on-CI runner with
> the binary + key) needs to capture and attach to a PR.
>
> **Records required:** (1) terminal log OR (2) a screen recording of the full
> run. Attach the file (or a link) to the PR under "T10 evidence".

---

## 0. Prerequisites (one-time, per machine)

1. **Claude Code CLI ≥ latest stable.** `claude --version` prints a version
   string. If missing, install: <https://docs.claude.com/en/docs/claude-code/setup>.
2. **Anthropic API key** with quota. Export it in the shell that runs the
   Chrona server, e.g. `export ANTHROPIC_API_KEY=sk-ant-…`.
3. **Chrona dev server up and reachable** on `http://localhost:3000` (default
   `CHRONA_PORT`). Verify: `curl http://localhost:3000/api/health` returns OK.
4. **Task orchestrator enabled.** Either:
   - accept the defaults (`CHRONA_TASK_ORCHESTRATOR_ENABLED=true` is the
     default for dev), **or**
   - for fully-deterministic runs, set
     `CHRONA_TASK_ORCHESTRATOR_TICK_ON_START=true` so a tick fires on server
     boot — this lets the recording skip the wait.

## 1. Add the Claude Code client in Settings

1. Open `http://localhost:3000/settings/ai-clients` (path may differ by app
   version; Settings → AI Clients).
2. Click **Add client** → choose **Claude Code** from the type dropdown.
3. Fill in:
   - **Name**: `claude-code-local` (or anything).
   - **Model**: leave blank to let Claude pick, or set
     `claude-sonnet-4-6` (matches the default the provider wires).
   - **Binary path**: leave blank to use `claude` on `PATH`, or set the
     absolute path (e.g. `/usr/local/bin/claude`).
   - **API key**: paste `ANTHROPIC_API_KEY` (or set
     `CHRONA_PUBLIC_URL=…` and let the server forward it via env).
   - **MCP base URL**: blank (defaults to the engine's own
     `http://localhost:3000`).
   - **Timeout**: 120s is a safe default.
4. Click **Diagnose** — expect: ✅ "Claude Code CLI is reachable".
5. Bind the client to **`dispatch_task`** and **`execute_task_node`** in the
   feature-binding panel.
6. Mark the client **default** if you want auto-start to pick it.
7. Save.

**Checkpoint:** Settings page shows the new client as `Enabled = true` and
bound to both features.

## 2. Create a scheduled task due shortly

1. Go to **Work** → **New task**.
2. Title: `T10 golden-path probe`.
3. Description: a small, well-scoped instruction. Example:
   > "List the current time and confirm Chrona's `/api/health` returns 200.
   > Call `chrona.task.complete` with status `completed` and a one-line
   > summary. Do not modify any files."
4. Set **Schedule**: a block starting **~2 minutes from now** (so the
   orchestrator tick will see it as due shortly).
5. Save.

**Checkpoint:** task appears on the **Schedule** page inside the time block
with no plan yet.

## 3. Wait / drive the orchestrator

If `CHRONA_TASK_ORCHESTRATOR_TICK_ON_START=true` (or the default
interval-based loop is short), the orchestrator will:

1. **Auto-generate a plan** for the due task (no manual click).
2. **Auto-start execution** when the block becomes due and eligible.

If you left the default interval, wait the configured interval (`CHRONA_TASK_ORCHESTRATOR_INTERVAL_MS`,
default ~30s) and refresh.

**Checkpoint:** the task row on Work page transitions
`scheduled → planning → running` without any human click.

## 4. (Conditional) Inbox recovery

**This step only triggers if the agent pauses.** Common reasons:
- Agent called a Chrona MCP tool with bad args → `Blocked` Inbox item.
- Agent asked for approval → `WaitingForApproval` Inbox item.
- Network error → `WaitingForInput` Inbox item with the failing request.

If an Inbox item appears:

1. Open **Inbox**.
2. Read the reason (it should be plain language, not a log).
3. Click the **primary recovery action** the Inbox card offers.
4. Execution resumes.

If no Inbox item appears (the happy path), skip this step.

## 5. Completion

1. The task reaches `completed` on the Work page.
2. The final result is persisted (visible on the task detail page).
3. The provider run produced a `run_completed` event with usage stats — open
   the run's record (or the in-app run panel) to confirm tokens were
   consumed (non-zero).

**Checkpoint:** Work page shows `T10 golden-path probe` as
**Completed**, with an inspectable result.

## 6. Record the evidence

Capture one of:

- **Screen recording** (preferred): any common tool (`asciinema`,
  `ffmpeg -f x11grab`, macOS Screen Recording, etc.) covering steps 1–5.
- **Terminal log**: enable `CHRONA_LOG=debug` and tail the server log for
  the run, plus paste the Settings → AI Clients page screenshot.

Attach the artifact to the PR under the "T10 evidence" section. Reference
the recording / log file by URL or path in the **Verification matrix** row
for **B5 — Golden path with Claude Code**.

## 7. What "passes" means

The golden path passes (per milestone §1.3) when:

- [ ] Auto-plan generated without manual click.
- [ ] Auto-start fired when the block became due.
- [ ] (Conditional) Inbox recovery worked if the agent paused.
- [ ] Task reached `completed` with an inspectable result.
- [ ] At no point did you need to read a log file to understand state.

If any box is unchecked, file a bug with the recording and link it from
this checklist. Do **not** disable the assertion to make it green — file
the failure and harden the product or the test (milestone §3 WS-A
non-goal: do not weaken E2E).

---

## Cross-references

- Milestone golden path: [`docs/en/milestone-0.2.md`](../../docs/en/milestone-0.2.md) §1.3
- Spec acceptance row: [`spec.md`](./spec.md) §8 (the "milestone golden path" bullet)
- Verification matrix row: [`tasks.md`](./tasks.md) verification matrix → **B5**
- Agent MCP contract: [`docs/en/architecture.md`](../../docs/en/architecture.md)
  → "Agent ↔ Chrona contract" (AI-visible refs)
