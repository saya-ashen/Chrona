# v2-23 规格：以应用为中心的页面与应用配置

状态：已实现（2026-10-27），未部署；用户已确认范围（两步一起做，应用页用标签）。依赖 [v2-17](platform-v2-17-approval-levels-model-tiers.md)、[v2-20](platform-v2-20-system-apps.md)、[v2-21](platform-v2-21-memory.md)。

## 1. 背景

同一个应用的东西散在多处：设置页混着凭据、各应用模型上限、记忆、反思开关；活动页混着所有应用；应用页是一长串分区。应用的参数写死在 manifest 里，改一个数要重新构建。

## 2. 应用配置（内核）

- manifest 新增 `settings: { 名称: { type: number|string|boolean, label, description?, default, min?, max?, options?, maxLength? } }`，最多 20 项；默认值必须符合声明；名称不能与 `params` 重名；不得用于凭据。
- 值存在所有者设置的 `moduleSettings.<模块名>`，无需迁移。模块运行时，事件的 `params` = manifest params + 配置（存储值仍符合当前声明就用它，否则用默认值），内核在 `module-supervisor` 下发（`moduleRuntimeParams`）。
- `modules.settings-set({ module, values })`（仅 web、mcp）：按当前启用版本的声明逐项校验，未知名称或越界拒绝；写审计 `module_settings_updated`（只记名称），活动记录为“你修改了 X 的设置：…”。
- 系统模块可声明自己的配置（`SystemModule.settings`：声明 + 读写映射），值仍存在原处并经所有者设置服务校验：reflection 的“主动反思”，memory 的提供者、自动检索、自动写入。
- 构建者说明（`modules.propose`）列出 `settings` 字段；配置变化随 manifest 差异出现在审批卡上。

## 3. 一次读取一个应用（内核）

`modules.overview({ module })`（仅 web、mcp）：
- 普通应用：列表项（状态、运行、版本、最近运行）、权限（能力、凭据是否设置、模型档位与今日用量、授权、最近审批）、配置声明与当前值、诊断、最近 30 条活动。
- 系统应用：说明、工具、工作会话、配置、活动。
- MCP：`chrona_app`、`chrona_app_settings`。

## 4. 网页（内置 web）

- 应用页分标签：概览（说明、状态、当前版本、操作）/ 设置（配置、它用的凭据——共用时注明“与某某共用”、模型每日上限）/ 权限（能力、授权、审批）/ 活动（活动、运行、故障）/ 版本。地址 `?tab=`。
- 系统应用页：概览（说明、工作、记忆面板）/ 设置 / 工具 / 活动。
- 设置页只留全局：通知、构建额度、模块模型档位、日程、授权规则、偏好；新增“按应用设置”列表（凭据未设置的标红）。记忆、反思开关、凭据从设置页移到各自应用页。
- 线上运行的是定制 web，需另经构建按此结构改版。

## 5. 不在本版

- 模型档位里的“单个模块上限”列表仍保留在设置页（与应用页的上限编辑并存）。
- 配置变更不触发审批（只影响应用自己，范围由版本声明且已审批）。
