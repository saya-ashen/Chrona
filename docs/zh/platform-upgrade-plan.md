# Chrona 升级为可自生长平台：改造方案

状态：P0–P4 已实现（构建通道额度为暂定值，见 [构建通道规格](platform-p4-build-spec.md)）；P5 已实现幂等键部分（[P5 规格](platform-p5-spec.md)），其余未开始。
范式来源：`~/workspace/agent-growth-lab/docs/self-modification-paradigm.md`（下称"范式"）。
用户已确认：本方案以当前需求为准，旧 AGENTS.md / steward 文档中与之冲突的约束（删除 ManagedTool、沙箱只用于旧脚本调度、不给 Provider 提供工具等）可以修改。

## 0. 目标

> Chrona 本身成为范式平台：Provider（先是 Pi）在聊天中理解需求，提出模块；Chrona 构建、验证、启用、回滚模块，并在 Provider 不运行时执行它们。

- **生长的对象**：模块（后台规则、定时检查、事件处理、导出给 Provider 的工具）及其数据。
- **不生长的对象**：Chrona 内核（engine、策略、调度、网关、桥接、页面框架）与 Provider 本身的循环。
- **最终效果**：重复且规则稳定的工作被固化为模块，此后不调用模型；每次修改可审查、可验证、可回滚。

与 [steward-goals](steward-goals.md) 的关系：本方案是 §4"重复且规则稳定 → 生成脚本自动化"和 §11"成本有界"的实现路径；产品定位、事务概念、打扰预算、权限模式全部不变。

## 1. 现状评估

### 1.1 直接保留（已符合范式）

| 现有 | 范式角色 |
|---|---|
| `packages/domain/src/steward/policy.ts`、Grant、Approval | L1 策略 |
| `notify-budget.ts`、Notification `dedupeKey` | L1 副作用上限、幂等 |
| `schedules.ts`、`tick.ts`（重启补跑、崩溃不重跑外部操作） | 平台调度 |
| Schedule `remind` / `wake` | 内核原语，保留，不算模块 |
| `script-sandbox.ts`（bwrap） | 模块执行沙箱（需收紧，见 P0） |
| `external-plugins/pi-steward-agent`：启动时从 `/catalog` 取工具清单并注册 | 宿主薄客户端；**模块导出的工具可直接经 catalog 暴露** |
| 连接器与 `secrets.ts`（凭据不进 Provider 环境变量） | 外部输入经内核注入 |
| Run、InboundItem、Message、Activity、Audit | 证据链；**轨迹回放的数据源** |
| 事务 git 目录、`*.ui.json`（封闭组件与动作集合） | 内容层，见 §2.2 |

### 1.2 已发现的问题（P0 处理）

1. **Pi 能读到凭据与数据库。** `pi-launch.ts` 用 `--ro-bind / /` 启动 Pi，只把事务目录设为可写；`<dataDir>/secrets`（0600，同一 uid）与 SQLite 数据库对 Pi 可读。被提示注入的 Pi 可以 `cat` 出 QQ/邮箱凭据。与 steward-goals §7.6"凭据不进 Agent"不符。
2. **旧调度脚本能读凭据并联网。** `script-sandbox.ts` 带 cwd 运行时同样 `--ro-bind / /` 且 `--share-net`。
3. **旧脚本调度批准不绑定代码。** 原执行动作默认 `notify_after`，按事务判定，不绑定 command 或脚本内容 hash；脚本位于 Pi 可写的事务目录，批准后仍可被修改。与 steward-goals §7.3"首次运行或修改后的脚本先问再做"不符。

以上为代码阅读结论，尚未实际复现。

### 1.3 删除或替换

| 现有 | 处理 |
|---|---|
| Schedule 的旧脚本模式及命令、输出哈希列 | 已由模块替代，0005_drop_jobs 删除旧行与列 |
| "输出 hash 变化就唤醒 Provider" | 改为模块显式声明 `wake_provider` 副作用 |
| AGENTS.md 中"沙箱只用于定时脚本""不给 Provider 提供工具"、禁止 ManagedTool 类表 | 改写为本方案的规则 |

## 2. 目标架构

### 2.1 四层落到 Chrona

| 层 | Chrona 中的位置 | 谁能改 |
|---|---|---|
| L1 策略 | Grant、Approval、通知预算、运行预算、设置 | 仅用户 |
| L2 平台声明 | `Generation` 表：启用的模块版本与参数 | 经网关 |
| L3 模块 | `<dataDir>/platform/store/<hash>/`（不可变，Pi 不挂载） | 经网关 |
| L4 模块数据 | `<dataDir>/platform/data/<module>/`（Pi 不挂载） | 仅模块运行时 |

### 2.2 内容与代码分开

- **内容**：事务目录里的 Markdown、面板数据、`*.ui.json`。仍由 Provider 直接写、git 记录、可撤回，**不经网关**。`*.ui.json` 只使用封闭组件和动作集合，属于声明式内容，不是代码。
- **代码**：任何会被 Chrona 执行的东西。**只能是模块，只能经网关。** 事务目录里的脚本不再可执行。

这条边界让产品体验不变（Provider 改页面仍然即时），同时把可执行代码全部收进网关。

### 2.3 进程与隔离

```
QQ / 网页 ──► Chrona server（内核：策略、调度、网关、执行器、存储）
                 │  loopback + 每次运行的 token（现有）
                 ▼
            Pi（bwrap：只挂载事务目录与会话目录；看不到 secrets、DB、platform/）
                 │  chrona_propose 等工具
                 ▼
            网关 → 构建沙箱 → 验证 → 审查卡片 → 启用
                                            │
                      模块沙箱（bwrap：只挂载本模块代码只读、本模块数据可写；默认无网络）
```

## 3. 模块模型

### 3.1 清单 `module.json`

```json
{
  "name": "price-watch",
  "version": 3,
  "affair": "<affairId>",
  "entry": "index.ts",
  "triggers": [
    { "id": "daily", "schedule": { "kind": "daily", "at": "10:00" } },
    { "id": "mail", "inbound": { "connector": "<connectorId>", "match": { "from": "*@shop.example" } } }
  ],
  "tools": [{ "name": "price_watch_status", "description": "...", "parameters": {} }],
  "effects": ["net:shop.example", "notify_user", "wake_provider"],
  "params": { "threshold": { "type": "number", "value": 2100 } },
  "data": { "schema": 2, "migrations": { "1->2": "migrate-1-2.ts" }, "reversible": [] },
  "tests": ["test.ts"]
}
```

- `affair`：归属事务。事务结束时其模块停用，或由用户改为全局保留（steward-goals §2）。
- `triggers`：v1 支持 `schedule`（复用现有 rule 格式）和 `inbound`；页面编辑触发放到 P4。
- `tools`：经 `/catalog` 暴露给 Provider；只在相关事务的运行里出现，避免撑满上下文。
- `effects`：取值为 Chrona 现有 Action（`notify_user`、`send_external_message`、`modify_external`…）加上 `net:<host>` 和 `wake_provider`。

### 3.2 执行方式：模块只产出意图

模块在沙箱中运行，输入为 JSON（触发事件、参数、`now`），输出为 JSON：

```json
{ "effects": [
  { "type": "notify_user", "key": "price:2026-10-21", "level": "now", "title": "降价", "body": "..." },
  { "type": "wake_provider", "key": "...", "prompt": "价格出现异常波动，请判断" }
], "result": { } }
```

- 模块**不能直接产生副作用**。Chrona 执行器逐条检查：是否在清单 `effects` 内、L1 当前是否允许；然后经现有通道执行（通知预算、审批、邮件）。这就是范式的 outbox，`key` 用作幂等键。
- 工具调用同样走这条路径：Provider 调用模块工具 → Chrona 在沙箱中运行模块 → 返回 `result`。
- 网络：`net:<host>` 无法用 bwrap 按主机放行。v1 只区分"无网络 / 有网络"，`net:*` 至少需要 `preapproved`；按主机放行要靠 Chrona 侧的 HTTP 代理，列入 P5。

### 3.3 纯度

模块只能从输入中获得时间与事件，从自己的数据目录读写状态。不得在模块内常驻进程或自建定时器（沙箱每次触发都新建进程）。这是 P3 回放验证的前提。

### 3.4 触发分级与唤起 Provider

Chrona 既为 Provider 提供工具，又在触发时启动 Provider。这与操作系统调度进程、同时提供系统调用相同：控制权单向，Provider 不能启动 Chrona、延长自身运行或绕过策略。需要调整的是**何时**唤起 Provider：

| 级别 | 适用 | 调用模型 |
|---|---|---|
| `remind` | 到点发固定文本 | 否 |
| 模块 | 规则稳定（降价判断、邮件分拣） | 否 |
| 模块 + `wake_provider` | 规则处理不了的例外 | 仅例外时 |
| `wake` | 本身需要模型（准备当天材料、写摘要） | 每次 |

默认演进：新需求先用 `wake` 做几次；规则稳定后（steward-goals §4"第三次出现"）由 Provider 提议固化为模块。`wake` 不取消，它是结晶前的探索阶段，也是需要模型的任务的长期形态。

必须守住：

1. **自我放大循环**：wake 设 wake、模块唤起 Provider 又提交修改模块的提案。模块触发的唤起与提案都计入事务运行预算与每日运行上限。
2. **后台无人在场**：后台运行遇到需要批准的动作，挂入待答复入口，不阻塞等待。
3. **触发数据不可信**：模块的 `wake_provider` 内容、来源事件一律按 untrusted data 注入，与原脚本调度输出处理一致。

## 4. 网关

### 4.1 提交

新工具 `chrona_propose`，两种形式，信任等级相同：

- **完整提案**：Provider 在事务目录的 `.chrona/proposals/<id>/` 写好模块文件，提交清单、意图声明（`changes` / `preserves`）。
- **意图提案**：只交意图声明与示例，由构建通道生成代码（P4）。

### 4.2 build

1. 把提案文件复制进 Chrona 的私有暂存区（此后 Provider 的修改不再影响候选）。
2. 校验清单；检查 `effects` 在 L1 允许范围内（`never` 直接拒绝）。
3. 在构建沙箱中加载入口、运行 `tests`。
4. 计算内容 hash，候选写入 `platform/store/<hash>/`。

### 4.3 verify

| 阶段 | 检查 |
|---|---|
| P1 | 清单、测试、在数据副本上执行迁移 |
| P2 | 连续性：旧版本留下的数据在新版本下仍能处理 |
| P3 | 轨迹回放：用该模块过去的触发记录在新旧版本上各跑一遍，比较 effects 意图；差异必须被 `changes` 解释 |
| P5 | 变形测试；独立模型审查 diff 是否超出意图 |

### 4.4 审查与启用

- 新 Action `activate_module`，默认 `ask`。审查卡片显示：清单 diff、意图声明、验证报告、代码 diff（折叠，二级页面）。
- **批准绑定候选 hash。** 内容不同就是新候选，必须重新批准。
- 用户可在某事务内授予 `preapproved`：此后"不新增 effects、验证全部通过"的修改自动启用并做完告知（P3 起才开放，因为需要回放证据）。
- 启用即生成新的 `Generation` 记录；切换在两次触发之间进行，执行器只读当前 generation。

### 4.5 回滚

- 网页"连接与工具"页列出每个模块的版本历史与平台 generation，可一键回到任一版本。
- 数据：schema 相同直接回；有验证过的反向迁移就执行；否则要求用户在"恢复该版本的数据快照（显示会丢失的内容）"与"放弃回滚"之间选择。
- 已执行的副作用不撤销，回滚报告中列出；属于被回滚版本、尚未执行的 effects 作废。

## 5. 数据模型变更

| 模型 | 变更 |
|---|---|
| `Module` | 新增：name、affairId（可空=全局）、当前版本、状态 |
| `ModuleVersion` | 新增：hash、清单、意图声明、来源（哪条提交路径、哪个模型）、验证报告、批准记录 |
| `Generation` | 新增：序号、各模块版本 hash、参数、启用时间、对应的 L1 版本 |
| `ModuleRun` | 新增：触发、输入摘要、输出 effects、执行结果；也是回放数据源 |
| `ModuleEffect` | 新增：幂等键、状态（pending / done / rejected / void） |
| `Schedule` | 已删除旧命令、输出哈希列；公开创建仅 `wake` / `remind`；模块的定时触发由 Module 清单生成内部 `module` 调度 |
| Action 枚举 | 新增 `activate_module`、`network` |

模块数据不进数据库，放在 `platform/data/<module>/`，带 `schema.json`。

## 6. 文档与规则改动

- `AGENTS.md`：更新 Product 规则与 Code map；删除"No backward compatibility … managed-tool tables"中关于工具表的部分，改为"可执行代码只能是模块，只能经网关"；更新沙箱用途说明。
- `steward-workspace.md`：§2 分工表增加"模块生命周期"；§3 说明事务目录脚本不再可执行；§4 增加 `chrona_propose`、`chrona_modules`。
- `steward-goals.md`：§7 默认分级表补充 `activate_module`、`network`；其余不变。
- `packages/contracts/src/steward`：新增模块相关 schema 与工具定义（supervisor 所有，按现行规则由主线修改）。

## 7. 分阶段计划

每一阶段结束时，Chrona 都应完整可用。

### P0 安全修补（已完成；见 [端到端记录](platform-e2e-2026-10-20.md)）

- Pi 的 bwrap：不再 `--ro-bind / /`，改为只读挂载运行所需路径（/nix/store、Pi 安装与配置目录），显式排除 `<dataDir>`，只绑定事务与会话目录。
- 旧脚本调度沙箱同样屏蔽 `<dataDir>` 与用户主目录。暂时保留联网：原价格/服务检查脚本依赖网络，按策略控制网络放到 P1。
- ~~旧脚本调度批准绑定内容 hash~~：并入 P1。脚本位于 Pi 可写的事务目录，只绑定 command 字符串无法阻止批准后改脚本；P1 把代码移出该目录后才能真正解决。

**验收**：在 Pi 运行和脚本沙箱中尝试读取 `<dataDir>/secrets` 与数据库失败；事务目录仍可写；现有测试通过。

### P1 模块与网关最小闭环（已完成；见 [P1 规格](platform-p1-spec.md) 与 [端到端记录](platform-e2e-2026-10-20.md)）

- `Module` / `ModuleVersion` / `Generation` / `ModuleRun` / `ModuleEffect`。
- `chrona_propose`（仅完整提案）、build、verify（清单 + 测试）、审查卡片、启用、回滚（仅代码）。
- 执行器：schedule 触发 → 沙箱 → effects 经策略与现有通道执行。
- 模块批准绑定内容 hash（原 P0-c）；模块沙箱联网须 `network` 授权。
- 旧脚本调度已彻底删除（0005_drop_jobs），不迁移旧行；需要继续运行的检查重新提案为模块（`effects: ["wake_provider"]`，有网络则加 `network`），首次运行要求批准。

**验收**：在 QQ 里说"每天 10 点看一下 X 价格，低于 2100 告诉我" → Pi 提交模块 → 网页审查并批准 → 到点由模块直接通知，**该次触发没有 Provider 运行** → 修改阈值产生新版本 → 回滚到上一版本后行为恢复。

### P2 数据与连续性（已完成；见 [P2 规格](platform-p2-spec.md)）

- 模块数据目录、schema 版本、迁移在副本上执行、反向迁移与回滚规则（§4.5）。
- 连续性检查。

**验收**：v1 写入的状态在 v2 下仍被正确使用；无反向迁移时回滚给出选择而不是静默丢数据。

### P3 回放验证与自动启用（已完成；改为并行模拟，见 [P3 规格](platform-p3-spec.md)）

- 以 `ModuleRun` 为数据源做轨迹回放；意图对照。
- 开放 `activate_module` 的 `preapproved`（仅限不新增 effects 且回放通过）。

**验收**：故意加入一条意图中未声明的规则（如"再降 200 才通知"），回放报告标出差异并阻止自动启用。

### P4 扩大生长面（已完成，见 [P4 规格](platform-p4-spec.md)、[构建通道规格](platform-p4-build-spec.md) 与 [端到端记录](platform-e2e-p4-build-2026-10-21.md)）

- `inbound` 触发（steward-workspace §9 的"AI 写 Chrona 执行的廉价规则"）。
- 模块导出工具，经 `/catalog` 按事务暴露。
- 构建通道：意图提案由一次干净的 Pi 运行生成代码（独立 lane、无事务上下文、独立预算、失败只反馈公开信息、最多 N 次）。

**验收**：邮件分拣规则作为模块运行，只有不确定的邮件才唤醒 Provider；Pi 在相关事务中能调用模块工具，其他事务中看不到。

### P5 质量与可观察性

- 变形测试；独立模型审查；Chrona 侧 HTTP 代理实现按主机放行网络。
- 网页显示每个事务的"结晶率"：触发次数中由模块直接完成、未调用模型的比例，以及节省的运行次数。
- 模块即工具集：模块工具全工作区可见、按需加载，并经 owner MCP 提供给用户自己的 agent（[规格](platform-p5-tools-spec.md)，已实现）。

## 8. 风险与未决问题

- **回放覆盖**：只覆盖已发生过的触发；新模块的首个版本仍主要靠测试与人工审查。
- **意图声明过宽**：P5 的独立审查只是缓解，没有根治。
- **多 Provider**：本方案只针对 Pi；Claude Code 等接入时，提交路径不变，但它们的沙箱需要各自实现 P0 的隔离。
- **事务结束后的模块**：默认停用；"保留为全局"的交互与权限范围需设计。
- **开发者可见性**：模块代码在 `platform/store`，Provider 看不到旧版本源码时如何修改？建议提案时由 Chrona 把当前版本源码复制进 `.chrona/proposals/<id>/` 作为起点。
- **P0 的结论来自代码阅读**，尚未在运行环境中复现。
