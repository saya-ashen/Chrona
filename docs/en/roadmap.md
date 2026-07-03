# Chrona Roadmap

Current version: 0.1.9

Chrona is an open-source AI schedule app. Its job is not to compete with models at raw planning, summarization, or tool choice. Those capabilities will keep moving into the model layer. Chrona should compound around what stronger AI makes more important: time-bound execution, human control, provider governance, observable state, recoverable failures, and trusted results.

The product loop is:

```text
Task -> Plan -> Schedule -> Execute -> Review/Recover
```

AI-first means every surface should help AI move scheduled work forward safely, and every AI action should remain visible, controllable, and recoverable by the user.

## Strategic thesis: what gets cheaper, what gets more valuable

As AI gets stronger, some Chrona capabilities become entry points rather than durable differentiation:

| Capability | Trend | Roadmap consequence |
| --- | --- | --- |
| Raw task decomposition | Gets cheaper | Treat plan generation as an entry point, not the moat. |
| Generic summaries | Gets cheaper | Dashboard AI should perform action triage, not decorative recap. |
| Tool/MCP support by itself | Gets cheaper | Expose user value: safe refs, auditability, recovery, and permission boundaries. |
| Provider count | Gets cheaper | Optimize for provider behavior consistency, not a logo collection. |
| Generic AI UI generation | Gets cheaper | Make json-render a trusted result layer with validation and fallback. |

Chrona's durable value should grow with AI capability:

| Durable capability | Why it compounds with stronger AI |
| --- | --- |
| Schedule-triggered execution | Stronger AI can do more work, but still needs user-owned time constraints. |
| Human approval and recovery | More capable automation raises the cost of unchecked mistakes. |
| Observable execution records | Longer AI work needs explainable progress, evidence, and failure causes. |
| Unified user-facing work state | More dynamic AI behavior creates more internal states; users need one clear status and next action. |
| Provider capability governance | AI runtimes will multiply; product behavior must stay consistent. |
| Trusted result surfaces | AI output becomes richer; users need validated, reviewable, fallback-safe artifacts. |
| Local-first binary control | Schedules, tasks, provider credentials, and work outputs are sensitive user data. |

## Product pillars

1. **Task capture**: capture work, structure it, prioritize it, and keep status clear.
2. **Plan generation/review**: use AI to create and revise executable plans, but keep review and acceptance explicit.
3. **Schedule placement**: bind work to time, conflicts, due windows, and automation policy.
4. **Provider execution**: run AI/runtime-backed work through Hermes, Claude Code, Codex, and future providers without leaking provider quirks into product behavior.
5. **Result review/recovery**: make outputs, failures, cancellations, approvals, and waiting states inspectable from Dashboard and task workspace.
6. **Trusted AI surfaces**: use json-render for validated AI-authored results and insights while keeping runtime controls product-authored.

## Current baseline

These capabilities exist in the current codebase and should be treated as product baseline.

| Area | Current capability |
| --- | --- |
| Pages | Main user navigation is Dashboard, Schedule, Tasks, and Settings. Inbox and Memory may remain internal/hidden projections, but they are not current primary surfaces. |
| Tasks | Task create/update/delete, completion/reopen, priority, status, labels, dependencies, parent/child relationships, and task projection rebuilds. |
| AI planning | Streaming plan generation, generated-plan persistence, plan review/edit/accept flows, and materialization into executable task plan layers. |
| Graph plans | Executable `task`, `checkpoint`, `condition`, and `wait` nodes with graph state resolution. |
| AI node runtime | AI-visible refs for node completion, condition selection, block/fail, and wait completion; backend IDs stay behind server-side mapping. |
| Schedule | Timeline, task list, AI insights, conflicts, schedule proposals, task creation, configuration surfaces, and external-calendar busy context. |
| Dashboard | Today's focus, attention items, active runs, recent results, and recovery links for failed/cancelled/waiting work. |
| Task Workspace | Task editing, plan generation/acceptance, execution overview, latest result, plan graph, execution records, and node detail inspection. |
| Settings / AI Clients | Database-backed AI clients and feature bindings for Hermes, Claude Code, Codex, and development/debug flows. |
| Backend API | Task CRUD/lifecycle routes, plan generation/acceptance routes, task-scoped execution routes, workspace command/event transport, schedule projections, runtime provider routes, and AI client routes. |
| MCP / provider bridge | Streamable HTTP MCP tools and provider integrations that let external AI runtimes advance Chrona work through safe contracts. |
| External calendars | Read-only subscription sources, source validation/management, imported busy events, refresh status, and schedule context. |
| json-render | Validated AI-authored result surfaces and product-controlled runtime boundaries. |
| Release model | Bun-first development and packaged binary distribution. |

## AI-first operating principles

1. **Scheduled work is the product center.** Plans, providers, and result surfaces exist to move scheduled work forward.
2. **AI may propose; Chrona owns state.** Models can suggest plans, patches, summaries, and results, but Chrona owns task, schedule, execution, approval, and recovery state.
3. **Every non-happy path needs one clear next action.** Waiting, blocked, failed, cancelled, and review states must tell the user what to do next.
4. **Provider differences stay below the product layer.** Product UI should depend on capabilities and normalized events, not provider names.
5. **AI-authored UI is never runtime authority.** json-render can present results and insights; cancel, retry, approve, configure, and destructive actions remain product-authored controls.
6. **Local-first should feel simple.** Release users should not need to know Bun, schema generation, or provider internals to run the product.

## Near-term strategic arcs

Near-term work should make the existing AI schedule loop dependable before expanding product surface area.

### 1. Make Schedule-to-Execution the primary loop

Chrona should make it obvious how planned work becomes scheduled work, when scheduled work becomes AI execution, and how users recover when execution stops.

Focus:

- Show whether each scheduled block can auto-plan or auto-execute.
- Start due work only when configured, safe, and understandable.
- Keep schedule proposals reviewable, reversible where possible, and tied to visible work state.
- Connect Dashboard and Schedule directly to recovery actions for waiting, blocked, failed, and cancelled work.
- Treat external-calendar data as busy context and conflict input unless the user explicitly enables stronger automation.

Success looks like:

```text
Create task -> Generate/review plan -> Schedule -> Execute -> Review result -> Recover if needed
```

works as one visible product flow, not as disconnected backend features.

### 2. Unify user-facing work state across Dashboard, Schedule, and Tasks

Internal state will keep getting more complex as AI execution becomes more dynamic. Users need one clear state model.

Focus:

- Derive labels, tones, disabled reasons, and primary actions from one shared state model.
- Keep `WaitingForInput` and `WaitingForApproval` distinct.
- Keep `Failed`, `Blocked`, `Cancelled`, `Completed`, and `Done` semantically distinct.
- Make Dashboard, Schedule, and Task Workspace show the same state and next action for the same work item.
- Prefer a single user-facing state view over page-specific conditional logic.

Success looks like:

```text
same task + same execution facts -> same label, same severity, same primary action on every page
```

### 3. Turn execution records into an AI work cockpit

Raw runtime logs are not a user experience. Stronger AI will produce longer runs, more tools, more approvals, and more failures. Chrona must make that understandable.

Focus:

- Rework task workspace execution into a cockpit: current state, active node, provider, blockers, primary action, and latest result.
- Group execution history by run/session/step instead of one raw event stream.
- Separate final outputs, checkpoints, runtime events, tool calls, and assistant/user conversation.
- Keep conversation history across task runs.
- Summarize tool activity and failures without hiding evidence.

Success looks like:

```text
User can answer: what is running, why it stopped, what AI did, what result exists, and what action is safe now.
```

### 4. Normalize provider capabilities and recovery behavior

Hermes, Claude Code, Codex, and future providers should feel like different engines behind the same schedule execution product.

Focus:

- Maintain a provider capability matrix: health, start, stream, cancel, approval, resume, tool traces, structured output, snapshot recovery.
- Surface capability readiness in Settings.
- Normalize provider events before they reach product state.
- Show actions based on capability, not provider-specific UI branches.
- Add providers only after existing providers share consistent schedule-driven execution semantics.

Success looks like:

```text
same scheduled task + different provider -> same running/waiting/failed/completed product behavior
```

### 5. Make json-render a trusted AI result layer

json-render is a strategic direction when used as validated output, not as uncontrolled runtime authority.

Focus:

- Validate every AI-authored spec.
- Provide markdown/text fallback for invalid specs.
- Keep runtime controls product-authored and separate from AI-authored surfaces.
- Attach source, validation, and review metadata to AI-authored outputs.
- Use json-render for result review, dashboard action triage, plan explanations, reports, and artifacts.

Success looks like:

```text
AI output can be rich and structured, but bad specs never break execution controls or hide recovery actions.
```

### 6. Make first-run and binary release feel local-first, not developer-first

Bun-first is acceptable for development and packaging; release users should experience Chrona as a local app.

Focus:

- Keep packaged binary startup smooth: initialize storage, serve web UI, expose health, and guide provider setup.
- Provide a first-run path for Provider setup and a demo task flow.
- Hide Bun, schema generation, and internal ports unless troubleshooting.
- Keep local bind/auth behavior understandable and safe.

Success looks like:

```text
Download release -> start binary -> configure provider -> run demo schedule task -> inspect result
```

## Mid-term evolution

Mid-term work should deepen the AI schedule loop after near-term state, provider, and cockpit foundations are stable.

| Theme | Direction |
| --- | --- |
| Dynamic replanning | Let running tasks request plan changes, route them through review/acceptance, and resume safely after approval. |
| Execution recovery | Improve retry, resume, cancellation, blocked-state recovery, stale run reconciliation, and run/session diagnostics. |
| Provider orchestration | Coordinate provider selection by capability, task context, schedule policy, and recovery needs. |
| Multi-session execution | Coordinate multiple provider/runtime sessions for one task while preserving graph correctness and auditability. |
| Calendar intelligence | Use external calendars for busy context, conflict detection, and schedule suggestions while keeping Chrona task/execution state authoritative. |
| Trusted result artifacts | Make json-render outputs reviewable, source-linked, fallback-safe, and durable across task history. |
| Memory in service of execution | Use task/workspace memory to improve planning and node execution, not as a separate user-facing destination by default. |
| Projection consistency | Make page projections fast, task-scoped where possible, and consistent across Schedule, Dashboard, and Task Workspace. |
| Verification | Add focused tests for plan generation, graph execution, task-scoped execution actions, MCP/provider contracts, projections, schedule decisions, and json-render fallback. |

## Long-term direction

Long-term direction is strategic intent, not a near-term promise.

| Theme | Direction |
| --- | --- |
| Proactive AI scheduling | Let Chrona identify when work should be planned, scheduled, executed, reviewed, or deferred based on task state, user time, and provider capability. |
| External ingestion | Turn conversations, email, notes, and external systems into structured Chrona tasks that can be planned, scheduled, executed, and reviewed. |
| Human-governed automation | Support stronger automation while preserving approval boundaries, audit trails, recovery paths, and user-owned schedule policy. |
| Agent ecosystem | Let more agents and tools participate through explicit, inspectable contracts while Chrona remains the authoritative AI schedule app. |
| Collaboration | Add stronger multi-user review, approvals, audit trails, and shared execution context when single-user execution governance is solid. |
| Production hardening | Improve authentication, backup/restore, observability, migration safety, deployment docs, and operational runbooks without abandoning local-first simplicity. |
| Organization-scale planning | Connect individual tasks, schedules, dependencies, and execution history into project/portfolio visibility. |

## Contribution focus

Good areas to improve now:

- Keep documentation and examples aligned with the current AI schedule product.
- Strengthen the Task -> Plan -> Schedule -> Execute -> Review/Recover loop.
- Add narrow tests around user-facing work state, execution actions, provider contracts, projections, schedule decisions, and json-render fallback.
- Improve UI clarity in Dashboard, Schedule, Task Workspace, and Settings / AI Clients.
- Tighten provider/package boundaries when code drifts into the wrong layer.
- Prefer small, verifiable changes over broad rewrites.

## Guiding sentence

Chrona should not win by being better than future models at thinking. Chrona should win by making stronger AI useful on the user's schedule: visible, bounded, recoverable, and trusted.
