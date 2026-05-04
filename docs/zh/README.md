# Chrona 文档 — 中文

Chrona 是一个 AI 原生任务控制台，目标是把"想法、排期、执行"串成一个连续流程。

**安装：** `npm install -g @chrona-org/cli`

## Diátaxis 分类内容

### 教程 — 边做边学

| 文档 | 学习目标 |
|------|---------|
| [快速开始](./quick-start.md) | 安装、配置 AI 后端、创建并运行第一个任务 |

### 操作指南 — 解决具体问题

| 文档 | 解决的问题 |
|------|----------|
| [API 参考](../api-reference.md) | 通过任意端点集成 — 每个操作都有 curl 示例 |
| [CONTRIBUTING.md](../../CONTRIBUTING.md) | 搭建开发环境、运行测试、提交 PR |

### 解释 — 理解设计

| 文档 | 理解内容 |
|------|---------|
| [系统架构](../architecture.md) | CQRS + 事件溯源、数据流、模块依赖、设计决策 |
| [包边界说明](../package-boundaries.md) | `packages/*` 各自负责什么、不负责什么，以及代码应该放哪里 |
| [路线图](./roadmap.md) | 产品愿景、当前阶段、计划功能、设计原则 |

### 参考 — 查阅事实

| 文档 | 查阅内容 |
|------|---------|
| [数据模型](../data-model.md) | 完整 schema：15 个模型、所有枚举、ERD、索引、状态机 |
| [API 参考](../api-reference.md) | 每个端点的 HTTP 方法、路径、参数、请求/响应 schema |
| [测试指南](./testing.md) | 测试运行器、覆盖范围、Mock 策略、编写新测试 |

## 推荐阅读顺序

1. [快速开始](./quick-start.md) — 2 分钟跑起来
2. [系统架构](../architecture.md) — 理解系统设计
3. [包边界说明](../package-boundaries.md) — 建立对 monorepo 分层的掌控感
4. [API 参考](../api-reference.md) — 探索完整 API

## 快速链接

- [根 README](../../README.md) — 项目概览和功能特性
- [包边界说明](../package-boundaries.md) — 快速判断新代码应该放在哪个包
- [数据模型](../data-model.md) — 数据库 schema 深入解析
- [路线图](./roadmap.md) — 下阶段规划
