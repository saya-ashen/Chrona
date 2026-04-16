# 开发指南

## 目录

- [环境搭建](#环境搭建)
- [项目结构](#项目结构)
- [架构模式](#架构模式)
- [编码规范](#编码规范)
- [新增功能指引](#新增功能指引)
- [数据库迁移](#数据库迁移)
- [环境变量](#环境变量)

---

## 环境搭建

### 前置依赖

- [Bun](https://bun.sh) (运行时 & 包管理)
- [Nix](https://nixos.org/) (可选，提供 `flake.nix` + direnv)

### 快速开始

```bash
# 如果使用 Nix + direnv，进入目录即可自动加载环境
cd AgentDashboard

# 安装依赖
bun install

# 复制环境变量
cp .env.example .env

# 生成 Prisma Client
bunx prisma generate

# 创建/迁移数据库
bunx prisma db push

# 填充种子数据
bun run db:seed

# 启动开发服务器
bun run dev
```

### Nix 环境

项目提供 `flake.nix`，配合 `.envrc` (direnv) 可自动加载开发环境：

```bash
direnv allow
```

---

## 项目结构

```
src/
├── app/                    # Next.js App Router (页面 & API Routes)
│   └── [lang]/             # i18n 路由段 (en / zh)
├── cli/                    # CLI 入口 & 命令
│   ├── index.ts            # agentdash 入口
│   ├── commands/           # 命令组: task, run, schedule, ai
│   └── lib/                # API 客户端、输出格式化
├── components/             # React 组件
├── generated/prisma/       # Prisma 生成的客户端 (勿手动编辑)
├── lib/                    # 共享工具库 (db, utils)
├── modules/                # 业务逻辑核心
│   ├── ai/                 # AI 功能 (分解、建议、冲突检测)
│   ├── commands/           # 写操作 (Command)
│   ├── queries/            # 读操作 (Query)
│   ├── projections/        # 读模型投影
│   ├── tasks/              # 任务领域逻辑
│   ├── runtime/            # OpenClaw 运行时集成
│   ├── workspaces/         # 工作区逻辑
│   └── ...
├── test/                   # 测试基础设施 (setup.ts)
prisma/
├── schema.prisma           # 数据库模型定义
├── seed.ts                 # 种子数据
e2e/                        # Playwright E2E 测试
```

---

## 架构模式

### CQRS (命令查询分离)

项目采用 CQRS 模式，将读写操作明确分离：

- **Commands** (`src/modules/commands/`): 负责写操作，修改数据库状态，记录事件
- **Queries** (`src/modules/queries/`): 负责读操作，查询投影/读模型
- **Projections** (`src/modules/projections/`): 读模型重建，从事件流构建查询优化的数据视图

Command 示例模式：

```typescript
// src/modules/commands/apply-schedule.ts
export async function applySchedule(input: ApplyScheduleInput) {
  // 1. 验证输入
  // 2. 更新数据库
  // 3. 记录领域事件 (Event)
  // 4. 重建投影 (Projection)
  return result;
}
```

Query 示例模式：

```typescript
// src/modules/queries/get-schedule-page.ts
export async function getSchedulePage(workspaceId: string) {
  // 查询投影表，返回页面所需数据
  return data;
}
```

### Server Components vs Client Components

项目使用 Next.js App Router (v16)：

- **Server Components** (默认): 页面级组件，直接调用 Query 函数读取数据
- **Client Components** (`"use client"`): 交互式 UI 组件，处理用户输入和状态

原则：
1. 页面组件 (`page.tsx`) 尽量为 Server Component
2. 仅在需要浏览器 API、事件处理、状态管理时使用 Client Component
3. 数据获取在 Server Component 中完成，通过 props 传递给 Client Component

### 事件驱动

写操作会产生领域事件，存入 `Event` 表。投影从事件重建读模型，保证最终一致性。

---

## 编码规范

### 通用

- 使用 TypeScript，严格模式
- 使用 Zod 进行输入验证
- 路径别名: `@/` 指向 `src/`
- 样式: Tailwind CSS + `clsx` + `tailwind-merge`
- UI: shadcn/ui 组件 + Base UI + Lucide 图标
- 日期: `date-fns`

### 命名约定

| 类型 | 命名 | 示例 |
|------|------|------|
| 文件 | kebab-case | `apply-schedule.ts` |
| 组件 | PascalCase | `TaskCard.tsx` |
| 函数 | camelCase | `applySchedule()` |
| 测试 (Vitest) | `*.test.ts` / `*.test.tsx` | `task-decomposer.test.ts` |
| 测试 (Bun) | `*.bun.test.ts` | `schedule-commands.bun.test.ts` |
| 测试 (E2E) | `e2e/*.spec.ts` | `e2e/task-flow.spec.ts` |

---

## 新增功能指引

### 新增 Command

1. 在 `src/modules/commands/` 创建文件，如 `archive-task.ts`
2. 导出函数，接收类型化输入，执行写操作
3. 记录领域事件到 `Event` 表
4. 触发投影重建（如需要）
5. 编写 Bun 集成测试 `__tests__/archive-task.bun.test.ts`（使用真实数据库）

### 新增 Query

1. 在 `src/modules/queries/` 创建文件
2. 查询投影表或直接查数据库
3. 编写 Bun 测试或 Vitest 单元测试

### 新增 CLI 命令

1. 在对应的 `src/cli/commands/<group>.ts` 中添加子命令
2. 使用 `commander` 的 `.command()` API
3. 通过 `ApiClient` 调用后端 API
4. 支持 `--output json|table` 格式

### 新增页面

1. 在 `src/app/[lang]/` 下创建路由目录和 `page.tsx`
2. 页面组件为 Server Component，调用 Query 获取数据
3. 交互式部分提取为 Client Component
4. 确保 i18n：在 `[lang]` 路由段下

### 新增 API Route

1. 在 `src/app/api/` 下创建 `route.ts`
2. 使用 Next.js Route Handler 格式
3. 调用 Command 或 Query 函数

---

## 数据库迁移

项目使用 **Prisma 7** + **SQLite** (通过 better-sqlite3 适配器)。

```bash
# 编辑模型
# 文件: prisma/schema.prisma

# 推送模型变更到数据库 (开发)
bunx prisma db push

# 生成 Prisma Client
bunx prisma generate

# 查看数据库
bunx prisma studio

# 重置数据库
bunx prisma db push --force-reset

# 重新填充种子数据
bun run db:seed
```

> 注意: 生成的 Prisma Client 位于 `src/generated/prisma/`，已在 `.gitignore` 或由 Prisma 自动管理。

---

## 环境变量

参考 `.env.example`:

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | SQLite 数据库路径 | `file:./prisma/dev.db` |
| `OPENCLAW_MODE` | OpenClaw 运行时模式 | `live`（可选 `mock`） |
| `OPENCLAW_GATEWAY_URL` | WebSocket 网关地址 | `ws://localhost:3001/gateway` |
| `OPENCLAW_AUTH_TOKEN` | OpenClaw 认证令牌 | — |
| `NEXT_PUBLIC_WORK_POLL_INTERVAL_MS` | 前端轮询间隔 (ms) | `10000` |
| `AI_PROVIDER_BASE_URL` | AI 服务 API 地址 | — |
| `AI_PROVIDER_API_KEY` | AI 服务 API 密钥 | — |
| `AI_PROVIDER_MODEL` | AI 模型名称 | — |

### OpenClaw 运行时

- `OPENCLAW_MODE=mock`: 使用模拟运行时，适合开发和测试
- `OPENCLAW_MODE=live`: 连接真实 WebSocket 网关
