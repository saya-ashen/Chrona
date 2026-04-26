# Chrona 快速开始

## Chrona 现在在做什么

Chrona 目前主要围绕两个产品大块展开：
- 日程创建与安排
- 任务自动完成

前者负责把模糊意图变成可安排、可编辑的任务和时间块；后者负责让任务按照排期进入智能体执行，并持续更新任务计划。

## 环境要求

- Bun 1.x
- Git
- Prisma + SQLite 本地开发环境

## 安装

```bash
git clone <repo-url> Chrona
cd Chrona
bun install
```

## 初始化本地环境

```bash
bunx prisma generate
bun run db:seed
```

注意：当前这个仓库在本环境下执行 `bunx prisma db push` 并不稳定，因此这里暂时不把它作为主推荐初始化命令，等 Prisma 工作流稳定后再恢复。

## 启动 Web 应用 + 本地 API Server

```bash
bun run dev
```

打开：
- http://localhost:3100

开发端口：
- SPA dev server: `http://localhost:3100`
- 本地 API server: `http://localhost:3101`

生产 / local-first 启动方式：

```bash
bun run build
bun run start
```

然后打开：
- http://localhost:3101

## 后端运行时方向

Chrona 的后端设计目标是支持多种运行时后端，并保持统一的产品体验：
- 裸 LLM
- OpenClaw
- Hermes

也就是说，无论底层接哪一种运行时，排期、任务、计划和执行的产品模型都尽量保持一致。

## 当前产品流程

### A. 日程创建与安排

这个部分的重点是把"想做什么"快速变成"已经安排好的工作"。

当前/规划中的能力包括：
- 创建日程时的智能提示
- AI 辅助任务计划生成
- 把自然语言意图变成结构化任务计划
- 在日程 cockpit 中快速查看、调整和确认计划

### B. 任务自动完成

这个部分的重点是让任务可以沿着排期自动进入执行。

当前方向包括：
- 根据日程自动启动智能体
- 使用配置好的运行时完成任务
- 在执行过程中自动更新任务计划
- 保持"计划"和"执行状态"同步，而不是彼此脱节

## 常用命令

```bash
bun run dev
bun run build
bun run start
bun run typecheck
bun run test
```

## 下一步阅读

- 路线图：./roadmap.md
- 系统架构：../architecture.md
