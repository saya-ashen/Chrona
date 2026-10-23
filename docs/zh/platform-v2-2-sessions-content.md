# v2-2 规格：删除事务，会话、内容区与 `files`

状态：草案，未实现（2026-10-22）。总纲见 [platform-v2](platform-v2.md)；依赖 [v2-1 模块运行模型](platform-v2-1-runtime.md)；`files` 需要的内置模块机制（[v2-3](platform-v2-3-remind-model.md) §3.1）随本篇一起实现。
本文件是该部分的契约；实现与本文冲突时以本文为准。

## 1. 删除

| 删除 | 原用途 | 去向 |
|---|---|---|
| `Affair` 表、事务目录 `<dataDir>/affairs`、内核 git 提交 / 差异 / 撤回 | 容器、存储、历史 | 内容区（§3）；历史由需要它的模块自己实现（§4） |
| `Module.affairId`、清单 `affair` 字段 | 模块归属 | 模块独立 |
| 按事务的 Grant、预算、运行上限 | 权限边界 | 按模块与全局（总纲 §7） |
| Provider 工具 `chrona_affairs`、`chrona_affair_create`、`chrona_affair_update` | 管理事务 | 无（后台工作用 `wake`，§2.4） |
| `chrona_focus {affairId}` | 选择工作事务 | `chrona_focus {modules}`（§3.3） |
| 其他工具与 owner API 中的 `affairId` 参数（`chrona_schedule`、`chrona_inbound`、`chrona_request_approval`、通知、模块工具目录的 direct / deferred 区分等） | 按事务限定 | 删除参数；目录中模块工具一律 `deferred`，聚焦模块的工具为 `direct` |
| 今日 / 事务页 | 事务中心 | 网页模块改为：应用列表、会话、近期日程、待处理审批 |

## 2. 会话

借鉴 Hermes Agent 的会话模型（`~/.hermes/hermes-agent` 2026-03 版 `website/docs/user-guide/sessions.md`、`features/cron.md`）。会话只是与 Provider 的对话上下文，不带权限含义；怎样划分会话由入口模块决定，内核只按键管理。

### 2.1 模型

`Session`：`id`、`source`（`web` | `qq` | `mcp` | `rescue` | `wake` | `module`）、`key`、`title`、Provider 会话 id、`origin`（`wake` / `module` 会话的投递目标）、`startedAt`、`endedAt`。

- `Message`、`Run` 关联 `sessionId`。同一会话的运行串行；运行中到达的消息按现有机制注入。
- 每个键同时只有一个活动会话。`owner.chat({ key, text })` 发往该键的活动会话，没有则新建。
- 每个会话有临时工作目录 `<dataDir>/sessions/<id>/`（Provider 的 cwd），会话结束后按保留期清理。
- 上下文过长时由 Provider 自身的压缩机制处理（Pi compaction），内核不另做。

### 2.2 入口如何使用会话

| 入口 | 键 | 说明 |
|---|---|---|
| `qq` | `qq:dm` | 固定一个；`/new` 开始新会话 |
| `web` | `web:<id>` | 会话列表，可新建、切换、改标题、恢复旧会话 |
| `mcp` | 调用方给定，缺省新建 | |
| 救援控制台 | `rescue` | 固定一个 |

这是入口模块的实现，不是内核规则：入口模块可以改变划分方式。

### 2.3 重置与回忆

- 自动重置（设置项）：闲置 N 小时或每天固定时刻结束当前会话，下一条消息开始新会话。重置前给 Provider 一轮，用 `chrona_remember` 保存需要长期记住的内容。有进行中运行的会话不重置。
- 跨会话回忆：Provider 工具 `chrona_session_search {query}`，对所有会话消息做全文检索（SQLite FTS5），返回命中会话的摘要与片段。
- 长期状态不靠会话：结论、文档、配置写进应用（内容区、`files`）与长期偏好。

### 2.4 定时唤起与后台工作

- `chrona_schedule {mode: "wake", text}`：到点在**全新会话**（`source = wake`）中运行，`text` 必须自带完整指令与上下文。结果作为一条助手消息投递回 `origin`（创建它的会话），并按通知预算告知。
- 长任务：`chrona_schedule {mode: "wake", at: now}` 转后台，同上。
- 模块 `wakeProvider`：在全新会话（`source = module`）中运行，结果以通知投递，`origin` 为该模块；网页在该应用下可查看这些会话。

## 3. 内容区

### 3.1 定义

每个模块可以有内容区：`<dataDir>/platform/content/<moduleId>/`，与私有数据 `platform/data/<moduleId>/` 分开。清单声明 `"content": true` 才创建。

- 内容只能是**内容**：Markdown、`*.csv` / `*.json` 面板数据、`*.ui.json`、图片与附件。内核拒绝写入可执行扩展名；内容区里的任何文件都不会被执行。
- 模块进程以 `chrona.paths.content` 读写自己的内容区（沙箱内是 `/content`）。
- 网页模块把每个模块的内容区渲染为该应用的页面（入口为 `README.md`，或 `.chrona/entry` 指定的页面）；渲染约定沿用现有的复选框、`chrona-panel`、json-render。

### 3.2 编辑事件

用户（网页、MCP）或 Provider 修改内容区后，内核向该模块投递 `content_edit { paths, by: "user" | "provider" }`。模块自己写入不产生事件。

### 3.3 Provider 访问

- 每次 Provider 运行，所有模块的内容区出现在工作目录下的 `content/<模块名>/`：有 bwrap 时以**只读**绑定挂载；没有时是符号链接，只读不被强制。
- 当前会话的**聚焦模块**以可写挂载。`chrona_focus {modules: [...]}` 设置聚焦（`auto`；入口模块 `web` / `qq` / `mcp` 的内容区不可聚焦）。新会话默认聚焦 `files`。
- 运行结束后，内核比较聚焦模块内容区的变化，向对应模块投递 `content_edit`。

## 4. `files` 内置模块

- 内容区就是用户的文档树；网页提供浏览、编辑、上传、下载。
- 工具（owner MCP 与其他模块可用）：`list`、`read`、`write`、`move`、`delete`（`delete` 需 `ask`）。
- 历史：每个文件保留最近 20 个版本（存私有数据），网页可查看差异与恢复。触发点：`content_edit` 事件与工具写入。
- 用户上传的附件进入 `files` 的 `uploads/`；Provider 生成的文件默认写 `files`。

## 5. 迁移现有数据

真实用户数据迁移，**部署前须经用户批准并备份 `<dataDir>`**。

| 现有 | 迁移为 |
|---|---|
| 事务目录文件（除 `.chrona/`） | `files` 内容区的 `<事务标题>/` 文件夹；git 历史不迁移，原目录打包保留在备份中 |
| 消息 | 网页消息按事务各成一个已结束的 `web` 会话（标题为事务标题，可恢复、可检索）；QQ 消息并入 `qq:dm` 的历史会话 |
| 事务的 `wake` 调度 | 保留；`origin` 为迁移出的对应会话；指令文本前补上事务标题与 `files` 路径 |
| 事务的 `remind` 调度 | v2-3 前保持原样；v2-3 迁到 `remind` 模块 |
| 事务下的模块 | 独立模块；名称冲突时加后缀 |
| 连接器（v2-5 前仍在内核） | 未被模块处理的条目以 `wake` 方式唤起，`origin` 为网页最近会话；条目文件写 `files` 的 `inbox/<连接器>/` |
| 按事务的 Grant | 不迁移；迁移报告列出，由用户按模块重新授权 |

迁移报告列出每一项的去向与无法迁移的内容。

## 6. 验收

1. 网页新建两个会话、来回切换，各自上下文独立；QQ 消息只进 `qq:dm`，`/new` 后开始新会话。
2. 闲置超过设定时间后，下一条消息进入新会话；重置前 Provider 保存了偏好；`chrona_session_search` 能找回旧会话内容。
3. `wake` 在全新会话中运行，结果出现在创建它的会话里并有通知。
4. Provider 写报告到 `content/files/…` → 网页 `files` 中可见、可编辑、可看历史并恢复；未聚焦模块的内容区写入失败。
5. 用户在网页修改某模块内容区的配置文件 → 该模块收到 `content_edit` 并生效，Provider 未被唤起。
6. 迁移：现有事务的文件、消息、调度、模块按 §5 迁移，迁移报告完整；数据库中不再有 `Affair`。

## 7. 未决问题

- 自动重置的默认值（Hermes 支持 idle / daily / both / none）。
- 会话与临时工作目录的保留期。
