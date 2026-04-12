# Adapter Config Plan

## 目标

让任务创建/编辑时的配置能力可以随不同 adapter 动态变化，并保证：

1. 前端不堆积大量 adapter 分支
2. 后端是字段、默认值、校验的唯一真相源
3. Run 启动时使用已验证的配置
4. 历史 Run 可以回溯执行时的实际配置
5. 后续接入第二个 adapter 时不需要重做主表单

---

## 成功标准

满足这 6 条就算完成：

1. 创建任务时可根据 adapter 动态显示/隐藏字段
2. 不同 adapter 的字段选项、默认值、校验规则由后端返回
3. `createTask` / `updateTask` / `startRun` 都走 adapter 校验
4. runnability 不再硬编码只依赖 `runtimeModel + prompt`
5. `Run` 会保存启动时的配置快照
6. 接入第二个 adapter 时，主表单不需要继续堆大段 `if/else`

---

## 设计原则

1. **业务字段固定，adapter 字段动态**
2. **后端为真相源，前端做友好渲染**
3. **先做收敛 DSL，不做通用表单平台**
4. **先兼容现有 openclaw，再支持第二个 adapter**
5. **Run 必须保存配置快照，保证可解释性**

---

## 当前问题

当前实现更适合“单 runtime + 少量高级 JSON 参数”的形态，还不适合 adapter 差异很大的场景。

### 现状

- `TaskConfigForm` 只有一套固定字段
- `runtimeConfig` 主要还是自由 JSON object
- `deriveTaskRunnability` 目前只依赖 `runtimeModel` 和 `prompt`
- `startRun` 仍然偏向固定 runtime 路径
- 不同 adapter 的字段显隐、可选值、默认值、校验规则没有独立机制

### 结果

- 前端如果继续加 adapter 分支，很快会失控
- 默认值与校验逻辑容易在前后端漂移
- 历史 Run 缺少完整配置快照，不利于排查与复现

---

## 范围

### 本次要做

- adapter registry
- adapter config spec 机制
- adapter validator 机制
- task / run 数据结构补齐
- TaskConfigForm 动态渲染
- runnability 改为 adapter 驱动
- start-run 改为按 adapter 启动并保存快照

### 本次不做

- 通用 JSON Schema 表单平台
- 完整插件系统
- 多 workspace 运营能力扩展
- 很复杂的表达式联动引擎
- 任意组件远程驱动渲染能力

---

## 目标架构

### 1. 表单分层

任务表单分成两层：

#### 固定业务字段

- `title`
- `description`
- `priority`
- `dueAt`

这些字段属于产品本身，不应该由 adapter 决定。

#### adapter 配置字段

例如：

- `model`
- `prompt`
- `temperature`
- `approvalPolicy`
- `toolMode`
- 其他 adapter 专属字段

这些字段由后端返回 spec，前端按 spec 渲染。

---

### 2. adapter contract

每个 adapter 至少实现：

```ts
type RuntimeAdapter = {
  key: string;
  getTaskConfigSpec(ctx: AdapterContext): Promise<AdapterTaskConfigSpec>;
  validateTaskConfig(input: unknown, ctx: AdapterContext): Promise<ValidatedTaskConfig>;
};
```

---

### 3. adapter spec

不直接上完整 JSON Schema，先采用收敛 DSL：

```ts
type AdapterTaskConfigSpec = {
  adapterKey: string;
  version: string;
  fields: Array<{
    key: string;
    path: string;
    kind: "text" | "textarea" | "select" | "number" | "boolean" | "json";
    label: string;
    description?: string;
    required?: boolean;
    advanced?: boolean;
    defaultValue?: unknown;
    options?: Array<{ value: string; label: string }>;
    visibleWhen?: Array<{ path: string; op: "eq" | "in"; value: unknown }>;
    constraints?: {
      min?: number;
      max?: number;
      step?: number;
      minLength?: number;
      maxLength?: number;
      pattern?: string;
    };
  }>;
  runnability: {
    requiredPaths: string[];
  };
};
```

### 这个 spec 要解决的问题

- 哪些字段显示
- 哪些字段隐藏
- 哪些字段是高级项
- 哪些字段有默认值
- 哪些字段有枚举可选值
- 哪些字段缺失会阻止任务执行

---

## 数据结构改造

## Task 层

建议新增字段：

- `runtimeAdapterKey`
- `runtimeInput`
- `runtimeInputVersion`

### 迁移期策略

保留现有：

- `runtimeModel`
- `prompt`
- `runtimeConfig`

作为兼容字段继续读写一段时间，先完成双写/兼容读，再逐步收敛。

---

## Run 层

建议新增字段：

- `runtimeConfigSnapshot`
- `runtimeConfigVersion`

### 原因

Run 必须保存启动时最终生效的配置。否则：

- task 后续被修改后，历史 run 无法准确解释
- adapter 默认值变化后，老 run 不可复现
- 排查失败原因时缺少上下文

---

## Workspace 层

继续保留 `defaultRuntime`，但明确它的语义只是：

- workspace 默认 adapter key

它不应该直接替代 adapter spec，也不应该承担字段定义职责。

---

## 命令与校验链路

### create / update

`createTask` / `updateTask` 统一改成：

1. 解析 adapter key
2. 读取 adapter spec
3. 合并默认值
4. 调用 adapter validator
5. 存储 normalized config
6. 计算 runnability

前端校验只做即时提示，最终以 server action / command 校验为准。

---

### runnability

现状中 runnability 只看 `runtimeModel + prompt`，后续需要改成：

- adapter 返回 required fields / normalized result
- 系统统一产出 `isRunnable / missingFields / summary`

目标是让 runnability 由 adapter 规则驱动，而不是写死在任务模块里。

---

### start-run

`startRun` 需要改成：

- 根据 `runtimeAdapterKey` 获取 adapter
- 使用经过 validator 的配置启动
- 将最终配置快照写入 `Run`

这一步完成后，才算真正支持多 adapter，而不是只支持“多表单”。

---

## 前端改造方式

### TaskConfigForm

重构为：

1. 固定业务字段区
2. adapter 动态字段区
3. advanced 区

### 动态字段区职责

- 根据 `AdapterTaskConfigSpec` 渲染字段
- 根据 `visibleWhen` 控制显隐
- 根据 `options` 渲染枚举
- 根据 `defaultValue` 填充默认值
- 根据 `constraints` 做基础交互校验

### advanced 区策略

- `advanced` 字段默认折叠
- 保留 JSON escape hatch
- 但 JSON textarea 不再作为主配置入口

---

## 推荐实施顺序

## Phase 1：补齐数据模型和 registry

### 目标

先把“任务绑定哪个 adapter、run 用了什么配置”建模清楚。

### 改动

- Prisma 增加 Task / Run 相关字段
- 建立 runtime registry
- 保证 openclaw 能通过 registry 被解析

### 主要文件

- `prisma/schema.prisma`
- `src/modules/runtime/*`
- `src/generated/prisma/*`

### 验收标准

- Task 能明确知道自己的 adapter
- Task 能持久化 adapter 输入
- Run 能保存配置快照
- 当前 openclaw 流程不被破坏

---

## Phase 2：定义 spec / validate contract

### 目标

把字段定义、默认值、校验规则收敛到 adapter 后端实现。

### 改动

- 为 openclaw 实现 `getTaskConfigSpec()`
- 为 openclaw 实现 `validateTaskConfig()`
- 增加 adapter 相关共享类型

### 主要文件

- `src/modules/runtime/openclaw/adapter.ts`
- `src/modules/runtime/registry.ts`
- `src/modules/runtime/types.ts`

### 验收标准

- openclaw 能返回自己的字段 spec
- openclaw 能校验自己的输入
- 默认值、枚举、校验规则由后端统一提供

---

## Phase 3：改 create / update / runnability

### 目标

让命令层统一走 adapter validator，不再依赖前端写死字段规则。

### 改动

- `create-task.ts` 接入 adapter validator
- `update-task.ts` 接入 adapter validator
- `derive-task-runnability.ts` 改为 adapter 驱动

### 主要文件

- `src/modules/commands/create-task.ts`
- `src/modules/commands/update-task.ts`
- `src/modules/tasks/derive-task-runnability.ts`

### 验收标准

- 非法 adapter 输入会被后端正确拦截
- runnability 不再只依赖 model/prompt
- adapter 可以决定缺哪些字段会阻止执行

---

## Phase 4：重构 TaskConfigForm

### 目标

把表单改成“固定壳 + 动态 adapter 区”，而不是纯 JSON 编辑器。

### 改动

- `task-config-form.tsx` 支持 spec 驱动渲染
- Schedule 创建入口接入动态字段
- Schedule 列表 quick edit 接入动态字段
- advanced 区保留 JSON escape hatch

### 主要文件

- `src/components/schedule/task-config-form.tsx`
- `src/components/schedule/schedule-page.tsx`
- `src/components/schedule/schedule-task-list.tsx`

### 验收标准

- 切换 adapter 时字段可动态变化
- 枚举项和默认值来自后端 spec
- 主流程不再要求直接手填大段 JSON

---

## Phase 5：改 start-run 与 Run snapshot

### 目标

让执行链路真正按 adapter 生效。

### 改动

- `start-run.ts` 不再写死 runtime
- 根据 `runtimeAdapterKey` 获取 adapter
- 使用 validated config 启动
- 将最终配置写入 `Run.runtimeConfigSnapshot`

### 主要文件

- `src/modules/commands/start-run.ts`
- `src/modules/runtime/*`

### 验收标准

- Run 启动时走正确 adapter
- Run 持久化最终配置快照
- 历史 run 可解释、可复现

---

## Phase 6：接第二个 adapter 做验收

### 目标

证明这套架构不是只对 openclaw 特化。

### 改动

- 新增一个最小第二 adapter
- 覆盖不同字段集合、默认值、枚举、required 规则

### 验收标准

- 不改主表单骨架也能接入
- create / update / startRun 流程可复用
- 不需要新增大量 adapter 分支

---

## 测试计划

### 单元测试

- adapter spec 返回正确字段
- adapter validator 正确拦截非法输入
- runnability 正确产出 `missingFields`

### 命令测试

- `createTask`
- `updateTask`
- `startRun`

### 组件测试

- `TaskConfigForm`
- Schedule 创建入口
- Schedule quick edit

### 集成测试

- Task 创建 → 校验 → 启动 Run → 保存 snapshot
- adapter 切换时字段重置 / remap 行为

---

## 风险点

1. **前后端重复维护规则**
   - 解决：后端 validate 为准，前端只做交互提示

2. **把项目做成通用表单平台**
   - 解决：只支持收敛 DSL，不做任意 schema engine

3. **历史 Run 不可复现**
   - 解决：Run 强制保存配置快照

4. **切换 adapter 时残留旧字段**
   - 解决：切换时显式 reset / remap / 提示

5. **兼容期过长，旧结构越来越难删**
   - 解决：先双写，接入第二 adapter 后再收敛旧字段

---

## 当前仓库优先改动文件

- `prisma/schema.prisma`
- `src/modules/runtime/openclaw/adapter.ts`
- `src/modules/commands/create-task.ts`
- `src/modules/commands/update-task.ts`
- `src/modules/commands/start-run.ts`
- `src/modules/tasks/derive-task-runnability.ts`
- `src/components/schedule/task-config-form.tsx`
- `src/components/schedule/schedule-page.tsx`
- `src/components/schedule/schedule-task-list.tsx`

---

## 最后一句

这次改造的重点不是“把 JSON 文本框换成更多输入框”，而是建立一条可扩展的 adapter 配置链路：

**业务字段固定、adapter 配置后端描述、server action 统一校验、Run 固化快照。**
