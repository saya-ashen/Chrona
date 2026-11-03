# v2-26 规格：心智（mind）

状态：§6 内核改动与 `builtin/mind`（§3–§5）已实现（2026-10-30），未部署；§9 第 3–4 步待做。心智 v2（关注清单、新的直觉输入、内核思考协议）见 [v2-28](platform-v2-28-mind-agenda.md)，其 §6 取代本文 §5 的准则与唤醒提示。依赖 [v2-10](platform-v2-10-ai-calls.md)（`provider.wake`）、[v2-14](platform-v2-14-contributions-events.md)、[v2-16](platform-v2-16-module-secrets-requests.md)（模块 secrets）、[v2-17](platform-v2-17-approval-levels-model-tiers.md)、[v2-19](platform-v2-19-reflection.md)、[v2-23](platform-v2-23-app-pages.md)（模块设置）、[v2-24](platform-v2-24-timers.md)。

## 1. 背景

Chrona 只在用户说话、定时到点、出现审批或 v2-19 的两种反思信号时才动。[steward-goals](../steward-goals.md) §6 要求的“持续跟进未结束的事、关注期限与阻塞、发现值得提醒的信息、判断何时保持安静”没有落点；反思也只能发起构建，不能提醒、继续推进或停用模块。

v2-26 加一个“心智”：频繁、廉价地感知整体情况（直觉），只在值得时唤醒完整的 Chrona 思考并行动。

## 2. 设计原则：心智是模块，不是内核

内核只保留信任根（v2-14）。心智需要的能力都已存在：

| 需要 | 已有 |
|---|---|
| 频繁检查 | 模块定时（清单 `triggers` 或 `schedules.create`，`every ≥ 5` 分钟） |
| 感知 | 路由调用 `chat.today`（待审批、日程、带反馈的近期通知、会话、健康）、`chat.runs`、`modules.list` |
| 直觉模型 | 模块设置（v2-23）+ 模块 secrets（v2-16）+ `effects: ["network"]` |
| 唤醒思考 | `provider.wake`：新会话里的完整 Chrona（系统提示、记忆、日程、全部 `m_*` 工具，照常经策略层） |

因此心智是一个**内置模块** `mind`（`builtin/mind`）。它本身没有任何新权力：最多只能“叫醒 Chrona 并说明为什么”，醒来的 Chrona 做什么、能不能做，由现有策略与审批决定。心智是普通模块，Chrona 以后也能经构建改进它，版本照常分级。

## 3. 感知（每次检查）

清单触发器每 5 分钟一次；距上次感知不足 `interval-minutes`（设置，默认 15，范围 5–120）则直接结束，不做任何调用。设置 `enabled`（默认开）关闭后不再感知和唤醒。

1. 读：`chat.today`、`modules.list`、`chat.runs`。读不到（如构建时的冒烟启动）则什么都不判断。
2. 信号（每条有稳定的 key，处理过的不再触发规则）：故障且自动恢复已放弃、应用新上线或更新（心智在自己的数据里记下各应用的 `activeHash`，首次感知只记录不触发）、等待用户回答超过 1 天的运行、待你决定超过 1 天的审批。
3. 变化摘要：信号文字、24 小时内到期的日程、超过 3 天没有活动的会话、近 7 天被标“没用”的通知、已停用的应用。只含名称和截断的标题，不含业务数据原文。
4. 与上次已处理的摘要比较哈希；相同则结束，不调用任何模型。Provider 不可用时也结束，下次再看。

## 4. 直觉（是否唤醒）

### 4.1 直觉模型

调用一个通用的 System One 决策接口；用哪家、哪个模型由用户决定，Chrona 不内置或部署模型。

- 设置：`intuition-url`（如 `https://api.typesafe.ai/v1/systemone`；空 = 不用直觉模型）、`intuition-model`（默认 `jev-latest`）。
- 凭据：secret `mind_intuition` 的 `key` 字段，用户在设置或 `chrona admin secret-set` 保存；作为 Bearer 发送。未保存时按规则判断。
- 请求格式按 Jev：`{ model, state, questions }`，`questions` 以 id 为键，每个含 `type`、`instructions`；choice 的 `criteria` 为“选项 → 说明”，score 的 `criteria` 为由低到高的等级。读取 `answers.wake.noul`、`answers.focus.choice`、`answers.urgency.score`。兼容此格式的服务都可用。摘要会发到该服务，设置项说明里写明。

固定三个问题：

| id | 类型 | 内容 |
|---|---|---|
| `wake` | noul | 现在是否值得唤醒 Chrona |
| `focus` | choice | `incident`、`deadline`、`stalled`、`waiting`、`module-health`、`nothing` |
| `urgency` | score（0–1） | 紧急程度 |

### 4.2 决定（确定性，在模块内）

- `wake ≥ wake-threshold`（默认 0.75）且 `focus ≠ nothing`：唤醒。
- `wake ≤ sleep-threshold`（默认 0.25）：不唤醒，记为已处理。
- 介于两者之间、接口失败、返回不合法、未配置或额度用尽：按规则——有未处理过的信号（§3 第 2 项）即唤醒。**不换用其他模型。**

### 4.3 约束

- 两次唤醒至少间隔 1 小时（`urgency ≥ 0.8` 时 15 分钟）；滚动 24 小时最多 `daily-wakes`（默认 6）次。超限时什么都不记为已处理，下次感知再看。
- 每日兜底：清单触发器每天当地 09:00；过去 24 小时没有唤醒、且摘要自上次处理后有变化，唤醒一次。
- 不设安静时段：唤醒本身不打扰用户，醒来后的通知受 `notify` 的安静时段与打扰预算约束。
- 直觉滚动 24 小时调用上限 `intuition-daily-calls`（默认 96），用尽后按规则。
- 这些是模块的自律。信任边界仍是内核的 Provider 每日运行上限（`RUN_LIMITS.maxRunsPerDay`），唤醒的运行计入其中。

## 5. 思考（唤醒后）

心智调用 `provider.wake({ prompt })`（≤4000 字），键由触发事件派生（SDK `wakeProvider`）。提示包含：判断准则、触发来源（intuition/rules/daily）、`focus` 与 `urgency`、变化摘要（截断）。准则：

- 默认什么都不做；只做明确对用户有用的事，每次最多 3 个对外可见的动作。
- 可做：提醒或汇报（受打扰预算）、安排以后再看、读相关应用与会话后继续推进、发起修复或新应用的构建、请求回滚或停用应用（`m_modules_disable`，需用户批准）、确实长期无用时请求删除（`m_modules_remove`，🔴 需用户在网页批准）、不确定时问用户。
- 同一主题 30 天内不重复提出；被拒绝的同类建议除非情况明显变化不再提。
- 结束时用一句话说明做了什么，或“无事”。

醒来的会话来源为 `module`（`viaModule: mind`），提示照常作为不可信数据传入，结果照常回报。误醒率（醒来后“无事”的比例）在 §9 第 3 步观察时再定怎么统计和展示。

## 6. 内核改动

| 改动 | 位置 | 级别 |
|---|---|---|
| `modules.disable`、`modules.enable` 系统工具（Provider 名 `m_modules_disable`/`m_modules_enable`，入参 `module`、`reason`）。用户与 Provider 调用都直接生效（security-simplification §3.1），Provider 的理由记入审计 | `module-status.ts`、`modules.ts`（`lifecycle`）、`module-activation.ts`、`service.ts`、`system-modules.ts`、`system-outputs.ts` | 不再审批 |

停用记录它暂停了哪些定时（审计 `module_disabled.details.schedules`），启用只恢复这些定时并重算下次时间（错过的一次性定时立即触发），用户自己暂停的定时不受影响。`chrona admin disable` 走同一逻辑。

心智需要的读取都已对模块开放（`chat.today` 带通知反馈；上线与更新由心智比较 `activeHash` 得出），所以 `activity.list`、`notify.list` 不改。

`modules.remove`（Provider 名 `m_modules_remove`）：无论谁调用都创建 🔴 `delete_data` 审批（不挂在模块上，以免随模块一起删除），只能在网页、仅这次批准。内置应用、入口应用、正被其他应用 `uses` 的应用直接拒绝。批准后：核对审批与活动版本 → 停用并停止进程 → 把数据、文件和当前代码复制到 `<dataDir>/platform/removed/<名称>-<时间>/` → 删除模块记录（连带版本、运行、定时与其审批）、撤销该模块的授权、删除其设置 → 删除数据与文件目录；审计 `module_removed` 记下备份位置。实现在 `module-remove.ts`。

不改：`tick.ts`、`settings.ts`、共享契约、会话类型、网页设置页（心智的设置自动出现在其应用页）。

## 7. 与 v2-19 反思的关系

心智的规则覆盖反思的两种信号，且醒来的是完整的 Chrona。心智上线并稳定两周后，删除内核 tick 阶段 `reflect`、系统模块 `reflection` 及 `settings.reflection`。代价：反思原本“只能提建议”的受限会话变为完整权限的会话；后者与聊天会话权限相同，仍受策略层与审批约束。

## 8. 校准与风险

- System One 模型的公开证据偏弱：唯一的对比论文（arXiv 2610.02267）为单作者预印本，样本内调阈值导致保留集漏判最高达 17%；厂商的速度与成本数字未经独立验证。所以直觉只决定“是否叫醒”，不决定做什么，并有规则与每日兜底。
- 最坏情况：误醒（受 §4.3 与内核运行上限约束）或漏判（规则与兜底覆盖）。摘要中的注入文本最多导致多叫醒几次，无法获得任何能力。
- 上线后观察两周：误醒率、漏判（用户主动提起而心智未发现的事）、直觉调用量与唤醒次数；据此调整阈值。

## 9. 实现顺序

1. 内核 §6 改动与测试（已完成）。
2. `builtin/mind`：感知、规则、直觉接口、唤醒、自律约束、测试（假内核 + 本地假直觉服务）（已完成）。
3. 部署后观察两周：误醒率、漏判、调用量；定误醒率的统计与展示，调整阈值。
4. 按 §7 删除反思。

## 10. 不在本版

- 直觉决定做什么（只决定是否唤醒）。
- 直觉读取图片或业务数据原文。
- 训练或微调直觉模型。
- 内核层面的按模块唤醒上限。
