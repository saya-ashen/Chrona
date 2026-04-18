# 开发指南

## 开发环境设置

### 前置条件

```bash
# 安装 Bun
curl -fsSL https://bun.sh/install | bash

# 验证
bun --version  # >= 1.0
```

### 初始化

```bash
git clone <repo-url> AgentDashboard
cd AgentDashboard
bun install
bunx prisma generate
bunx prisma db push
```

### 启动开发服务器

```bash
bun dev
# → http://localhost:3000
```

---

## 代码规范

### 目录约定

| 场景 | 位置 |
|------|------|
| 新的 API 端点 | `src/app/api/<resource>/route.ts` |
| 新的页面 | `src/app/<page>/page.tsx` |
| 新的命令处理器 | `src/modules/commands/<name>.ts` |
| 新的查询 | `src/modules/queries/<name>.ts` |
| 新的纯业务逻辑 | `src/modules/tasks/<name>.ts` |
| 新的 AI 功能 | `src/modules/ai/<name>.ts` |
| 新的 UI 组件 | `src/components/<page>/<name>.tsx` |
| 新的共享组件 | `src/components/ui/<name>.tsx` |
| 测试文件 | 与源文件同目录的 `__tests__/` 或同名 `.test.ts` |

### 命名约定

- **命令**：动词开头 — `createTask`, `applySchedule`, `resolveApproval`
- **查询**：`get` 开头 — `getSchedulePage`, `getWorkPage`, `getInbox`
- **派生函数**：`derive` 开头 — `deriveTaskState`, `deriveScheduleState`
- **验证函数**：`validate` 开头 — `validateScheduleWindow`
- **组件**：PascalCase — `ScheduleCommandBar`, `TaskCreateDialog`
- **类型文件**：`*-types.ts` — `schedule-page-types.ts`
- **工具文件**：`*-utils.ts` — `schedule-page-utils.ts`
- **文案文件**：`*-copy.ts` — `schedule-page-copy.ts`

### 模块依赖规则

```
✅ 允许的依赖方向：
  commands → events, projections, runtime, tasks
  queries  → projections, tasks, runtime, ai
  projections → tasks
  ai → queries (仅插件工具)

❌ 禁止的依赖：
  events → 任何模块（最底层）
  tasks  → commands, queries（纯函数层）
  queries → commands（读写分离）
```

### TypeScript 规范

- 使用 Zod 进行运行时验证
- 所有 API 输入必须经过 Zod schema 验证
- 优先使用 `interface` 定义数据形状
- 使用 `type` 定义联合类型和工具类型
- 避免 `any`，必要时使用 `unknown`

---

## 数据库操作

### Prisma Client

```typescript
import { db } from "@/lib/db";

// 查询
const task = await db.task.findUnique({ where: { id: taskId } });

// 创建
const task = await db.task.create({ data: { ... } });

// 更新
const task = await db.task.update({
  where: { id: taskId },
  data: { title: "新标题" },
});

// 事务
const result = await db.$transaction(async (tx) => {
  await tx.task.delete({ where: { id: taskId } });
  await tx.run.deleteMany({ where: { taskId } });
  return { success: true };
});
```

### 迁移

```bash
# 修改 schema.prisma 后
bunx prisma db push      # 开发环境（直接推送）
bunx prisma generate      # 重新生成客户端
```

### 数据库路径

数据库 URL 通过 `src/lib/db-url.ts` 解析，默认使用 `file:./dev.db`。

---

## 命令处理器模式

创建新命令的模板：

```typescript
// src/modules/commands/my-command.ts
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";

export async function myCommand(input: MyCommandInput) {
  // 1. 验证
  if (!input.taskId) throw new Error("taskId required");

  // 2. 数据库变更
  const task = await db.task.update({
    where: { id: input.taskId },
    data: { /* ... */ },
  });

  // 3. 追加事件
  await appendCanonicalEvent({
    eventType: "MyEventType",
    workspaceId: task.workspaceId,
    taskId: task.id,
    actorType: "human",
    source: "dashboard",
    payload: { /* 事件数据 */ },
    dedupeKey: `my-event-${task.id}-${Date.now()}`,
  });

  // 4. 重建投影
  await rebuildTaskProjection(task.id);

  return task;
}
```

---

## 查询处理器模式

```typescript
// src/modules/queries/get-my-page.ts
import { db } from "@/lib/db";

export interface MyPageData {
  items: MyItem[];
  summary: MySummary;
}

export async function getMyPage(workspaceId: string): Promise<MyPageData> {
  // 1. 从数据库/投影读取原始数据
  const tasks = await db.taskProjection.findMany({
    where: { task: { workspaceId } },
    include: { task: true },
  });

  // 2. 派生/计算
  const items = tasks.map(t => transformToItem(t));
  const summary = buildSummary(items);

  // 3. 返回页面数据
  return { items, summary };
}
```

---

## 测试策略

### 测试分层

| 层级 | 工具 | 文件后缀 | 用途 |
|------|------|---------|------|
| 单元测试 | Vitest | `.test.ts` | 纯函数、工具函数 |
| 组件测试 | Vitest + Testing Library | `.test.tsx` | React 组件渲染/交互 |
| 查询测试 | Bun Test | `.bun.test.ts` | 数据库查询（需要真实 DB） |
| E2E 测试 | Playwright | `.spec.ts` | 端到端流程 |

### 运行测试

```bash
# Vitest（组件/单元）
bunx vitest run                                    # 全部
bunx vitest run src/components/schedule/            # 目录
bunx vitest run src/hooks/__tests__/use-ai.test.ts  # 单文件

# Bun Test（查询/DB）
bun test src/modules/queries/__tests__/
bun test src/modules/commands/__tests__/

# Playwright（E2E）
bunx playwright test

# 监听模式
bunx vitest --watch
```

### 重要注意事项

1. **`.bun.test.ts` 文件必须用 `bun test` 运行**，Vitest 不会收集这些文件
2. **组件测试需要 `afterEach(cleanup)`** 防止 DOM 残留
3. **查询测试使用真实运行时适配器键**（如 `openclaw`），不要使用 `mock`
4. **异步操作使用 `waitFor()`** 等待完成

### 测试编写示例

```typescript
// 组件测试
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

describe("MyComponent", () => {
  it("should render title", () => {
    render(<MyComponent title="Hello" />);
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("should handle click", async () => {
    const onClick = vi.fn();
    render(<MyComponent onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalled();
  });
});
```

```typescript
// 查询测试 (.bun.test.ts)
import { describe, expect, test, beforeAll } from "bun:test";
import { db } from "@/lib/db";
import { getSchedulePage } from "../get-schedule-page";

describe("getSchedulePage", () => {
  let workspaceId: string;

  beforeAll(async () => {
    // 设置测试数据
    const ws = await db.workspace.create({ data: { name: "test" } });
    workspaceId = ws.id;
  });

  test("returns page data", async () => {
    const data = await getSchedulePage(workspaceId, "2025-01-15");
    expect(data.planningSummary).toBeDefined();
    expect(data.scheduled).toBeArray();
  });
});
```

---

## API 路由开发

### 标准模式

```typescript
// src/app/api/my-resource/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { myCommand } from "@/modules/commands/my-command";

const InputSchema = z.object({
  taskId: z.string(),
  value: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = InputSchema.parse(body);
    const result = await myCommand(input);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.errors },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

### 动态路由

```typescript
// src/app/api/tasks/[taskId]/route.ts
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  // ...
}
```

---

## 组件开发

### 页面组件（Server Component）

```typescript
// src/app/my-page/page.tsx
import { getMyPage } from "@/modules/queries/get-my-page";
import { MyPageClient } from "@/components/my-page/my-page-client";

export default async function MyPage() {
  const data = await getMyPage("default");
  return <MyPageClient data={data} />;
}
```

### 客户端组件

```tsx
// src/components/my-page/my-page-client.tsx
"use client";

import { useState } from "react";
import type { MyPageData } from "@/modules/queries/get-my-page";

export function MyPageClient({ data }: { data: MyPageData }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="flex h-full flex-col">
      {/* 组件内容 */}
    </div>
  );
}
```

### 样式规范

- 使用 Tailwind CSS utility classes
- 使用 `cn()` 函数合并条件类名
- 遵循 shadcn/ui 组件模式
- Google Calendar 风格布局：`h-full flex flex-col overflow-hidden`
- 关键 CSS 模式：`min-h-0` 在 flex 容器上防止溢出

---

## 国际化

### 添加新文案

```typescript
// src/components/schedule/schedule-page-copy.ts
export const DEFAULT_SCHEDULE_PAGE_COPY = {
  quickCreatePlaceholder: "输入任务名称或命令...",
  quickCreateSubmit: "添加",
  quickCreateHint: "支持自然语言，如 "下午2点 代码审查 @High"",
  // 新增文案
  myNewLabel: "新标签",
};
```

### 在组件中使用

```tsx
const { messages } = useI18n();
const copy = getSchedulePageCopy(messages.components?.schedulePage);
// copy.myNewLabel → "新标签" 或对应语言翻译
```

---

## 提交规范

使用 Conventional Commits：

```
feat: 添加 AI 冲突检测功能
fix: 修复排期时间重叠检测
refactor: 重构任务投影重建逻辑
docs: 更新 API 文档
test: 添加排期命令栏测试
chore: 升级 Prisma 版本
```

### 提交工作流

```bash
# 1. 开发 + 测试
bunx vitest run src/components/schedule/  # 相关测试通过

# 2. 类型检查（可选，可过滤非相关错误）
bunx tsc -p tsconfig.json --noEmit --pretty false 2>&1 | grep 'schedule'

# 3. 提交
git add -A
git commit -m "feat: 新功能描述"
```

---

## 常见问题

### Next.js 热更新不生效
结构性变更（删除导入、修改组件签名）后可能需要重启：
```bash
# Ctrl+C 停止
bun dev
```

### Vitest 找不到 .bun.test.ts 文件
这些文件专供 Bun Test，不会被 Vitest 收集。使用 `bun test` 运行。

### 数据库锁定
SQLite 单写锁限制。确保只有一个进程在写入。重启服务可解决。

### Prisma 客户端过期
修改 schema.prisma 后需要重新生成：
```bash
bunx prisma generate
```
