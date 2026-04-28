# Chrona Roadmap

> **Current version:** 0.1.2
> **Status:** Phase 1 — Scheduling Cockpit

---

## Product Framing

Chrona is shaped around three major product areas:

- **Schedule creation & arrangement** — turn ideas into structured, time-bound work
- **Task automatic completion** — let AI agents execute that work with continuous oversight
- **Agent integration** — make Chrona the "action destination" that agents can push work into from conversations, emails, and notes

The long-term goal: make the schedule not just a passive calendar, but the **control surface that continuously drives real task execution**.

---

## Guiding Principles

1. **Schedule and execution should not drift apart** — the plan you schedule is the same plan the agent executes
2. **Plans should be editable before execution and updateable during execution** — not static instructions
3. **Runtime choice should be infrastructure, not a user-facing architectural burden** — one UX, many backends
4. **The product should remain useful even before full automation is complete** — usable at every maturity level

---

## Phases

### Phase 1 — Scheduling Cockpit ✅ *(current, shipping)*

> Focus: make schedule creation fast and intelligent

| Capability | Status |
|-----------|--------|
| Smart task suggestions from partial text (auto-complete) | ✅ Shipped |
| AI task plan generation with streaming SSE | ✅ Shipped |
| Editable plan graph (nodes, edges, dependencies) | ✅ Shipped |
| Accept/dismiss flow for AI-generated plans | ✅ Shipped |
| Calendar view with drag-and-drop time blocks | ✅ Shipped |
| Schedule conflict detection | ✅ Shipped |
| AI timeslot suggestions | ✅ Shipped |
| Multi-language UI (English, Chinese) | ✅ Shipped |
| Zero-config install (`npm install -g` + `chrona start`) | ✅ Shipped |
| Assistant chat with task plan proposals | ✅ Shipped |
| Inbox triage (approvals, proposals, suggestions) | ✅ Shipped |

### Phase 2 — Autonomous Task Execution 🚧 *(in progress)*

> Focus: agents run on schedule, intelligently decide which tasks need human attention — and auto-complete the rest

| Capability | Status |
|-----------|--------|
| Auto-trigger agents by schedule (background scheduler) | 🚧 In progress |
| Execute tasks through configured runtime backend | 🚧 In progress |
| Intelligent task triage — skip tasks requiring human judgment, auto-complete the rest | 📋 Planned |
| Live execution progress connected to task plan | 🚧 In progress |
| Dynamic plan updates as agent progresses | 📋 Planned |
| Resume and retry across sessions | 🚧 In progress |
| Mid-run operator intervention (input, approval) | 🚧 In progress |

### Phase 3 — Multi-Runtime Backend Support 📋 *(planned)*

> Focus: one product workflow, multiple runtime engines

| Capability | Status |
|-----------|--------|
| Bare LLM backend for lightweight planning/execution | 📋 Planned |
| OpenClaw bridge for agent-style execution | 🚧 In progress |
| Hermes provider for deeper agent/tool orchestration | 📋 Planned |
| Opencode provider for agent runtime | 📋 Planned |
| Runtime adapter interface (`RuntimeExecutionAdapter`) | 🚧 In progress |
| A/B testing across runtime backends | 📋 Planned |
| Runtime migration tooling | 📋 Planned |

### Agent Integration — MCP Tool / Skill 🚧 *(in progress)*

> Focus: make Chrona the "action destination" for AI agents. When an agent identifies work during a conversation, it can push it into Chrona's execution pipeline.

Chrona will expose an MCP (Model Context Protocol) tool or Skill that external agents (OpenClaw, Claude, etc.) can call to create tasks, generate plans, and schedule work programmatically. This turns every AI conversation into a potential source of structured, executable tasks.

| Capability | Status |
|-----------|--------|
| MCP tool: create task from agent context (title, description, priority, time block) | 🚧 In progress |
| MCP tool: generate plan for a new or existing task | 📋 Planned |
| Agent proactively asks user: "Should I schedule this in Chrona?" | 📋 Planned |
| Auto-create tasks from external sources (email, notes, etc.) via agent parsing | 📋 Planned |
| Chrona as a registerable Skill for OpenClaw and compatible runtimes | 📋 Planned |

**Key use cases:**

1. **Conversation → task** — you're chatting with an agent about a bug; the agent detects this and asks: *"Want me to create a Chrona task to track this fix? I'll schedule it for tomorrow morning."*

2. **Email → task** — an agent reads your inbox, identifies action items, and auto-creates Chrona tasks with appropriate priorities and time blocks — no manual data entry.

3. **Meeting notes → execution plan** — an agent processes meeting notes, generates a structured Chrona plan with subtasks, and asks for your approval.

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Shipped — available in current release |
| 🚧 | In progress — active development |
| 📋 | Planned — on the roadmap |
| 💡 | Proposed — under consideration |

---

## How to Contribute

The roadmap is driven by real usage patterns and community feedback. If you have ideas:

1. Open a [GitHub Issue](https://github.com/saya-ashen/Chrona/issues)
2. Tag it with `enhancement` or `feature-request`
3. Describe your use case — what problem would this solve for you?

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for development setup.
