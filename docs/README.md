# Chrona Documentation

> AI-native task control plane — plan, schedule, and execute work through AI agents.

This documentation follows the [Diátaxis](https://diataxis.fr/) framework, organizing content by the reader's goal rather than by topic.

## Navigation by need

| I want to... | Read this |
|-------------|-----------|
| **Get started** — install and run Chrona in 2 minutes | [Quick Start (EN)](./en/quick-start.md) \| [快速开始（中文）](./zh/quick-start.md) |
| **Understand the design** — why CQRS, how layers connect | [Architecture](./architecture.md) |
| **Explore the database** — schema, relationships, enums | [Data Model](./data-model.md) |
| **Integrate via API** — full REST endpoint reference | [API Reference](./api-reference.md) |
| **See product direction** — what's shipped, what's next | [Roadmap (EN)](./en/roadmap.md) \| [路线图（中文）](./zh/roadmap.md) |
| **Contribute code** — setup, conventions, PR workflow | [CONTRIBUTING.md](../CONTRIBUTING.md) |

## Language

| Language | Entry point |
|----------|-------------|
| English | [./en/README.md](./en/README.md) |
| 中文 | [./zh/README.md](./zh/README.md) |

## Diátaxis map

```
                  ┌─────────────┐
                  │   GETTING   │
                  │   STARTED   │
                  │ quick-start │
                  └──────┬──────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   ┌────────────┐ ┌────────────┐ ┌────────────┐
   │ TUTORIALS  │ │ HOW-TO     │ │ EXPLANATION│
   │ (learning) │ │ (solving)  │ │ (theory)   │
   │            │ │            │ │            │
   │ quick-start│ │ CLI docs   │ │ architecture│
   │            │ │ API ref    │ │ data-model │
   └────────────┘ └────────────┘ └────────────┘
                         │
                         ▼
                  ┌────────────┐
                  │ REFERENCE  │
                  │ (looking   │
                  │  up facts) │
                  │            │
                  │ api-ref    │
                  │ data-model │
                  └────────────┘
```

## Core documents

| Document | Category | Description |
|----------|----------|-------------|
| [Quick Start (EN)](./en/quick-start.md) | Tutorial | Install, configure, and run your first task |
| [快速开始（中文）](./zh/quick-start.md) | Tutorial | 安装、配置和运行第一个任务 |
| [Architecture](./architecture.md) | Explanation | CQRS + Event Sourcing design, data flow, modules |
| [Data Model](./data-model.md) | Reference | Full database schema, ERD, enums, indexes |
| [API Reference](./api-reference.md) | Reference | All REST endpoints with curl examples |
| [Roadmap (EN)](./en/roadmap.md) | Explanation | Product direction, phases, principles |
| [路线图（中文）](./zh/roadmap.md) | Explanation | 产品方向、阶段、设计原则 |
