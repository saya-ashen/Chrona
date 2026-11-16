# Coding 应用退役说明

Coding 与 coding-web 已退役，删除范围包含整个 `external/coding`、`external/coding-web` 以及旧 `work-v2` 实现。旧应用安装名、`/api/coding/*`、Coding 模块工具、客户端协议与工作台不再是受支持入口；不为旧客户端保留兼容别名。

当前 Chat 是独立的普通应用，拥有自己的会话、草稿、图片附件、工具选择和执行记录，私有数据存于 `chat.sqlite`。它通过内核通用 Agent 接口执行工作，不依赖 Coding 服务。当前实现见 [Chat 应用说明](../../packages/engine/src/modules/steward/applications/chat/README.md)与 [manifest](../../packages/engine/src/modules/steward/applications/chat/module.json)。这不恢复内核的全局聊天、项目或历史业务接口。

## 文档与历史

旧 Coding 架构草案、平级客户端协议、实施记录、工作台说明、专属原型及截图已从工作树删除。需要核对当时的协议、测试计数或部署证据时，用 `git log --all -- <path>` 定位，再以 `git show <revision>:<path>` 查阅，例如 `docs/zh/coding-peer-clients-implementation.md`。通用架构、Web 组件、研究与阶段验收记录保留；其中的 Coding 源码路径、工具和运行指引仅代表当时状态。

原实施记录中的身份修正继续有效：当时的 `agent-projects.ts` 已清理；它传给宿主的 `{ workspaceId, ownerId: "owner", caller: { kind: "module", moduleId, hash } }` 仍是真实模块主体，`ownerId` 不把调用者提升为 owner。当前授权以实际 caller 和批准版本的显式权限为准。

本次源码与文档清理不证明已有实例已部署更新，也不删除、迁移或导入真实 Coding/Chat 数据。旧部署与验收事实须按其具体版本阅读；[Editor 退役记录](editor-retirement.md)同样属于历史背景。
