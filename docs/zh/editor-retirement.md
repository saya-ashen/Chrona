# Editor 应用退役记录

> 当前状态：Coding 与 coding-web 已退役，包含旧 work-v2；当前 Chat 独立拥有会话与执行记录。本文的 Coding/Editor 接口、源码路径、验收和部署描述仅作历史记录，不是现行接入指引。详见[Coding 退役说明](coding-retirement.md)。

日期：2026-11-09。用户已明确批准删除被无界面 Coding 取代的旧 Editor 应用及其残留。当前状态：**Editor 已退役并移除；源码、合同、发行包与隔离验收均已完成。** 仅 Mind、Remind 整应用继续暂停，并保留源码与依赖材料；memory-local 仅暂停定时整理。

## 当时接入（已被 Coding 退役取代）

无界面的普通可选应用 `coding` 持有共享业务，`coding-web` 为独立普通可选客户端。仓库外编辑器与未来 Electron 消费同一 Coding 应用协议，不要求服务端存在同名 Editor 应用。当时的协议和实施证据已从工作树删除，可从 Git 历史查阅，见[Coding 退役说明](coding-retirement.md)。旧 `editor` 安装名、`/api/editor/*` 和旧版本协议不再是支持入口，不保留兼容别名。

## 清理范围

本轮覆盖旧 `external/editor` 应用源码、专属生成契约与安装/发现元数据、专属发行种子和发布计划、构建及测试接线，以及仍将 Editor 写成暂停保留或可安装的当前说明。共享 Coding、Agent、SDK、鉴权及其他应用仍需要的机制按实际所有权保留，不因曾被 Editor 使用而删除。仓库外编辑器客户端不在本轮修改范围。

文档保留有用的整体架构、研究、历史提案、验收与部署证据。旧 Editor 方案和安装指导已加现行替代链接；旧测试计数、种子数量、产物散列和部署记录仍描述其形成时的事实，不改写成退役清理后的结果。

## 验证与部署边界

- 删除旧 Editor 源码目录、六个专属服务器测试/脚本、独立认证接线、目录登记、种子包与本地种子裸仓库；通用 Agent HTTP 测试保留并更名。暂停名单仅含 `mind/remind`。
- 删除旧请求/响应信封、事件查询和 HTTP 常量；仍被 Coding/Agent 使用的共享定义改名为 `ExecutionCommandConsumer`、`executionResponseDataSchemas`，同步重建私有合同与 Agent 包。
- 运行边界及合同定向检查：11 个 Bun 套件 193 pass；管理员检查 34 pass；打包/合同生成检查 7 pass、225 assertions；共享定义改名后的定向检查 14 pass。部分检查互有覆盖，不合计为独立测试总数。日志：`/tmp/chrona-editor-check-jonkgz69/bun.log`、`/tmp/chrona-editor-admin.log`、`/tmp/chrona-editor-packaging.log`、`/tmp/chrona-editor-rename-tests.log`。
- 最终静态检查：`bun scripts/chrona.ts check all`，退出 0，30 条既有依赖方向警告、0 错误；日志 `/tmp/chrona-editor-static-final.log`。最终全量 API：111 pass、1 skip、0 fail，19 个文件；日志 `/tmp/chrona-editor-api-final.log`。
- 重建 Linux x64 发行包成功，官方离线种子共 13 个；最终资源中无 Editor 目录、Git 包或裸仓库，Coding 私有合同无旧 HTTP URL 或旧共享定义名称。二进制 `dist/releases/chrona-linux-x64/chrona` SHA-256：`3401d052ec260369d0f2c62b7840edc2b97058a41515dcd7b8fdc54aedf9c35a`；构建日志 `/tmp/chrona-editor-build-final.log`。
- 最终发行包隔离验收结果见 `/tmp/chrona-editor-release-smoke-final.log`：受检离线安装、两个应用激活、认证 HTTP、真实 Agent 主机项目登记、HTTP/模块共享会话、回执重放、参数冲突及页面注册；旧 Editor URL 为 404。全程使用临时数据、Provider none，实际模型请求为 0。
- 文档工作仅调整 `AGENTS.md` 和 `docs/**`；未在此工作中执行构建、测试、网络、模型、外部仓库或部署操作。
- 现有 `chrona-kernel-preview.service` 的 `127.0.0.1:3112` 部署保持原样。此前 Coding/coding-web 的部署证据继续保留在[Coding 退役说明](coding-retirement.md)；本轮删除不代表该服务已更新。3111 亦未因本轮文档工作变更。
