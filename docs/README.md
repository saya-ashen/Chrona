# Chrona Documentation

Chrona is evolving into an open-source, local-first, executor-independent work
and results workspace. Its current implementation includes managed planning,
scheduling, execution, and review; direct external result intake is a target,
not a shipped capability.

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
| Implement executor-independent results | [Contracts, compatibility and B1 implementation (Chinese)](./zh/work-results-phase-a.md) — B1 foundation verified; B2 transport/upload next |
| See shipped and planned product areas | [Roadmap](./en/roadmap.md) |
| Build an optional proactive-assistant workflow | [Proactive Personal Assistant Plan](./en/proactive-personal-assistant-plan.md) — capture/edit deployed; unimplemented execution-first sequence superseded |
| Compare reuse options for assistant result delivery | [Assistant Delivery](./en/assistant-delivery.md) — recommendation, not configured |
| Capture Goals from an everyday agent | [Chrona Assistant Skill](../packages/skills/chrona-assistant/README.md) — repository-owned, not auto-installed |
| Integrate over HTTP or MCP | [API Reference](./en/api-reference.md) |
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
| 开始实施不依赖执行者的成果闭环 | [契约、兼容设计与 B1 实现](./zh/work-results-phase-a.md) — B1 基础已验证，下一步 B2 接入与上传 |
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

Chrona currently centers on four active product surfaces:

1. Dashboard: review today’s focus, attention items, active work, latest results, and recoverable execution state.
2. Schedule: arrange time blocks, inspect conflicts, accept schedule proposals, and make schedule-driven automation visible.
3. Tasks: create tasks, generate/review/accept plans, execute work, inspect results, and recover blocked or failed runs.
4. Settings: configure AI clients, feature bindings, provider health, schedule automation defaults, and local diagnostics.

Action Center is the current attention surface. Memory may still exist as an internal API/data source, but it is not a current primary navigation surface.

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
