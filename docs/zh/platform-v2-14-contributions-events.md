# v2-14 规格：精简内核、贡献区与事件

状态：已实现（2026-10-25）；与草案的差异见第 6 节。依赖 [v2-13](platform-v2-13-modules-tools.md)。

## 1. 原则

内核只保留信任根基：代码存储与内容哈希、审批与启用、沙箱与进程监管、路由调用与准入、凭据、运行预算、启动 Provider。其余通用能力做成内置模块，随 Chrona 版本发布，像普通模块一样有版本、审批与回滚（已有先例：`notify`、`web`、`qq`、`mcp`）。新增一种模块通用能力时，内核只在必要时增加**通用**规则，不增加针对某个能力的逻辑。

## 2. 内核的两条通用规则

### 2.1 清单的 `contributes` 区

- 清单新增可选字段 `contributes: { <模块名>: <任意 JSON> }`（整体 ≤ 32 KiB）。内核不解释内容，只做大小与 JSON 校验，随版本保存，并在审批卡上原样展示（与清单其他字段一样进入差异）。
- 每个区由同名模块解释和校验，例如 `contributes.events` 由 `events` 模块解释。
- 新增系统工具 `modules.contributions({ section })`：返回所有已启用模块在该区的声明 `[{ module, hash, value }]`。只有与 `section` 同名的模块可以调用（`callers` 由内核按名字判断），其他模块读不到别人的声明。

### 2.2 工具可以点名授权调用方

- 现在模块调用另一个模块的工具，必须在自己的 `uses` 里列出目标；被调用方的 `callers` 只是额外限制。
- 新增：若目标工具 `visibility` 含 `modules`，且 `callers` 明确写出调用方的模块名，则该调用方无需在 `uses` 中列出也可调用。授权由被调用方显式给出。
- 用途：像 `events` 这样需要调用事先不知道的工具的模块。其他准入规则（可见性、调用链深度、等待环检测、记录真实调用方）不变。

## 3. 内置模块 `events`

### 3.1 声明

发出方在清单中声明会发出的事件：

```json
"contributes": { "events": { "emits": [
  { "name": "updated", "description": "一份计划被修改", "payload": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] } }
] } }
```

事件全名为 `<发出方>.<name>`，如 `planning.updated`。没有声明的事件不能发出，也不能被订阅。

### 3.2 工具

| 工具 | 调用方 | 作用 |
| --- | --- | --- |
| `emit({ event, payload, key })` | 声明了该事件的模块本身 | 按声明的 `payload` 校验后投递给所有订阅者；`key` 为幂等键（由触发事件派生） |
| `subscribe({ event, tool })` | 任何模块 | 订阅；`tool` 必须是调用方自己的工具，且其 `callers` 含 `events`。事件未声明则拒绝 |
| `unsubscribe({ event, tool })` | 订阅者本身 | 取消 |
| `subscriptions()` | 调用方 | 自己的订阅 |

- `events` 通过内核记录的真实调用方（SDK 事件里的 `caller`）判断“是谁在发、是谁在订”，不信任参数里的自称。
- 投递：对每个订阅者发一次异步路由调用到它的 `tool`，参数 `{ event, from, payload }`，幂等键 `<event>:<key>`。复用路由调用已有的排队、去重、重试和调用链深度上限。订阅者看到的调用方是 `events`，原始发出方在 `from` 里。
- 订阅存在 `events` 自己的数据目录。订阅者被删除、停用，或新版本里那个工具不存在或不再允许 `events` 调用时，投递失败并移除该订阅。
- SDK：`chrona.emit(name, payload, { key })` 是 `chrona.call("events.emit", …)` 的简写；`uses` 需列出 `events.emit`、`events.subscribe`。

### 3.3 防滥用

- 发出方只能发自己声明的事件；订阅者只能把回调指向自己的工具（不能让 `events` 去调第三方）。
- 回调里再发事件受调用链深度上限约束。
- 单个事件每次 `emit` 最多投递给 50 个订阅者；`payload` ≤ 64 KiB。

## 4. 不在本版

- 订阅者是会话（把结果推回 Provider 运行）：待 v2-13 的“检查完成统一出口”落地后，作为 `modules` 发出的第一个事件接入。
- 订阅过滤条件、批量投递。

## 5. 验证

- 清单：`contributes` 大小与 JSON 校验；审批卡显示其差异；`modules.contributions` 只对同名模块开放。
- 准入表格测试：`callers` 点名时无需 `uses`；未点名、可见性不含 `modules` 时仍被拒；原有规则不变。
- `events`：未声明不能发、不能订；回调目标必须是订阅者自己的、允许 `events` 调用的工具；payload 校验；幂等键去重；订阅者删除或工具消失后订阅移除；回调中再发事件到深度上限被拒。
- 端到端：模块 A 声明并发出事件，模块 B 订阅，B 的工具收到 `{ event, from, payload }`。

## 6. 实现与草案的差异

- 模块工具的参数只能是标量，所以 `emit` 的 `payload` 是 JSON 文本；订阅者的回调工具接收三个字符串参数 `event`、`from`、`payload`（`payload` 同样是 JSON 文本）。
- `subscribe` 检查回调工具时，用 `modules.tools` 查 `events` 能否调用它：只有订阅者自己的、`callers` 含 `events` 且对模块开放的工具才会出现。
- 投递失败且错误为 `forbidden`、`not_found` 或 `unavailable`（路由调用重试用尽后）时移除该订阅；其他失败只记录。
- 模块调用时的“未声明目标”检查（`module-effects`）同样接受“被调用方在 `callers` 中点名”，否则 `events` 的投递在进入路由之前就会被拒。
- 测试内核 `startModule` 增加 `grants` 选项：列出“已点名授权本模块”的目标，测试里可以调用它们而不必写进 `uses`。
- 提交说明（`m_modules_propose`，也是构建提示的一部分）写明了 `contributes`、`chrona.emit` 和订阅的写法，Provider 写模块时可以直接使用。
