# Coding 平级客户端协议

日期：2026-11-09。**本地回执原子接受与恢复测试已通过；最终发行验收见实施记录。** 本文按当前 [应用协议](../../packages/engine/src/modules/steward/external/coding/protocol.md)、`commands.ts`、`service.ts`、`index.ts` 及 Agent 项目合同说明客户端约定；接入和检查结果见 [实施记录](coding-peer-clients-implementation.md)。

## 一个业务入口，两种传输

无界面的普通可选应用 `coding` 管理共享业务；普通可选应用 `coding-web`、编辑器及未来 Electron 只消费协议。`coding-web` 不拥有 Agent 执行。当前仅 Remind 整应用暂停；Mind 是默认关闭自动检查的可选应用；旧 Editor 应用已退役并移除，见[退役记录](editor-retirement.md)。这里的编辑器指仓库外客户端，不是旧 Editor 服务应用。

| 传输 | 请求 | 成功返回 |
| --- | --- | --- |
| 模块调用 | `chrona.call("coding.command", {input: JSON.stringify(command)})` | 直接得到业务输出，如 `{receipt}` |
| 认证 HTTP | `POST /api/coding/v1/commands`，JSON body 直接为 `command` | HTTP 200，`{result:<业务输出>}` |

两条路径均调用 `handleCodingCommand(context, command)`。SDK 的工具事件返回 `{result:<业务输出>}`，路由消费这一层；模块客户端不要再解一层 `result`。HTTP 由入口通过 `chrona.serve` 注册，使用服务器全局 `/api` API-key 认证，不从 body、查询参数或自定义主体头生成调用身份。Provider 不作为客户端代理。

**准入：** Coding 与 coding-web 是经安装/更新治理的普通 owner 应用，manifest 显式声明 `uses:["*"]`。路由仍核对当前已批准版本与真实模块身份；显式工具依赖本身不授予 owner 权限。Coding 调用 Agent 项目接口时保留自己的 module principal，不将它转换为 owner principal。

HTTP 仅接受 UTF-8 `application/json`（可带 UTF-8 charset），不接受压缩 body；传输 body 上限 256 KiB，业务命令仍受更小的 32 KiB 限制。错误为 `{error:{code,message}}`：`invalid`→400、`forbidden`→403、`not_found`→404、`conflict`→409、`capacity`→429、`too_large`→413、`unavailable`→503；错误方法为 405，错误媒体类型为 415。未知异常统一返回 503，不序列化堆栈或任意异常属性。

## 命令与字段

命令对象严格拒绝额外字段，不接受 `caller`、客户端身份、选中对话、草稿、cwd 或任意 Agent 工具名称。ID/请求键最长 100 字符，匹配 `[A-Za-z0-9][A-Za-z0-9._:-]*`。普通发送文本非空白且最长 20,000 字符；答复最长 8,000，可为空或纯空白；文本禁止 NUL。项目路径为绝对路径、最长 4,096 字符；标题最长 200；创建名称匹配 `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`。整个命令的 UTF-8 JSON 最多 32 KiB。

下表必填字段均不包含 `op`。`target` 只是表格缩写，实际发送时展开为 `sessionId,workId,runId,attemptId`，不能发送名为 `target` 的字段。

| op | 必填字段 | 可选字段 | 业务输出 |
| --- | --- | --- | --- |
| `projects.list` | 无 | 无 | `{projects,defaultProjectRef}` |
| `projects.register` | `requestKey,path` | 无 | `{receipt}`，value 为项目 |
| `projects.create` | `requestKey,name` | 无 | `{receipt}`，value 为项目 |
| `projects.default` | `requestKey,projectRef` | 无 | `{receipt}`，value 为 `{defaultProjectRef}` |
| `conversations.list` | 无 | `projectRef,after,limit` | `{sessions,after}`；limit 1..100，默认 50 |
| `conversations.create` | `requestKey,projectRef,title` | 无 | `{receipt}`，value 为对话；不启动执行 |
| `conversations.get` | `sessionId` | `before,workBefore` | `{session,view,history}` |
| `round.send` | `requestKey,sessionId,workId,text` | 无 | `{receipt}`；首次 workId 必须为 null，之后传预期当前值 |
| `round.retry` | `requestKey,sessionId,originalRequestKey` | 无 | `{receipt}`，value 为 `{receipt:<原命令回执>}` |
| `round.stop` | `requestKey`、target | 无 | `{receipt}`；accepted 仅表示已请求停止 |
| `round.answer` | `requestKey`、target、`questionId,text` | 无 | `{receipt}` |
| `events` | target | `cursor,limit` | `{events,cursor,highWatermark,gap,snapshotRequired}`；limit 1..100，默认 100 |
| `snapshot` | target | 无 | Agent 执行快照 |
| `results` | `sessionId,workId` | 无 | `{results}` |
| `read-result` | `sessionId,workId,resultId` | 无 | `{base64,mime:"application/json"}` |
| `accept` | `requestKey,sessionId,workId,resultId` | 无 | `{receipt}`，value 为接受结果 |
| `receipt` | `requestKey` | 无 | `{receipt}` 或 `not_found` |

模块调用示例：

```ts
const { receipt } = await chrona.call("coding.command", {
  input: JSON.stringify({
    op: "round.send", requestKey: "send-001",
    sessionId: "chat-example", workId: null, text: "说明需要完成的改动",
  }),
});
```

## Agent 项目合同与主体

Coding 的 `projects.create` 转为 Agent `{action:"create",name}`，**只传名称**；`projects.register` 转为 `{action:"register",path}`，**只传路径**；list 为 `{action:"list"}`。禁止 create 带 path、register 带 name，不能用路径替代执行所需的 opaque `projectRef`。

Agent 严格返回带标签的联合：

```ts
type Principal = {
  workspaceId: string;
  ownerId: "owner";
  caller: { kind: "module"; moduleId: string; hash: string };
};
type Project = { projectRef: string; path: string; label: string };
type ProjectReply =
  | { action: "list"; principal: Principal; projects: Project[] }
  | { action: "create"; principal: Principal; project: Project }
  | { action: "register"; principal: Principal; project: Project };
```

list 最多 100 项。不能接受裸数组、缺少 principal 的结果或不匹配的 action。Agent 准入从实时原始调用验证工作区和当前已批准应用身份；项目和执行始终使用原始 Coding module principal。`ownerId:"owner"` 不表示 caller 变成 owner；客户端也不获得 Coding 的主体。项目规则在每轮真实执行 cwd 读取，不从任务文本提取主机 cwd 或规则路径。

## 回执、原子接受和未知结果

回执为 `{requestKey,op,status:"pending"|"accepted"|"rejected",sessionId?,workId?,value?,error?:{code,message}}`。同键同参返回原回执且不重发；同键改参为 `conflict`。HTTP/工具响应丢失后保留请求键，先查 `receipt`；查询不到不能直接推断外部动作失败。协议不自动重放未知动作。

本地 `conversations.create`、`projects.default` 把状态和 accepted 回执作为一次原子日志提交；同一次文件替换包含两者，并同步文件与父目录。隔离测试覆盖持久化失败、丢回包与重载后的同键重放。外部动作先持久化 pending 意图，再调用 Agent；不得把磁盘操作与外部执行描述成同一个事务。

Agent 答复的权威未准入结果是严格联合中的返回值：

```ts
type AnswerAdmission =
  | { accepted: true }
  | { accepted: false; error: {
      code: "not_found" | "conflict" | "invalid" | "forbidden" | "capacity";
      message: string;
    } };
```

只有可信 Agent 路径返回的完整 `accepted:false,error` 分支，才足以将本次答复记为 rejected turn/receipt。裸 `false`、缺少 error 的 `{accepted:false}`、多余字段、畸形接受结果、调用超时、丢回包和调用抛出的 `conflict` 都不能当成这个未准入分支；外部动作的未知结果保持 pending。准备阶段的确定校验失败（`invalid/conflict/not_found/forbidden/capacity`）先持久化与原键、参数签名绑定的 rejected 回执，再返回原错误；失败准备产生的局部状态被丢弃。客户端可查询该回执以解除阻塞并保留草稿。保存失败和外部执行阶段的异常不构成拒绝证据。命令解析失败、回执容量已满等尚未进入准备阶段的错误不保证有回执。

`round.retry` 用自己的新请求键引用原 send/answer/stop/accept 回执，显式核对并恢复原身份；外层 retry accepted 不表示原动作 accepted，必须读取 `value.receipt`。未知项目创建/注册不自动重做。新请求键不能用于绕过尚未核对的旧轮次动作。

## 对话、停止与有界读取

Coding `session.id` 是业务对话 ID；Agent `view.sessionId` 是执行会话 ID，两者不能混用。send/answer 回执 value 的外层 `sessionId` 为 Coding 对话，`execution.sessionId` 若存在则属于 Agent。

运行中的 send 通过 Agent write 继续当前轮；只有终态（completed/failed/cancelled）且 `stopConfirmed:true` 才能延续 Agent 会话并创建新轮。stop accepted 不代表已停止，`cancelRequested` 也不等于确认。未知停止保持原有容量/目录约束。answer/stop/event/snapshot 都校验对话所属 work 与精确 run/attempt；过期问题不可答。confirm 答复为“是”/“否”，select 必须等于给定选项，input/editor 保留原始空白文本。

读取不推进对话，也不自动重发 pending 命令。客户端关闭、HTTP 断开或轮询失败均不等于停止；当前没有 GET 事件轮询接口，事件也走同一 POST 命令。

有界输出的目标为：**事件每次最多 100 条；整个编码响应最多 230 KiB，计算 JSON 转义、传输/路由封装、成果 base64 和省略标记后的全部字节数。** 当前 `output.ts` 对双层 result 封装另留 4 KiB 余量；隔离测试覆盖转义、传输封装、base64 和超限事件页；不能只拿业务对象或原始文本大小验收。

- 对话列表使用 `after`，默认 50 项，最多 100；列表不含 turn 正文。对话的轮次列表每页最多 100，较早轮次通过 `workBefore` 读取。
- 最近 turns 预算约 32 KiB，通过 `hasEarlierTurns` 提示；历史消息分页约 96 KiB，用 `before` 继续。近期 progress 预算约 32 KiB；过大的内嵌 snapshot 省略为 null，并设置 `snapshotOmitted:true,limited:true`。
- 事件按 cursor 续读。`gap`、`snapshotRequired`、highWatermark 尚有未读内容等情况必须显示不完整状态；不能把最近一页显示成完整历史。超出完整编码预算的读取返回 `too_large`。
- 成果原始 JSON 上限 96 KiB，再编码为 base64。省略 patch/文件正文时保留 `changes.status/reason`、文件 `omitted`；最终回复省略时保留 `truncated/missing`。读取经“对话 → work → 不可变 result”校验，不接受任意内容路径。输出超限不撤销已落盘的 accepted 回执，应保留键供查询。

客户端独立保存选择、草稿和游标；共享默认项目只能由显式业务命令修改。`accept` 仅记录接受，不自动 Git 提交、合并或部署。本协议不增加永久内核 API（仍为 32 工具、5 命名空间），Agent 保持独立应用。真实部署、模型、用户数据、网络服务及外部编辑器均未验证；隔离检查数量、源码与发行包摘要见[实施记录](coding-peer-clients-implementation.md)。

Web 读取事件页仅遇到 `too_large` 时按 100→25→5→1 缩小页大小；仍超限或快照超限时保留已知视图、问题及成果并标记 `limited`。权限和传输错误继续传播，不伪装成内容省略。
