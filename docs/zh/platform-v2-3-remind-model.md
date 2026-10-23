# v2-3 规格：内置模块、`remind` 与模块的 `model` 能力

状态：已实现（2026-10-23，`platform-v2`）；真实模型调用尚未验证（需另行授权）。总纲见 [platform-v2](platform-v2.md)；依赖 [v2-1](platform-v2-1-runtime.md)、[v2-2](platform-v2-2-sessions-content.md)。背景见 [platform-upgrade-plan](platform-upgrade-plan.md) §0、§3.4 与范式 `~/workspace/agent-growth-lab/docs/self-modification-paradigm.md` §3–§4。
本文件是该部分的契约；实现与本文冲突时以本文为准。

## 1. 问题

落地时有两处把范式收窄了：

| 范式 | 当前实现 | 后果 |
|---|---|---|
| `effects` 包含 `model`，模型调用经内核注入（范式 §3、§4） | 模块"run without a model"；需要模型就只能 `wake_provider` | GitHub Trending 抓到英文内容，要总结翻译就得唤起整个 Provider（带工具、带上下文、按运行计费），或者干脆不翻译 |
| 平台本身是生长的对象，提醒属于后台模块（范式 §11） | `remind` 是内核原语，"不算模块" | 提醒不能升级、替换、回滚；"到点发固定文本"写死在 `schedules.ts` |

结晶的目标是**不再需要 Provider 判断**，而不是"不调用模型"。固定提示词的一次性数据变换（总结、翻译、分类）是规则的一部分，可以固化。

## 2. 三种形态

| 形态 | 适用 | 模型 |
|---|---|---|
| 规则模块 | 规则完全确定（到点提醒、阈值判断） | 不调用 |
| 带 `model` 的模块 | 规则确定，但某一步是固定提示词的数据变换（摘要、翻译、分类） | 每次触发有上限的一次性调用，无工具、无会话 |
| `wake` / `wake_provider` | 需要判断、需要工具或上下文 | 完整 Provider 运行 |

`wake` 仍是内核原语：它启动 Provider，属于内核的进程调度，不是可生长的规则。

## 3. 内置模块

### 3.1 来源与信任

- Chrona 源码 `packages/engine/src/modules/steward/builtin/<name>/`（`module.json` + 入口 + 测试），随 Chrona 发布。
- 启动时注册为 `ModuleVersion`，来源 `builtin`。它和其他模块走同一 build（清单校验、测试、smoke run），但**首个版本不需要 `activate_module` 批准**：它的代码已随 Chrona 本身审查，信任等级与内核相同。
- 之后的修改走正常网关：Provider 或构建通道提案修改 `remind` → 构建 → 审查卡片 → 启用；可回滚到任一版本，包括内置原版。
- Chrona 升级带来新的内置版本时：
  - 当前启用的仍是旧内置版本 → 视同内核升级，直接启用。
  - 用户已启用自己的版本 → 不覆盖；新内置版本作为候选出现在模块历史里，并发一条 web 级通知。

### 3.2 动态调度

当前模块调度只能来自清单 `triggers`（静态）。提醒是 Provider 按对话随时创建的，需要动态调度：

- `Schedule`（mode `module`）增加可空 `payload`（JSON，≤ 4000 字符）。清单触发生成的调度 `payload` 为空。
- `schedule` 事件增加 `{ scheduleId, payload }`。
- Provider 工具 `chrona_schedule {mode: "remind", text, ...}` 的参数**不变**；Chrona 将其存为 `mode: "module"`、`moduleId = remind`、`payload = { text }`。网页近期日程显示 `label` 或提醒文本。
- 只有内置模块接受动态调度；向提案模块开放动态调度另行规定。

### 3.3 `remind` 模块 v1

```json
{
  "name": "remind",
  "version": 1,
  "entry": "index.ts",
  "triggers": [],
  "effects": ["notify_user"],
  "params": {},
  "data": { "schema": 1 },
  "tests": ["test.ts"]
}
```

行为与现在的 `schedules.ts` 分支一致：收到 `schedule` 事件时调用一次 `notify`，`level: "now"`，标题为"提醒"，正文为 `payload.text`，key 为 `<scheduleId>:<firedAt>`。

### 3.4 数据迁移

现有 `mode: "remind"` 的 Schedule 行改为 `mode: "module"` + `payload`。这是对真实用户数据的迁移，**部署时须经用户批准**；迁移前备份数据库。迁移后删除 `schedules.ts` 中的 `remind` 分支，`SCHEDULE_MODES` 去掉 `remind`（Provider 工具的 `mode: "remind"` 保留为参数值）。

## 4. 模块的 `model` 能力

### 4.1 清单与 L1

```json
{
  "effects": ["network", "model", "notify_user"],
  "model": { "maxCalls": 3, "maxOutputTokens": 2000 }
}
```

- `effects` 含 `model` 时必须有 `model` 字段；两者缺一 build 失败。
- **L1**（设置，仅用户可改）：`moduleModel = { provider, model, maxCallsPerEvent, maxOutputTokens, dailyCalls, timeoutMs }`（`timeoutMs` 为声明 `model` 的模块的事件超时，v2-1 §2.3）。确切的 provider/model 由用户指定；未配置时 `model` 能力不可用（build 失败并说明原因）。**不自动回退到其他模型。**
- 清单的 `maxCalls` / `maxOutputTokens` 不得超过 L1 上限，否则 build 失败。
- 新增 `model` 属于新增 effects，按现行规则必须经审查启用，不会自动启用。

### 4.2 调用

模块经 [v2-1](platform-v2-1-runtime.md) §2.3 的通道直接调用：

```ts
const brief = await chrona.model({ system: "把以下 GitHub 项目列表总结为中文简报……", prompt: list, maxOutputTokens: 1500 });
// 失败时抛出 ModelError（code: budget_exceeded | provider_error | timeout），模块自行降级，例如直接发英文原文。
```

内核按清单 `maxCalls`（每个事件）、`maxOutputTokens` 与 L1 上限拒绝超限请求。

### 4.3 模型网关

- 由 Chrona 进程发起调用，凭据不进沙箱。
- 只做一次补全：`system` + `prompt` → 文本。无工具、无会话、无扩展/技能/上下文文件、无历史。
- 实现经 Pi 作为模型/认证适配器（与 Provider 共用认证）；具体调用方式（非交互模式与禁用工具的参数）实现时核实，不得启动带工具的 Agent 会话。
- 返回文本按 untrusted data 处理：长度截断到 `maxOutputTokens` 对应的上限，只作为模块输入，不进入策略判断。模块再把它放进 `wake_provider` 时，仍按现有规则标记为不可信。
- 计数：每次调用记入 `ModuleCall`（v2-1 §2.5），附 `{ model, inputTokens, outputTokens, error }`；计入 L1 `dailyCalls` 和该模块的预算。审计记 `module_model_call`。

### 4.4 构建

- **构建与测试不调用真实模型**：假内核对 `model` 返回占位文本，模块测试可自带桩响应。
- 构建通道的提示词与清单 schema 说明加入 `model` 的写法。

## 5. 文档与规则

- Chrona `AGENTS.md`：实现后把 "Today modules make no model calls" 改为本文的 `model` 能力。
- owner MCP 说明（`steward-mcp.ts`）中的 "rules Chrona runs without a model" 随实现一起改。
- P5 "结晶率"拆成两个数：未唤起 Provider 的比例、未调用模型的比例。

## 6. 验收

1. 全新数据目录启动 → `remind` 模块已启用，无审批；`chrona_schedule {mode: "remind"}` 到点发出与现在相同的通知；该次触发没有 Provider 运行，没有模型调用。
2. 提案修改 `remind`（例如正文加前缀）→ 审查启用 → 回滚到内置原版，行为恢复。
3. 迁移：已有提醒行迁移后照常触发；旧 `remind` 代码路径已删除。
4. GitHub Trending 模块声明 `model`：到点抓取 → 调用 `chrona.model()` → 调用 `notify` 发中文简报；没有 Provider 运行；`ModuleCall` 有记录。
5. 预算耗尽或 provider 出错 → `chrona.model()` 抛出 `ModelError`，模块按自身逻辑降级；不回退到其他模型。
6. 未配置 L1 `moduleModel` 时声明 `model` 的提案 build 失败并说明原因。

## 7. 未决问题

- 模型网关经 Pi 调用的确切形式。
- 是否允许模块基于模型输出再发起 `net` 请求（当前允许：权限不变）。
