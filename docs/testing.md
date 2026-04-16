# 测试指南

## 概述

项目使用三套测试框架，各有分工：

| 框架 | 用途 | 文件命名 | 运行命令 |
|------|------|----------|----------|
| **Vitest** | 单元测试、组件测试 | `*.test.ts` / `*.test.tsx` | `bun run test` |
| **Bun test** | 集成测试 (真实数据库) | `*.bun.test.ts` | `bun test <文件路径>` |
| **Playwright** | E2E 端到端测试 | `e2e/*.spec.ts` | `bun run test:e2e` |

---

## Vitest

### 定位

单元测试和 React 组件测试。运行在 jsdom 环境中，不使用真实数据库。

### 配置

配置文件: `vitest.config.ts`

- 环境: jsdom
- setup 文件: `src/test/setup.ts`
- 排除: `e2e/`、`*.bun.test.ts`、`src/modules/db/` 目录
- 覆盖率: v8 provider，输出 text + html

### 运行

```bash
# 运行所有测试（含覆盖率）
bun run test

# watch 模式
bun run test:watch

# 运行单个文件
bunx vitest run src/modules/ai/__tests__/task-decomposer.test.ts

# 运行匹配模式
bunx vitest run --reporter=verbose -t "should parse"
```

### 编写示例

```typescript
import { describe, it, expect, vi } from "vitest";
import { taskDecomposer } from "@/modules/ai/task-decomposer";

describe("taskDecomposer", () => {
  it("should decompose a task into subtasks", async () => {
    // Arrange - 使用 vi.mock 模拟外部依赖
    vi.mock("@/modules/ai/llm-service", () => ({
      callLlm: vi.fn().mockResolvedValue({ subtasks: ["a", "b"] }),
    }));

    // Act
    const result = await taskDecomposer("parent-task");

    // Assert
    expect(result.subtasks).toHaveLength(2);
  });
});
```

### Mock 模式

```typescript
// 模拟模块
vi.mock("@/lib/db", () => ({
  db: {
    task: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// 模拟函数
const mockFn = vi.fn().mockReturnValue("value");

// spy
const spy = vi.spyOn(object, "method");

// 重置
afterEach(() => {
  vi.restoreAllMocks();
});
```

### React 组件测试

使用 `@testing-library/react`：

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskCard } from "@/components/TaskCard";

it("renders task title", () => {
  render(<TaskCard title="My Task" />);
  expect(screen.getByText("My Task")).toBeInTheDocument();
});
```

---

## Bun Test

### 定位

集成测试，使用真实 SQLite 数据库。适合测试 Command/Query 对数据库的完整读写流程。

### 为什么用 Bun test？

Bun test 直接运行在 Bun 运行时中，可以使用真实的 Prisma Client 和 SQLite，不需要 mock 数据库层。Vitest 的 jsdom 环境不适合此场景。

### 运行

```bash
# 运行单个文件
bun test src/modules/commands/__tests__/schedule-commands.bun.test.ts

# 运行匹配模式
bun test --filter "applySchedule"

# 运行所有 bun 测试
bun test --glob "**/*.bun.test.ts"
```

### 编写示例

```typescript
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { applySchedule } from "@/modules/commands/apply-schedule";

// 清理数据库的辅助函数
async function resetDb() {
  await db.event.deleteMany();
  await db.taskProjection.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

describe("applySchedule", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("updates schedule and records event", async () => {
    // 创建前置数据
    const workspace = await db.workspace.create({
      data: { name: "Test", status: "Active", defaultRuntime: "openclaw" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Test task",
        status: "Ready",
        priority: "High",
        ownerType: "human",
      },
    });

    // 执行 command
    const result = await applySchedule({
      taskId: task.id,
      dueAt: new Date("2026-04-20T18:00:00Z"),
      scheduledStartAt: new Date("2026-04-20T09:00:00Z"),
      scheduledEndAt: new Date("2026-04-20T11:00:00Z"),
      scheduleSource: "human",
    });

    // 断言
    expect(result).toBeDefined();

    // 验证事件已记录
    const events = await db.event.findMany({ where: { taskId: task.id } });
    expect(events.length).toBeGreaterThan(0);
  });
});
```

### 重要注意

- Bun test 文件必须以 `.bun.test.ts` 结尾，确保 Vitest 不会误收
- `beforeEach` 中清理数据库，保证测试隔离
- `afterAll` 中断开数据库连接
- 测试使用开发数据库，确保 `DATABASE_URL` 已配置

---

## Playwright (E2E)

### 定位

端到端测试，在真实浏览器中测试完整用户流程。

### 配置

配置文件: `playwright.config.ts`

### 安装浏览器

```bash
bunx playwright install
```

### 运行

```bash
# 运行所有 E2E 测试
bun run test:e2e

# 运行单个文件
bunx playwright test e2e/task-flow.spec.ts

# UI 模式（可视化调试）
bunx playwright test --ui

# 指定浏览器
bunx playwright test --project=chromium
```

### 编写示例

```typescript
import { test, expect } from "@playwright/test";

test("can create a task", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("button", { name: "New Task" }).click();
  await page.getByLabel("Title").fill("E2E Test Task");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("E2E Test Task")).toBeVisible();
});
```

---

## 特殊测试

### OpenClaw 集成测试

需要运行中的 OpenClaw 服务：

```bash
OPENCLAW_INTEGRATION_TESTS=1 bun run test:openclaw:integration
```

---

## 文件放置规则

| 测试类型 | 位置 | 示例 |
|----------|------|------|
| 单元/组件测试 | 模块目录下 `__tests__/` | `src/modules/ai/__tests__/task-decomposer.test.ts` |
| 集成测试 (DB) | 模块目录下 `__tests__/` | `src/modules/commands/__tests__/schedule-commands.bun.test.ts` |
| E2E 测试 | `e2e/` 根目录 | `e2e/task-flow.spec.ts` |

## 总结

- **纯逻辑/组件** → Vitest (`*.test.ts`)，mock 数据库
- **Command/Query 集成** → Bun test (`*.bun.test.ts`)，真实数据库
- **用户流程** → Playwright (`e2e/*.spec.ts`)，真实浏览器
