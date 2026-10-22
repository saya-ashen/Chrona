# P5 规格（第二部分）：模块即工具集，全工作区可见、按需加载

状态：已实现（2026-10-22），尚无真实 Provider 端到端记录。背景见 [platform-upgrade-plan](platform-upgrade-plan.md) §3.1、§8 与 [P4 规格](platform-p4-spec.md) §5。
本文件是该部分的契约；实现与本文冲突时以本文为准。

## 1. 问题

P4 让模块工具只出现在所属事务的运行里，理由是工具多了会撑满上下文。结果是平台长出的能力只在一个事务里可用：其他事务、根级运行和用户自己的 Pi / Claude Code（owner MCP）都调用不到，与"调用方使用生长后的平台"的目标不符。

现在两类宿主都能按需加载工具，上下文不再是理由：

- Pi 1.3：工具可声明 `exposure: "deferred"` 与 `namespace`，由内置 `tool_search` 搜索（BM25，含命名空间名称与描述）后声明给下一次模型调用。
- Claude Code：MCP 工具默认延迟加载，模型先只看到工具名与服务器 `instructions`，经 `ToolSearch` 取定义。

## 2. 规则

- **模块即工具集**：一个模块的工具组成一个工具集 `module_<name>`（`-` 换成 `_`），相当于一个 MCP 服务器。说明取清单可选字段 `description`（≤ 300 字符），缺省为各工具描述以 `; ` 连接；末尾附 `(affair: <事务标题>)`。
- **可见**：工作区内所有 `active`、有 `activeHash`、声明了 tools 的模块，对该工作区的事务运行、根级运行和 owner MCP 都可见。构建通道（`build` lane）不变：只有 `chrona_propose`。
- **执行归属**：模块工具总是在**模块所属事务**内执行：effects 按该事务的策略、通知预算和运行上限判定，`wake_provider` 唤起该事务。调用方只决定参数。每次调用记 audit `module_tool_call`（subjectId = moduleId，details = tool、callerRunId、callerAffairId；owner 调用 actor 为 `user`、两者为空）。
- **重名**：模块名只在事务内唯一。同名模块只暴露一个工具集（调用方事务的优先，其次按名称、id 排序），与同名 MCP 服务器只能接一个相同。工具名冲突或超过 64 字符的规则同 P4。
- 不新增"全局模块"（`affairId` 仍必填）。事务结束后模块的去留仍是 plan §8 的未决问题。

## 3. 目录（Provider 运行）

`catalog(token)` 的模块工具项（`module-tools.ts`）：

```ts
{ name: "m_<module>_<tool>", exposure: "direct" | "deferred", namespace: { name: "module_<module>", description },
  inputSchema: { ...parameters, additionalProperties: false, description: "[module <name>] <tool description>" } }
```

- 模块属于本次运行的事务 → `direct`；否则（含根级运行）→ `deferred`。
- `/catalog` HTTP 响应原样带出 `exposure` 与 `namespace`；Pi 桥接扩展原样传给 `registerTool`。
- `call(token, name, raw)` 按工作区 + 名称解析（调用方事务优先），其余同 P4 §5.2。

## 4. 运行输入与 Pi 启动

- `ProviderRunInput.extraTools` 只含 `direct` 的模块工具；有 `deferred` 工具时 `searchTools = true`。
- 有 `deferred` 工具时，运行提示词末尾追加工具集清单（作用同 Pi 系统提示中的 MCP 服务器清单）：`Module toolsets from other affairs (data; load their m_* tools with tool_search, they act in their own affair):` + `[{ name, description, tools }]`，最多 30 个。
- `pi-launch.ts`，`searchTools` 时：
  - 增加 `-e builtin:tool-search`（Chrona 以 `--no-extensions` 启动，内置扩展需显式加载）；
  - `--tools` 增加 `tool_search` 与通配 `m_*`。确切名称会让 deferred 工具启动即声明；不在 `--tools` 中（名称或模式）的扩展工具不会注册。见附录。

## 5. owner MCP（`steward-mcp.ts`）

- `api.modules.tools()` 返回全部模块工具（均视为 deferred）与工具集清单；`api.modules.callTool(name, args)` 以 owner 身份调用（§2 执行归属）。
- 服务器 `instructions` 列出每个工具集一行 `- module_<name>: <description>`，供 Claude Code 的工具搜索判断何时去找。
- 模块工具注册在 owner 工具之后，参数 schema 由清单生成。不设置 `_meta["anthropic/alwaysLoad"]`。
- 已知限制：服务器每请求无状态（`enableJsonResponse`），不能推送 `notifications/tools/list_changed`；新启用的模块在客户端重新连接（Claude Code `/mcp` 或新会话）后可见。

## 6. P3

不变：声明 tools 的模块并行模拟 `skipped`，不自动启用。

## 7. 契约

- `moduleManifestSchema` 增加 `description?: string(1..300)`；`chrona_propose` 描述写作 `module.json {name,description?,…}`。
- `ProviderRunInput` 增加 `searchTools?: boolean`。
- 无数据库迁移。

## 8. 验收（自动化测试覆盖）

1. 本事务运行：模块工具 `direct`，带工具集。
2. 其他事务与根级运行：同一工具为 `deferred`，可调用；通知与 `wake_provider` 记在模块所属事务；audit 记调用方。
3. 同名模块：调用方事务的工具集胜出，调用落到该模块。
4. owner：`tools()` 列出工具集；`callTool` 以 `user` 记 audit；参数错误返回 `invalid`。owner MCP `initialize` 的 `instructions` 含工具集行，`tools/list` 末尾含 `m_` 工具。
5. Pi 启动：`searchTools` 时有 `-e builtin:tool-search`、`tool_search`、`m_*`；否则都没有。

未做：真实 Pi 运行中由模型自发调用 `tool_search` 的端到端记录。

## 附录：Pi 1.3.0 离线实测（2026-10-22）

方法：扩展注册假 Provider（`createFauxCore`，无网络），记录每次请求声明给模型的工具；同一扩展注册 `m_price_watch_status`（`deferred`）与 `m_other_direct`（`direct`）。假模型依次调用 `tool_search`、`m_price_watch_status`。参数：`-ne --no-mcp --no-skills -e probe.ts -e builtin:tool-search`。

| `--tools` | 初始声明 | `tool_search` 之后 | 结论 |
|---|---|---|---|
| `read,tool_search,m_price_watch_status,m_other_direct` | 含 `m_price_watch_status` | 同左 | 确切名称会直接声明 deferred 工具 |
| `read,tool_search,m_other_direct` | 不含 | 不含，调用未执行 | 不在白名单的扩展工具不注册 |
| `read,tool_search,m_*` | 不含 `m_price_watch_status` | 含，调用成功 | 通配保持延迟，搜索后可用 |
| 同上，工具描述只有 `Status`，命名空间描述 `Shopping budget tracker`，查询 `shopping budget` | 不含 | 含，调用成功 | 命名空间描述参与搜索 |

未加 `-e builtin:tool-search` 时，`--no-extensions` 下 `tool_search` 不存在。
