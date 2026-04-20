# Chrona Roadmap

## Product framing

Chrona is being shaped around two major product areas:
- schedule creation and arrangement
- task automatic completion

The long-term goal is to make the schedule not just a passive calendar, but the control surface that continuously drives real task execution.

## Roadmap

### Phase 1 — Scheduling cockpit

Focus:
- make schedule creation feel fast and intelligent
- make the scheduling UI usable as a daily cockpit
- reduce friction between creating an idea and turning it into scheduled work

Key capabilities:
- intelligent prompts while creating tasks or schedule blocks
- smart task suggestions from partial text
- AI task planning before execution
- quick review and adjustment of the generated plan

### Phase 2 — Plan-aware task execution

Focus:
- connect scheduled work with actual agent runs
- treat the task plan as a live object instead of static setup text

Key capabilities:
- automatically trigger an agent according to the schedule
- execute tasks through the configured runtime backend
- keep execution progress connected to the task plan
- automatically update the plan as the agent makes progress or discovers changes

### Phase 3 — Multi-runtime backend support

Focus:
- keep the Chrona product model stable while allowing different AI runtimes underneath

Backend support direction:
- bare LLM backends for lightweight planning/execution flows
- OpenClaw for agent-style execution flows
- Hermes for deeper agent/tool orchestration

Design goal:
- one product workflow
- multiple runtime implementations
- shared task, schedule, and plan model across runtimes

## Guiding principles

- schedule and execution should not drift apart
- plans should be editable before execution and updateable during execution
- runtime choice should be infrastructure, not a user-facing architectural burden
- the product should remain useful even before full automation is complete
