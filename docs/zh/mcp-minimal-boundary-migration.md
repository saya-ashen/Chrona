# MCP 迁移到最小内核边界

日期：2026-11-09。范围：恢复普通可选 MCP 应用；不迁移旧数据，不保留旧接口，不新增内核公开工具。该次 MCP 迁移时 Mind、Coding、Editor、Remind 暂停并保留源码。后续 Coding/coding-web 已恢复，见[实施记录](coding-peer-clients-implementation.md)；Editor 已退役并移除，见[退役记录](editor-retirement.md)。当前仅 Mind、Remind 整应用暂停。以下验证计数与部署证据保留为当时记录。

## 使用范围

MCP 经受控安装后提供 `POST /api/mcp`，使用服务既有 API key 鉴权。它不是默认预装应用；启动 Chrona 不会自动安装 MCP。HTTP 是应用入口，身份、调用授权、审批、取消和实际停止仍由现有内核与 Agent 执行。

- MCP 私有会话：发送消息、列出与读取会话、标题与结束状态、消息和转录、运行状态、问题回答和中断。仅能按会话接口访问 MCP 自己的记录。
- 当前工具发现：读取用户可见合同及文档，精确匹配目标，按发现的输入合同验证参数；应用调用固定 `moduleId/contractHash`。合同发现本身不授予权限。
- 应用聚合：已安装应用、当前内核工具、观察到的故障、Web/Notify 的可用工具，以及当前审批。缺失应用按实际错误返回，不模拟成功。
- MCP 自有记忆偏好：持久化 provider、autoRecall、autoRetain，读取当前记忆提供者合同；不再使用内核集中应用配置。
- Author：通过发现的 `author.prepare/write/read/list/stage/source/submit/receipt` 操作显式材料。准入绑定提交者和完整目标集；结果须按原始请求键和 receipt 对账。`prepare` 不执行模型；MCP 不声称恢复自动模型编写。

已删除旧构建、构建会话管理、公共安装/目录分发、公共定时器、集中应用配置和长期授权工具。批准/拒绝只接受一次绑定审批决定；旧 scope、always 等参数拒绝。恢复 MCP 不改变 5 个内核命名空间及 32 个工具。

## 安装与连接

MCP 不加入默认预装列表。停止对应服务后，通过发行包的现有离线管理入口安装，随后重启，让既有检查与审批链完成激活：

```sh
chrona admin install mcp --request-key <稳定的安装请求键>
```

连接端点为服务的 `POST /api/mcp`，请求携带 `Authorization: Bearer <API_KEY>` 和 `Content-Type: application/json`。初始化成功后使用 `tools/list` 发现 MCP 的 24 个应用工具；它们不是新增内核 API。需要审批时，先读取实际请求，再做一次批准或拒绝，不接受长期授权。

`chrona_module_tools` 返回当前用户合同，`chrona_module_reference` 读取文档，`chrona_module_call` 只接受精确目标及符合其输入合同的参数。应用调用要求完整身份与合同哈希，缺少绑定即拒绝。模块缺失、不可用或合同变化时按实际错误处理；无法确认的结果沿用原始请求键查询收据，不以新键盲目重试。

## 验证

自动化使用独立临时数据库、离线依赖和假 Agent；不调用真实模型、外部账号，不触及现有本地服务或用户数据。

发行包验证已通过，日志 `/tmp/chrona-mcp-release.log` 以 `MCP_RELEASE_VERIFY_EXIT=0` 结束：

1. 重新生成共享会话、记忆、偏好副本及 Agent/Web 产物；以当前材料刷新 13 份离线 Git 源种子，验证后构建 linux-x64 发行包。
2. 实际二进制在全新数据目录启动，健康检查、Web 首页与 Today 通过；依赖安装强制 `bun install --offline`。
3. 独立临时实例通过 `admin install mcp` 安装普通 MCP，启动后成功完成 JSON-RPC initialize；无密钥及错误密钥均为 401，发现 24 个工具并实际调用 `chrona_modules`。
4. 发行资源含唯一 builtin Agent；普通应用为 Author、Events、Files、MCP、memory-local、Notify、QQ、Web。Mind/Coding/Editor/Remind 不进入运行资源，其源种子保留。

本轮发行二进制 SHA-256 为 `ac1efee1924a94931b2f219edd11f137e083701cddd67832a75271218654206e`，归档为 `3a0a5d659fad53db9c4609a7a026285b2d4d85caa6a60f5cec761aa455650cd8`。MCP 源种子 commit 为 `5db80b1e96a18e9ff0abcc29ce7349679f713f31`。结构化记录在 `.tmp/mcp-migration/results.json`。

最终验证结果：

| 检查 | 结果与证据 |
| --- | --- |
| Bun 全部 187 个文件 | 合计 2016 pass、7 skip、0 个未解决失败。全量日志 `/tmp/chrona-mcp-last-checks.log` 中 186 文件通过；MCP 权限夹具缺少必填 `effects`，补齐后该文件单独 5 pass、0 fail，见 `/tmp/chrona-mcp-owner-regression.log`。没有将之前失败尝试算作通过。 |
| 全部 API 21 文件 | 114 pass、2 skip、0 fail；`/tmp/chrona-mcp-api-static.log`。跳过项为环境不支持的 bwrap 变体和显式 opt-in 的真实 Neovim GUI。 |
| 当前根类型检查、lint、架构检查 | 全部通过，`MCP_API_STATIC_EXIT=0`。保留既有 CLI doctor 复杂度警告及 28 个测试导入边界警告，架构错误 0；没有放宽规则或重置基线。 |
| 安全回归 | 实际当前身份的 owner/普通模块/MCP 权限检查；HTTP 缺失/错误/正确 API key；严格 JSON-RPC 与输入 schema；会话归属；缺失绑定拒绝；Author 固定材料与收据链。 |
| 发行包及实际安装 | `MCP_RELEASE_VERIFY_EXIT=0`，详见上述离线二进制验收。 |

Bun 的 7 项跳过沿用环境能力限制（主要为 bwrap 与可选宿主能力），不算通过的模型或沙箱实测。迁移开发与发行验证期间没有请求真实模型、更新现有 3111/3112 部署、迁移用户数据或修改外部客户端，也没有提交或推送。后续经用户明确要求，3112 本地预览已更新，见下方部署记录。

审查发现并修复了 MCP 偏好写入权限问题：`mcp.settings` 的合同现为 owner-only，普通模块无法更改记忆提供者；当前已批准且声明 `uses:["*"]` 的用户入口仍按既有内核权限调用。实际数据库身份回归检查覆盖 owner、普通模块和当前 MCP 入口三种情况。偏好结果有严格输出合同。

另补足了发现结果的身份绑定检查：应用合同缺失 `moduleId`、版本哈希或 `contractHash` 时拒绝转发，避免降级为未固定的应用调用。


## 本地部署（2026-11-09）

按用户要求，已将 `chrona-kernel-preview.service`（`127.0.0.1:3112`）更新到上述已验证二进制，并通过停止服务后的 `admin install mcp` 完成普通 MCP 安装；重启后检查通过，MCP 状态为 active。保持原数据目录、API key、Pi 1.5.0 配置及 `krill-ai-codex/gpt-6.1-sol` 模型选择，未执行用户数据迁移。3111 服务保持原样。

实际部署验证覆盖：健康检查与 Pi available；Web 首页；Web/MCP 无密钥和错误密钥均为 401；MCP initialize、24 个工具发现及实际只读 `chrona_modules`；唯一 builtin Agent；五个内核命名空间和 32 个工具；旧 interfaces 路由 404。没有请求真实模型或发送外部消息。

部署前停止服务并备份发行包、配置和完整当前数据。回滚材料位于 `.tmp/kernel-minimization/local-deploy/rollback-mcp-20261109T014147Z`；部署与检查记录在 `.tmp/mcp-migration/local-deployment.json`，运行日志为 `/tmp/chrona-mcp-local-deploy.log`。MCP 连接使用 `POST http://127.0.0.1:3112/api/mcp` 和当前既有 API key。
