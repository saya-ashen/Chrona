# Chrona Documentation

Chrona is evolving into an open-source, local-first, executor-independent work
and results workspace. Its implementation includes managed planning, scheduling,
execution, and review; B1–B3 external result intake is integrated on the authorized
instance. Work records and meeting follow-through are also deployed and connected
to Pi on that authorized instance; writes remain opt-in elsewhere. Human workflow
acceptance, Goal reuse and legacy-result convergence remain pending. The working
tree now adds content-first work pages with persistent notes/forms; this newer
slice is **not deployed** and does not expand existing credentials.

Use this directory as the stable product and developer documentation set. Time-point audits, refactor notes, and design-debt records are removed once their lasting content is merged into stable docs.

## Design authority and reading order

1. [Product Architecture / 产品架构](./zh/product-architecture.md): canonical
   product destination, ownership, non-goals, and acceptance gates. The canonical
   document is in Chinese; [System Architecture](./en/architecture.md) provides
   the English technical summary.
2. [System Architecture](./en/architecture.md) and
   [Package Boundaries](./en/package-boundaries.md): current structure and where
   the target should evolve without a repository-wide rewrite.
3. [Data Model](./en/data-model.md), [Execution Flow](./en/backend-execution-flow.md),
   and [API Reference](./en/api-reference.md): current implementation contracts.
4. [Roadmap](./en/roadmap.md): staged priorities and implementation status.

Product direction supersedes older execution-first planning assumptions, not
shipped security, lifecycle, or migration contracts. Domain plans must identify
their scope and status instead of silently redefining the whole product.

## English docs

| Need | Document |
| --- | --- |
| Install and run Chrona | [Quick Start](./en/quick-start.md) |
| Understand local data, external providers, and deletion | [Privacy](./en/privacy.md) |
| Understand the product surface | [Product Guide](./en/README.md) |
| Decide what Chrona should become | [Product Architecture (canonical, Chinese)](./zh/product-architecture.md) — target, not shipped |
| Implement executor-independent results | [Contracts and implementation (Chinese)](./zh/work-results-phase-a.md) — B1–B3 implemented; authorized instance integrated, human review and phase C pending |
| See shipped and planned product areas | [Roadmap](./en/roadmap.md) |
| Build an optional proactive-assistant workflow | [Proactive Personal Assistant Plan](./en/proactive-personal-assistant-plan.md) — capture/edit deployed; unimplemented execution-first sequence superseded |
| Compare reuse options for assistant result delivery | [Assistant Delivery](./en/assistant-delivery.md) — recommendation, not configured |
| Capture Goals from an everyday agent | [Chrona Assistant Skill](../packages/skills/chrona-assistant/README.md) — repository-owned, not auto-installed |
| Integrate over HTTP or MCP | [API Reference](./en/api-reference.md) |
| Submit/review independent text and file results | [Work Result Entries](./en/work-results.md) — B1–B3, explicit scopes and opt-in writes |
| Connect an everyday external Agent | [Integration and deployment](./en/work-results-integration.md) · [Result skill](../packages/skills/chrona-results/SKILL.md) |
| Compose useful Agent-authored pages with persistent forms | [Work pages](./en/work-pages.md) · [Agent skill](../packages/skills/chrona-pages/SKILL.md) — local implementation, not deployed |
| Organize all content with exclusive folder groups | [Content library](./en/content-library.md) · [Agent skill](../packages/skills/chrona-library/SKILL.md) — local implementation, not deployed |
| Record external work and meeting follow-through | [Work records](./en/work-records.md) · [Agent skill](../packages/skills/chrona-work-records/SKILL.md) — authorized instance deployed; human acceptance pending |
| Understand system architecture | [Architecture](./en/architecture.md) |
| Trace execution internals | [Backend Execution Flow](./en/backend-execution-flow.md) |
| Understand persistence | [Data Model](./en/data-model.md) |
| Change schema without breaking released databases | [Migration Release Lines](./en/migrations.md) |
| Place code in the right package | [Package Boundaries](./en/package-boundaries.md) |
| Understand the frontend (`apps/web`) | [Frontend Structure](./en/frontend-structure.md) |
| Extend AI/runtime providers | [Provider Boundary](./en/provider-boundary.md) |
| Reuse the official local Pi CLI | [Pi Provider (experimental)](./en/pi-provider.md) |
| Understand the accepted Goal, trigger, and occurrence target design | [Long-Horizon Goals and Triggers](./en/long-horizon-goals-and-triggers.md) |

## 中文文档

| 需求 | 文档 |
| --- | --- |
| 安装并运行 Chrona | [快速开始](./zh/quick-start.md) |
| 理解当前产品界面 | [中文指南](./zh/README.md) |
| 确定 Chrona 要成为什么、职责边界与验收标准 | [产品架构](./zh/product-architecture.md) — 后续开发基线，非已交付能力 |
| 开始实施不依赖执行者的成果闭环 | [契约、兼容设计与实现](./zh/work-results-phase-a.md) — B1–B3 已实现且授权实例已接入，人工验收与阶段 C 待完成 |
| 使用内容优先的页面、笔记与版本绑定表单 | [页面契约与本地演示（英文）](./en/work-pages.md) · [本版实施记录](./zh/work-pages-v1-implementation.md) — 未部署 |
| 用互斥分类组和文件夹组织全部内容 | [内容目录契约（英文）](./en/content-library.md) · [本版实施记录](./zh/content-library-implementation.md) · [Agent 整理技能](../packages/skills/chrona-library/SKILL.md) — 未部署 |
| 记录会议事项、独立状态与操作回执 | [事项工作台与验证记录](./zh/work-records-meetings.md) — 已授权部署／接入，人工验收待完成 |
| 查看已发布与计划中的产品区域 | [路线图](./zh/roadmap.md) |
| 通过日常 Agent 接入可选主动助理工作流 | [领域计划（英文）](./en/proactive-personal-assistant-plan.md) — 捕获/编辑已部署，未实施的执行优先顺序已被新方向替代 |
| 运行测试 | [测试指南](./zh/testing.md) |
| 修改 schema、保留已发布库兼容性 | [发布迁移与升级规范（英文）](./en/migrations.md) |
| 复用本机官方 Pi CLI | [Pi Provider（实验性）](./zh/pi-provider.md) |
| 理解 Goal Workbench 资产使用区的目标设计 | [Goal Workbench 产品设计](./zh/goal-workbench-product-design.md) |
| 设计 AI Feature 的 Observation、Action、Result 与 Completion | [AI Feature Runtime 架构与实施规范](./zh/ai-feature-runtime-architecture.md) |
| 从外部 Agent 管理 Chrona 任务 | [管理 MCP 接入与当前能力](./zh/management-mcp.md) |
| 理解外部 Agent 管理 MCP 的目标设计 | [网页能力对等设计](./zh/external-agent-task-mcp-design.md) |

## Shared/generated docs

| Need | Document |
| --- | --- |
| See feature/test coverage map | [Feature + Test Map](./maps/feature-test-map.md) (check/regenerate source: `bun run map:check`) |

## Current product areas

In the working-tree UI, Home (`/:lang/home`) provides an organized, searchable
library of all content with user-defined classification groups and folders, not
a recent-items selection. Calendar and Action Center remain primary; More tools reveals the
existing dashboard, work inbox, Goals, Tasks and Settings. Manual Tasks open their
content page; managed Tasks retain execution controls. This navigation is not yet
deployed. The underlying advanced surfaces remain:

1. Dashboard: review today’s focus, attention items, active work, latest results, and recoverable execution state.
2. Schedule: arrange time blocks, inspect conflicts, accept schedule proposals, and make schedule-driven automation visible.
3. Tasks: create tasks, generate/review/accept plans, execute work, inspect results, and recover blocked or failed runs.
4. Settings: configure AI clients, feature bindings, provider health, schedule automation defaults, and local diagnostics.

The Work records surface adds a matter-first workbench for explicitly enrolled
manual Tasks. Action Center composes work follow-up with the existing execution
attention queue. The authorized instance enables it; writes remain opt-in for
other deployments.
Memory may still exist as an internal API/data source, but it is not a current
primary navigation surface.

## Runtime shape

Chrona is a Bun/TypeScript monorepo:

| Area | Path | Role |
| --- | --- | --- |
| Web app | `apps/web` | Vite + React 19 + React Router SPA |
| API server | `apps/server` | Hono routes on Bun |
| CLI | `packages/cli` | Packaged entry point for starting Chrona |
| Contracts | `packages/contracts` | API schemas, AI feature specs, runtime event types, MCP tool schemas |
| Engine | `packages/engine` | Business use cases for tasks, plans, execution, scheduling, projections, AI clients |
| Graph runtime | `packages/graph-runtime` | Plan graph build/resolve/transition/command execution primitives |
| Database | `packages/db` + `prisma` | SQLite and Prisma 7 schema/migrations/seed |
| Providers | `packages/providers/*` | External runtime/provider protocol adapters |
| Hermes plugin | `external-plugins/hermes` | Chrona tools exposed to Hermes Agent |

This table is a curated subset. For the complete package list (including
`domain`, `ui-protocol`, `i18n`, `shared`) and the placement
rules, see [Package Boundaries](./en/package-boundaries.md).

## Common commands for repository development

Run from the repository root:

```bash
bun install
bun run dev
```

Useful checks:

```bash
bun run typecheck
bun run lint
bun run test
bun run test:bun
bun run test:api
bun run check:ui-foundation
bun run check:boundaries
```

Long-lived server only:

```bash
bun run server:start
```

Web dev server only:

```bash
bun run dev:web
```

## Documentation maintenance rules

- Keep the product direction in one canonical document; domain plans link to it
  instead of creating competing product constitutions.
- Separate target requirements, current implementation, and verified deployment.
  Update owning contract docs only when corresponding changes are implemented.
- Keep install/run commands aligned with root `package.json`.
- Keep API reference aligned with `apps/server/src/routes/**`.
- Keep MCP tool docs aligned with `packages/contracts` and `apps/server/src/routes/mcp`.
- Keep package boundary docs aligned with actual package directories.
- Delete dated audits, phase plans, release-candidate notes, and refactor-debt logs once their lasting content is merged into stable docs.
