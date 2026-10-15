# 通用事务工作协议：Chrona 管状态，Pi 做事

状态：2026-10-14 主线纠偏（用户批准）。取代「`/chrona <需求>` 只能识别 Chino 服务健康」的产品限制。
产品方向见 [personal-steward](personal-steward.md)，聊天入口与安全规则见 [steward-chat-loop](steward-chat-loop.md)（继续有效）。

## 要解决的问题

`/chrona` 只决定**入口、身份与消息边界**，不定义能做哪几类事。`/chrona` 之后的任何自然语言都成为一件
**工作（StewardWork）**，由真实 Pi 在 Chrona 授予的受限工具内多步完成：取上下文 → 选择工具（检索、
记录进展、澄清、发布成果、提议跟进/持续委托、起草脚本或面板）→ 由 Chrona 确定性地落成状态、成果、待处理与通知。
Chrona 内**没有**关键词/正则把需求分派到模板，也不把一次无工具模型 JSON 当作「通用」。

## 职责

| 谁 | 负责 | 不负责 |
| --- | --- | --- |
| Hermes 插件 `/chrona` | 身份、命令边界、渲染回执；把原话交给 `chrona_steward_chat_request` | 理解需求、分类 |
| Chrona | 工作状态机、租约、预算、超时、重试、取消、权限、成果发布、待处理、通知发件箱、审计、唤醒调度 | 理解需求内容 |
| Pi（`pi -p`，无内置工具） | 读上下文、规划、选择并调用 Chrona 工具与宿主 web 工具 | 持有权限、改状态、调度、直接发消息 |
| `pi-web-access`（宿主已有扩展） | `web_search` / `fetch_content` | 绕过 Chrona 预检 |

## 状态（权威在 Chrona）

`received → running → waiting_input | waiting_authorization | result_ready | received(重试)`；
`waiting_* → received`（用户补充/决定）；`result_ready → accepted`（用户验收）或 `received`（反馈后续做）；
委托撤销 → `cancelled`；连续失败 3 次 → `failed`（生成故障待处理）。委托暂停 → 不启动新运行，正在运行的被终止。
状态只由服务端工具效果或运行器改变；模型最后的自述文本只作尝试摘要，不覆盖状态。

每次运行是一条 `StewardWorkAttempt`：随机能力令牌（只存 SHA-256），只在该尝试 running 且未过截止时间时有效，
作用域 = 该工作所属工作区/事务/委托。预算：每次运行 6 分钟、30 次 Chrona 工具、10 次 web 调用；每工作每日 8 次运行。
重启：租约过期的尝试记为 `lease_expired`，工作回到 `received` 重试（工具幂等，已发布成果不重复）。
Pi 无法启动 → `agent_unavailable`，不计失败，退避后重试。

## 工作授权

聊天请求本身是该件事的明确、有界授权：Chrona 为每件工作建一条 `Delegation`（`workId` 非空，active，
不绑定来源连接、无 cadence、30 天过期），允许 `summarize / notify_user / create_follow_up / link_affair /
propose_delegation / propose_tool`，通知只发回发起的同一私聊。它**不**覆盖任何来源事件的评估/轮询/摘要
（这些路径排除 work 委托）。持续监控、读取新来源、启用工具都是**另一个提议**，需用户用回复码确认。

## 工具（服务端实现；扩展只做转发）

| 工具 | 效果 |
| --- | --- |
| `chrona_get_context` | 有界背景：请求原话、事务、已有进展、用户补充/反馈、上次提问、最新成果摘要、本工作权限、可用工具、已连接来源与本事务委托 |
| `chrona_read_source` | 只读：某个已连接来源的状态与 Chrona 已接收的近期事件（不触发新读取、不扩权） |
| `chrona_save_progress` | 结构化进展；可更新事务标题/目标、记录处理方式选择理由 |
| `chrona_ask_user` | 终止：`waiting_input`；生成「需要补充」待处理 + 通知（回复码） |
| `chrona_publish_result` | 终止：经成果层发布不可变版本（事务无 Task 时创建）；来源逐条标注「本次检索取得 / 未核实」；`result_ready` + 成果待处理 + 简报通知 |
| `chrona_request_authorization` | 终止：说明缺的是信息/工具/权限及如何授予；`waiting_authorization` |
| `chrona_propose_follow_up` | 提议跟进（到期唤醒本工作，原因 `follow_up_due`） |
| `chrona_propose_delegation` | 复用聊天提议：proposed 委托 + 回复码，用户确认后才生效 |
| `chrona_suggest` | 主动建议待处理；按 topic 去重，拒绝后冷却 |
| `chrona_draft_tool` | 面板/规则：声明式规格走既有工具生命周期（generated）；脚本：仅保存草稿与验证计划，Chrona 不执行 |
| `chrona_close_quietly` | 终止：复查后判断不打扰，记录理由 |
| `web_search` / `fetch_content` | 宿主工具；每次调用前 Chrona 预检（预算、仅公网 http(s)、无本地文件/认证 cookie），调用后上报看到的 URL |

## 主动跟进（有界）

唤醒只来自：新请求、用户补充/反馈/决定、到期跟进、事务关联的新事件（合并为一次）、失败重试。
不对模型做裸定时轮询。复查时 Agent 可选择不打扰（`close_quietly`）、更新成果、建议、请求决定。

## 代码位置

契约 `packages/contracts/src/steward/index.ts`（work 段）；schema `StewardWork`、`StewardWorkAttempt`；
引擎 `packages/engine/src/modules/steward/work*.ts`；Pi 运行器与扩展 `packages/integrations/src/steward/pi-agent*`；
工具端点 `POST /api/steward/agent/tools/:name`（仅令牌、拒绝经反向代理的请求）。

## 现状（2026-10-14 晚，隔离实例真实 Pi 验收）

- 实现并有测试：工作状态机/租约/预算/重试/取消（`work.bun.test.ts`）、全部工具效果（`work-tools.bun.test.ts`）、
  真实 HTTP + 真实运行器 + 假 pi（`apps/server/src/__tests__/api/steward-agent-work.bun.test.ts`）、插件 0.3.0（不再分类需求）。
- 真实 Pi（Chino，`pi -p` + 本扩展 + pi-web-access）在隔离实例（临时库、假 QQ 发送器）完成：研究并检索来源发布成果、
  澄清后续做、只读已连接来源后提出未启用的监测提议、注入请求拒绝且不伪称成功、未连接邮箱时说明缺工具并请求授权、
  给出格式后起草脚本草稿（未运行、未验证）。证据见部署目录 `iso/acceptance.jsonl`。
- 未实现：任意脚本沙箱执行；声明式面板以外的交互页面生成；除 Chino 健康以外的新来源接入；QQ 消息原生引用 ID 绑定。
- 生产（2026-10-14 23:53）：Chino `chrona-0.3.1-steward-agent4-20261014`，`CHRONA_STEWARD_AGENT=pi` + 宿主 pi-web-access；Hermes 插件 `chrona-steward` 0.3.0 热加载。回执 `/var/lib/chrona-pi/deployment/20261014-general-agent/receipt.json`。真实 QQ 端到端尚待用户亲自发送 `/chrona …`。
