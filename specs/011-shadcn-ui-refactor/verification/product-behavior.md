# Product Behavior Verification

## State Clarity

| Surface | Verification |
|---|---|
| Schedule | Task filters, conflict severity, proposal/conflict tabs, selected block details, and schedule form labels remain visible through existing schedule tests. |
| Task workspace | Current node, active node tone, execution overview, action panel, evidence, and configuration remain explicit through workspace component tests. |
| Work inspector | Graph-native plan groupings, current node, waiting nodes, checkpoints, and linked child tasks remain visible through work tests. |
| Shell | Schedule, Tasks, and Settings navigation remains visible; removed legacy Inbox/Memory/Workspaces nav entries stay absent. |
| Inbox/memory | Action type/risk/task/run/consequence and memory content/source/scope/status/task/run links remain asserted. |

## Loading, Empty, Partial, Error States

- Empty node/result states remain local feature compositions using shadcn primitives where relevant.
- Pending buttons in schedule and conflict flows remain disabled with user-facing pending labels.
- Error messages remain rendered in migrated forms/panels without backend contract changes.
- Partial runtime output and evidence cards remain visible in task/work run result surfaces.
