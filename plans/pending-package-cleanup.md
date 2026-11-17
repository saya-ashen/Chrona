# 纯内核仓清理

状态：2026-11-17，按用户新增授权分批提交。基线为 `f4b48105`；主仓代码已提交为 `e721e9b3`，边界与运维文档随本记录另行提交。用户最新要求覆盖第一轮保留临时接线的方案：主仓仅维护通用 kernel、宿主、CLI、数据库、SDK 及必需基础包，具体应用、共享业务、页面、专属配置、固定发行输入和生成恢复副本归独立应用仓。

## 本轮文件工作

- 删除固定应用名单、首装初始化和免审批、按具体应用名暂停、Pi 专属宿主注入及 QQ 配置桥接；通用安装、批准身份、队列、预算、幂等、数据保护及实际停止证据继续保留。
- 通用宿主向长驻应用提供无凭据的 kernel origin 与 Linux guardian generation/停止回执路径。回执写宿主 `platform/host-stops/`，不进入应用业务数据、快照或 schema 判空。一次性检查、迁移不新增此持久状态。
- HTTP listener 自管客户端鉴权，代理透明转发应用 Authorization、Cookie 和 Set-Cookie，仅替换内部 transport token；内核路径另行鉴权。浏览器会话、具体 Provider 配置和业务绑定迁应用。
- 删除固定 bundles/artifacts/lock、恢复/pin、应用依赖安装与页面/会话复制生成器。发行、CI 和本地检查只针对通用源码，release smoke 改为全新临时数据库和空应用内核。
- 删除 `.generated/applications/` 及旧 `resources/module-git/repos/` 生成仓副本；不以恢复副本代替真实应用源码。
- build 源码及测试归 `scripts/build/`；schema 和唯一初始 SQL 归 `packages/db/prisma/`；源码默认数据位置统一为平台用户目录下 `chrona.db`，可显式覆盖。
- 按用户明确授权停止本机 `chrona-local-3005.service` 和 `chrona-provider-preview.service`，删除根 `prisma/` 全部运行数据；未删除其他实例或外部恢复材料。
- kernel 目录按职责归拢；Server 持有 Pino logger，跨层保留通用脱敏；shared 改为 runtime-config；Pi adapter 和 transcript 脱敏归独立 Pi 应用；应用共用业务归实际消费者私有维护。

应用迁出切片与最终静态核对已完成；第一轮 reviewer 无发现不作为第二轮通过证明。第二轮 reviewer 发现默认仓库属性残留、宿主回执污染业务数据、SDK preview 下层剥凭据及通用 HTTP 测试引用预装常量；父已逐项修复并同步行为断言，未执行测试。Pi 按宿主回执路径读取原 generation 的停止证据；Web 视觉系统归独立 Web 文档。

## 验证限制

本轮仅编辑文件、检查 diff、JSON/workspace lock 和静态引用；按用户限制不运行构建、测试、lint、typecheck、安装、Prisma Client 生成、Nix、服务启动或真实模型。已按新增授权提交源码，未推送、发布或部署。提交使用 `LEFTHOOK=0`，避免运行本轮明确禁止的 lint 与 guardrails 钩子；不把提交成功视作检查通过。

解除限制后仍需生成 Client、执行当前代码检查，并分别构建和验收独立应用。Nix 依赖输出 hash 需要真实构建重算，不能手填。应用材料在各自仓维护，不能恢复第一轮“等 pin 后保留主仓临时接线”的路线。

## 独立应用提交

| 仓库 | 提交 |
| --- | --- |
| author | `78c6065` |
| chat | `e253fe2` |
| events | `6b549d4` |
| files | `f3fe180` |
| mcp | `3000dd5` |
| mind | `27f386f` |
| notify | `072c0d0` |
| pi | `bd9e492` |
| qq | `f176358` |
| remind | `257504b` |
| remote-execution | `9c0ee71` |
| web | `a4a95fc` |

每仓提交保留其私有实现、迁入测试和文档；应用制品、锁及材料没有因源码提交而自动更新。

## 保留边界

`plans/README.md` 列出的六处数据库和完整备份、`.tmp`、活动 worktree、其他现场部署与恢复根仍保留。历史清理和测试只证明对应版本，不是本轮动态验收。后续真实场景与历史未决项见 `followup.md`；本页不授权恢复旧部署或自动重放 unknown 回执。
