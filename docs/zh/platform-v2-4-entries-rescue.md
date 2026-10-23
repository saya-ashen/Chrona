# v2-4 规格：交互入口模块化与不可变救援控制台

状态：v2-4a（owner API、`listen`）与 v2-4b（救援控制台、`chrona admin`）已在 `platform-v2` 分支实现（2026-10-23）；v2-4c–e（入口模块化）未实现。总纲见 [platform-v2](platform-v2.md)；依赖 [v2-1](platform-v2-1-runtime.md)、[v2-2](platform-v2-2-sessions-content.md)（会话）与 [v2-3](platform-v2-3-remind-model.md)（内置模块机制）。
本文件是该部分的契约；实现与本文冲突时以本文为准。

## 1. 目标

- 网页、QQ、owner MCP 不再是内核代码，而是**内置入口模块**：和其他模块一样可修改、替换、回滚；新入口（Telegram、邮件指令……）也作为模块生长。
- 入口全部可变以后，一次坏的修改可能让用户再也联系不上 Chrona。为此增加**救援控制台**：一个不可变的最小网页，只有对话与审批，在其他入口全坏时用来对话修复。

## 2. 内核保留什么

入口模块化以后，内核仍持有、AI 不能修改：

| 内核部分 | 作用 |
|---|---|
| owner API | 稳定、带版本的用户接口：会话与对话、审批、通知、模块列表、内容区读写与工具调用。所有入口模块都只通过它工作 |
| 认证 | HTTP 请求先经内核认证，再转给入口模块；模块看不到 `API_KEY` |
| 凭据 | 连接器凭据由内核保存，只按清单声明交给对应模块（§3） |
| 通知预算与去重 | 入口模块只负责投递，决定发不发、何时发的仍是内核 |
| 救援控制台 | §5 |

## 3. 入口模块

入口模块就是普通模块（[v2-1](platform-v2-1-runtime.md)），没有单独的种类，只是用到以下能力：

```json
{
  "name": "qq",
  "entry": "index.ts",
  "keepAlive": true,
  "listen": null,
  "effects": ["owner", "network", "secret:qq_bot"],
  "data": { "schema": 1 },
  "tests": ["test.ts"]
}
```

- `keepAlive: true`：保持 QQ 长连接等外连。
- `listen: "/api/mcp"`：模块在 `/chrona/http/s`（unix socket）上运行自己的 HTTP 服务（SDK：`chrona.serve(fetch)`）；内核认证后把 `/api/mcp` 与 `/api/mcp/*` 反向代理过去，去掉 `Authorization` 与 `Cookie`（响应去掉 `Set-Cookie`）。并发、流式响应和大响应体都由 HTTP 本身承担，不经事件通道。要求 `keepAlive`；同一路径只能有一个启用的模块；`/api/steward*`、`/api/workspaces`、`/api/health` 保留给内核。网页（`listen: "/"`）的形式留到 v2-4e 再定。
- `owner`：可调用 `owner`（SDK：`chrona.owner({ method, path, body })`）。owner API 就是 `/api/steward` 的 HTTP 映射（见 contract），由内核在进程内转发、注入 `workspaceId`；只支持 JSON，不含上传与原始下载；不与模块的其他调用排队。`secret:<connector>`：可用 `secret.get` 取该连接器凭据（v2-4d）。

### 3.1 `owner` 能力 = 用户的权力

声明 `owner` 的模块能替用户发言和批准，等同于用户本人。这类模块称为**入口模块**，适用 §4 的信任链规则，并且**从不自动启用**。

## 4. 信任链

入口模块被改坏（或被注入）后，可以伪造"用户批准"。所以：

1. **入口模块的启用、升级、回滚**只能在救援控制台批准。网页、QQ、MCP 中看得到这类审批，但不能处理。
2. **L1 变更**（权限授予、预算、`moduleModel`、通知设置）由入口模块提交时变成 `change_policy` 审批，同样只能在救援控制台批准。
3. 其他审批（发邮件、启用普通模块等）在任何入口都能处理。
4. Chrona 发布版带来的内置入口模块新版本：若用户未替换过该模块，视同内核升级直接启用；否则作为候选，需在救援控制台批准。

即：救援控制台（不可变）→ 批准入口模块 → 入口模块代表用户 → 用户批准其他一切。

## 5. 救援控制台

### 5.1 功能

只有两项：

- **对话**：固定一个 `rescue` 会话（纯文本，无附件、无页面渲染）。用户可在这里说"网页坏了，回滚到上一版"，由 Provider 调用 `chrona_module_rollback` 等工具修复。
- **审批**：列出全部待处理审批（含 §4 的仅救援项），显示清单 diff、意图声明、构建报告，批准或拒绝。

### 5.2 不可变

- 代码在 Chrona 源码中（单个 HTML + 原生 JS，无框架、无构建步骤），由内核直接提供，不经模块执行器、不反向代理到任何模块。
- 在模块列表中显示为 `rescue (immutable)`；网关拒绝任何以它为目标的提案。只随 Chrona 发布版更新。

### 5.3 隔离

- **独立 origin**：监听单独端口（默认 `127.0.0.1:<rescuePort>`），不与网页模块同源。否则网页模块的脚本可以带着同源凭据替用户点击救援页面。
- **独立凭据** `RESCUE_KEY`，不是 `API_KEY`，不进入任何模块；严格 CSP，不加载外部资源。
- 只依赖内核与 Provider。Provider 启动失败时，审批仍可用，对话显示错误，并提示使用命令行（§5.4）。

### 5.4 最后手段：命令行

Provider 本身不可用（模型认证失效、Pi 启动失败）时，救援控制台无法给出修复方案，由用户在主机上用命令行操作。命令行属于内核，不可经网关修改；权限来自用户对 `<dataDir>` 的文件访问权，不需要 Provider。

```
chrona admin modules                     # 模块、当前版本、状态
chrona admin rollback <module> <hash|builtin>
chrona admin disable <module>
chrona admin approvals                   # 含仅救援审批
chrona admin approve|reject <approvalId>
```

- 与网关使用同一套内核函数（回滚的数据规则、审批绑定内容 hash 都不变），并记 audit（actor `user`，来源 `cli`）。
- v1 修改后需重启 Chrona 服务，使常驻模块按新 generation 启动。
- 现有 `scripts/chrona.ts` 是开发命令，不承担此用途。

## 6. 三个内置入口模块

| 模块 | 运行 | 能力 | 说明 |
|---|---|---|---|
| `web` | `listen: "/"` | `owner` | 现有网页。源码与锁文件在模块内；构建沙箱只读挂载 Chrona 已审查的依赖缓存，v1 不允许新增依赖 |
| `qq` | `keepAlive` | `owner`、`network`、`secret:qq_bot` | 现有 QQ 机器人：主人绑定、消息与 `qq:dm` 会话互转、`/new`、审批按钮、通知投递；绑定数据在模块数据目录 |
| `mcp` | `listen: "/api/mcp"` | `owner` | 现有 owner MCP，按 owner API 映射为 MCP 工具 |

通知投递：入口模块经 `owner.notifications` 订阅待投递通知，投递成功后确认；预算、安静时段、去重仍由内核判定。

## 7. 分阶段

每阶段结束 Chrona 都完整可用；**救援控制台必须先于任何入口模块可修改上线。**

1. v2-4a：owner API = 现有 HTTP 映射（`owner` 调用）；`listen` 反向代理到模块的 HTTP socket。
2. v2-4b：救援控制台；§4 的仅救援审批与 `change_policy`。
3. v2-4c：`mcp` 模块化（最小，用来验证 listen + owner）。
4. v2-4d：`qq` 模块化。
5. v2-4e：`web` 模块化（最大：离线构建与依赖缓存）。

## 8. 验收

1. 网页模块被替换为一个只返回 500 的版本 → 打开救援控制台 → 对话要求回滚 → Provider 回滚 → 网页恢复。
2. 网页 / QQ / MCP 中尝试批准入口模块的启用或 `change_policy` → 被拒绝，提示前往救援控制台。
3. 网页模块脚本请求救援端口 → 因跨 origin 与凭据不同而失败。
4. 提案修改 `rescue` → 网关拒绝。
5. 所有入口模块都停止后，救援控制台的审批仍可用；Provider 不可用时对话显示错误并提示命令行。
6. Provider 不可用时，`chrona admin rollback web builtin` 后重启，网页恢复。

## 9. 未决问题

- 网页模块的离线构建：依赖缓存的范围、如何审查新增依赖。
- 救援端口在 NixOS 部署中的暴露方式（仅本机 + SSH 隧道，或局域网）。
- 入口模块持有 QQ 凭据后可以外传；按主机放行网络（P5 HTTP 代理）是前提还是并行项。
