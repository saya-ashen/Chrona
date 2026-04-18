# 运行时集成文档

## 概述

AgentDashboard 通过运行时适配器模式与 AI 智能体执行引擎集成。当前主要运行时是 **OpenClaw Gateway**，通过 WebSocket 协议通信。

## 适配器架构

```
┌─────────────────────────────────────┐
│         AgentDashboard              │
│                                     │
│  commands/startRun()                │
│        │                            │
│        ▼                            │
│  ┌─────────────────┐                │
│  │ RuntimeExecution │                │
│  │   Adapter        │                │
│  │ (接口层)         │                │
│  └────────┬────────┘                │
│           │                         │
│  ┌────────┼────────┐                │
│  │        │        │                │
│  ▼        ▼        ▼                │
│ OpenClaw Research  (扩展)           │
│ Adapter  Adapter                    │
└────┬─────────────────────────────────┘
     │ WebSocket
     ▼
┌─────────────────────────────────────┐
│      OpenClaw Gateway               │
│      (外部 AI 执行引擎)              │
└─────────────────────────────────────┘
```

## 适配器接口

```typescript
interface RuntimeExecutionAdapter {
  // 创建并启动新的执行
  createRun(
    task: Task,
    session: TaskSession,
    options?: { prompt?: string }
  ): Promise<RunResult>;

  // 向运行中的智能体发送消息
  sendOperatorMessage(
    run: Run,
    message: string
  ): Promise<void>;

  // 获取执行快照（当前状态）
  getRunSnapshot(run: Run): Promise<RunSnapshot>;

  // 读取执行历史（分页）
  readHistory(
    run: Run,
    cursor?: string
  ): Promise<HistoryPage>;

  // 列出执行的审批请求
  listApprovals(run: Run): Promise<Approval[]>;

  // 恢复暂停的执行
  resumeRun(run: Run): Promise<void>;
}
```

## 适配器注册

```typescript
// 当前已注册的适配器
const adapters = listRuntimeAdapterKeys();
// → ["openclaw", "research"]

// 获取适配器配置规格
const spec = getRuntimeTaskConfigSpec("openclaw");
// → { fields: [
//   { key: "model", required: true, type: "string" },
//   { key: "prompt", required: true, type: "text" },
//   ...
// ]}
```

## 任务运行时配置

每个任务可配置运行时参数：

```typescript
interface TaskRuntimeConfig {
  runtimeAdapterKey: string;   // 适配器标识 (如 "openclaw")
  runtimeModel: string;        // AI 模型 (如 "gpt-4o")
  prompt: string;              // 执行提示词
  runtimeInput?: string;       // 输入数据 (JSON)
  runtimeInputVersion?: string;// 输入版本
  runtimeConfig?: string;      // 额外配置 (JSON)
}
```

### 可运行性检查

任务是否可运行由 `deriveTaskRunnability()` 判断：

```typescript
const result = deriveTaskRunnability(task, configSpec);
// {
//   isRunnable: false,
//   missingFields: ["prompt", "runtimeModel"],
//   runnabilityState: "missing_fields"
// }
```

---

## OpenClaw 集成详解

### 连接管理

```
AgentDashboard  ←── WebSocket ──→  OpenClaw Gateway
                                   ws://host:port
```

**环境变量：**
```env
OPENCLAW_GATEWAY_URL=ws://localhost:8080
OPENCLAW_API_KEY=your-api-key
```

### 会话管理

每个任务维护一个运行时会话（TaskSession）：

```typescript
interface TaskSession {
  id: string;
  taskId: string;
  sessionKey: string;      // 唯一会话标识
  runtimeName: string;     // "openclaw"
  status: string;          // 会话状态
  activeRunId: string;     // 当前活跃的执行 ID
}
```

**会话生命周期：**
1. 首次启动任务时创建会话
2. 会话在任务的多次执行间复用
3. 每次执行产生新的 Run，但共享同一 Session

### 执行生命周期

```
startRun()
  │
  ▼
┌─────────┐     ┌──────────┐     ┌───────────┐
│ Pending  │────▶│ Running  │────▶│ Completed │
└─────────┘     └────┬─────┘     └───────────┘
                     │                ▲
                     ▼                │
              ┌──────────────┐        │
              │ WaitingFor   │────────┘
              │ Approval     │  resolveApproval()
              └──────────────┘
                     │
                     ▼
              ┌──────────────┐
              │ WaitingFor   │────────┘
              │ Input        │  provideInput()
              └──────────────┘
                     │
                     ▼
              ┌──────────────┐
              │   Failed     │
              └──────┬───────┘
                     │ retryRun()
                     ▼
              ┌──────────────┐
              │   Running    │
              └──────────────┘
```

### 同步机制

AgentDashboard 通过轮询机制与 OpenClaw Gateway 保持状态同步。

#### sync-run.ts
主动同步：从 Gateway 拉取最新状态并更新本地数据库。

```typescript
syncRun(runId): Promise<void>
// 1. 通过 adapter.getRunSnapshot() 获取最新状态
// 2. 通过 adapter.readHistory() 增量拉取新事件
// 3. 更新本地 Run、ConversationEntry、ToolCallDetail、Approval 等
// 4. 更新 RuntimeCursor（游标位置）
```

#### freshness.ts
被动同步：在读取查询时检查数据新鲜度。

```typescript
ensureFreshness(runId): Promise<void>
// 1. 检查 RuntimeCursor.updatedAt 是否过期
// 2. 如果过期，触发 syncRun()
// 3. 查询层调用此函数确保读到最新数据
```

**过期阈值：** 配置在 `config.ts` 中。

### 审批门控

OpenClaw 智能体在执行过程中可触发审批请求：

```
智能体想要执行高风险操作
       │
       ▼
创建 Approval 记录 (Pending)
       │
       ▼
通知用户（出现在收件箱）
       │
       ▼
用户决策: Approve / Reject / Edit & Approve
       │
       ▼
resolveApproval() → 通知 Gateway → 智能体继续/中止
```

### 设备身份

```typescript
// device-identity.ts
getDeviceIdentity(): string
// 为当前 AgentDashboard 实例生成唯一标识
// 用于 Gateway 识别不同的操作端
```

### 健康探测

```typescript
// probe.ts
probeGateway(): Promise<boolean>
// 检查 OpenClaw Gateway 是否可达
```

### 编排器 (orchestrator.ts)

高层编排逻辑，处理执行的完整生命周期：

```typescript
orchestrateRun(task, session): Promise<RunResult>
// 1. 创建执行
// 2. 监控状态变更
// 3. 处理重试/回退
// 4. 指数退避重试
```

---

## 扩展新的运行时

### 步骤 1：实现适配器

```typescript
// src/modules/runtime/my-runtime/adapter.ts
import { RuntimeExecutionAdapter } from "../types";

export function createMyRuntimeAdapter(): RuntimeExecutionAdapter {
  return {
    async createRun(task, session, options) { ... },
    async sendOperatorMessage(run, message) { ... },
    async getRunSnapshot(run) { ... },
    async readHistory(run, cursor) { ... },
    async listApprovals(run) { ... },
    async resumeRun(run) { ... },
  };
}
```

### 步骤 2：定义配置规格

```typescript
// src/modules/runtime/my-runtime/config.ts
export const MY_RUNTIME_CONFIG_SPEC = {
  fields: [
    { key: "model", label: "Model", type: "string", required: true },
    { key: "apiKey", label: "API Key", type: "string", required: true },
  ],
};
```

### 步骤 3：注册到注册表

在 `registry.ts` 中添加新的适配器定义。

### 步骤 4：添加执行适配器工厂

在 `execution-registry.ts` 中注册懒加载的适配器创建函数。
